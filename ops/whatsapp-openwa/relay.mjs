#!/usr/bin/env node
// ops/whatsapp-openwa/relay.mjs — Puente entre OpenWA (DGX) y La Polla (Vercel).
//
// 1. OpenWA entrega cada mensaje recibido en POST /openwa, firmado con
//    X-OpenWA-Signature (HMAC del cuerpo con OPENWA_WEBHOOK_SECRET).
// 2. El relay responde 200 de inmediato y reenvía el MISMO cuerpo a
//    APP_URL/api/whatsapp/openwa, firmado con x-lapolla-timestamp y
//    x-lapolla-signature (HMAC de "<ts>.<cuerpo>" con WHATSAPP_OPENWA_RELAY_SECRET).
// 3. Envía por OpenWA las respuestas que devuelve la app, en orden.
// 4. Cada OUTBOX_INTERVAL_MS reclama los avisos pendientes (pago aprobado o
//    rechazado, cupo de regalo), los envía y confirma cada uno.
//
// Sin dependencias (Node 22+). Los logs nunca llevan números ni textos.

import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";

const env = process.env;
const OPENWA_URL = (env.OPENWA_URL || "http://openwa:2785").replace(/\/+$/, "");
const APP_URL = (env.APP_URL || "https://lapollacolombiana.com").replace(/\/+$/, "");
const OUTBOX_INTERVAL_MS = Number(env.OUTBOX_INTERVAL_MS || 30_000);
const RELAY_PORT = Number(env.RELAY_PORT || 8787);
const REQUIRED = ["OPENWA_API_KEY", "OPENWA_SESSION_ID", "OPENWA_WEBHOOK_SECRET", "WHATSAPP_OPENWA_RELAY_SECRET"];

// OpenWA puede mandar una imagen de 3 MB en base64 (WEBHOOK_MAX_PAYLOAD_BYTES).
const MAX_WEBHOOK_BYTES = 4_400_000;
const MAX_PENDING_CHATS = 500;
const SEND_GAP_MS = 600;
const OUTBOX_OFF_BACKOFF_MS = 5 * 60_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (...parts) => console.log(new Date().toISOString(), "[relay]", ...parts);

export function hmacHex(secret, data) {
  return createHmac("sha256", secret).update(data).digest("hex");
}

/** X-OpenWA-Signature: "sha256=<hex HMAC del cuerpo crudo>". */
export function verifyOpenWaSignature(secret, header, raw) {
  if (!secret || typeof header !== "string") return false;
  const expected = Buffer.from(`sha256=${hmacHex(secret, raw)}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Encabezados que valida lib/whatsapp-player/signature.ts en la app. */
export function relayHeaders(secret, raw, nowMs = Date.now()) {
  const ts = String(Math.floor(nowMs / 1000));
  return {
    "content-type": "application/json",
    "x-lapolla-timestamp": ts,
    "x-lapolla-signature": `sha256=${hmacHex(secret, `${ts}.${raw}`)}`,
  };
}

/** Clave para atender en orden los mensajes de un mismo chat. Null = ignorar. */
export function chatKeyOf(raw) {
  try {
    const body = JSON.parse(raw);
    if (body?.event !== "message.received") return null;
    const data = body.data ?? {};
    if (data.fromMe === true || data.isGroup === true) return null;
    const key = typeof data.from === "string" ? data.from : typeof data.chatId === "string" ? data.chatId : null;
    return key && key.length <= 200 ? key : null;
  } catch {
    return null;
  }
}

/** Atiende en orden por chat y en paralelo entre chats. */
export function createChatQueue(limit = MAX_PENDING_CHATS) {
  const chains = new Map();
  return {
    size: () => chains.size,
    push(key, task) {
      if (!chains.has(key) && chains.size >= limit) return false;
      const next = (chains.get(key) ?? Promise.resolve()).then(task).catch((err) => log("tarea falló:", err?.name ?? "error"));
      chains.set(key, next);
      next.finally(() => { if (chains.get(key) === next) chains.delete(key); });
      return true;
    },
  };
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > max) {
        reject(Object.assign(new Error("too_large"), { code: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function createRelay(cfg, deps = {}) {
  const fetchImpl = deps.fetch ?? fetch;
  const wait = deps.sleep ?? sleep;
  const queue = createChatQueue();

  async function openwaSend(chatId, text, idempotencyKey) {
    const url = `${cfg.openwaUrl}/api/sessions/${encodeURIComponent(cfg.sessionId)}/messages/send-text`;
    for (let attempt = 0; attempt < 3; attempt++) {
      let res;
      try {
        res = await fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": cfg.apiKey, "idempotency-key": idempotencyKey },
          // Sin vista previa: los enlaces de entrada no deben abrirse solos.
          body: JSON.stringify({ chatId, text, linkPreview: false }),
          signal: AbortSignal.timeout(60_000),
        });
      } catch (err) {
        log("envío sin respuesta:", err?.name ?? "error");
        await wait(3000 * (attempt + 1));
        continue;
      }
      if (res.ok) return true;
      const body = await res.json().catch(() => null);
      const code = body?.code ?? body?.error?.code ?? "";
      // Puede haber salido: no se reintenta con la misma clave.
      if (code === "IDEMPOTENCY_OUTCOME_UNKNOWN" || res.status === 422) {
        log("envío incierto:", res.status, code);
        return false;
      }
      if (res.status === 409 || res.status === 503 || res.status >= 500) {
        log("envío reintentable:", res.status, code);
        await wait(3000 * (attempt + 1));
        continue;
      }
      log("envío rechazado:", res.status, code);
      return false;
    }
    return false;
  }

  async function signedPost(path, raw) {
    return fetchImpl(`${cfg.appUrl}${path}`, {
      method: "POST",
      headers: relayHeaders(cfg.relaySecret, raw),
      body: raw,
      signal: AbortSignal.timeout(70_000),
    });
  }

  async function forward(raw) {
    let messageId = "msg";
    try { messageId = String(JSON.parse(raw)?.data?.id ?? "msg").slice(0, 150); } catch { /* cuerpo ya validado */ }
    for (let attempt = 0; attempt < 3; attempt++) {
      let res;
      try {
        res = await signedPost("/api/whatsapp/openwa", raw);
      } catch (err) {
        log("app sin respuesta:", err?.name ?? "error");
        await wait(2000 * 3 ** attempt);
        continue;
      }
      if (res.status === 404) { log("bot apagado en la app (404)"); return; }
      if (res.status === 429 || res.status >= 500) {
        log("app reintentable:", res.status);
        await wait(2000 * 3 ** attempt);
        continue;
      }
      if (!res.ok) { log("app rechazó el evento:", res.status); return; }
      const body = await res.json().catch(() => null);
      const replies = Array.isArray(body?.replies) ? body.replies : [];
      log("evento:", body?.outcome ?? "?", "respuestas:", replies.length);
      for (let i = 0; i < replies.length; i++) {
        const reply = replies[i];
        if (typeof reply?.to !== "string" || typeof reply?.text !== "string" || !reply.text) continue;
        if (i > 0) await wait(SEND_GAP_MS);
        await openwaSend(reply.to, reply.text.slice(0, 4096), `in-${messageId}-${i}`);
      }
      return;
    }
    log("evento perdido tras reintentos");
  }

  let outboxTimer = null;
  let stopped = false;
  async function pollOutbox() {
    let delay = cfg.outboxIntervalMs;
    try {
      const res = await signedPost("/api/whatsapp/openwa/outbox", JSON.stringify({ action: "claim", limit: 10 }));
      if (res.status === 404) {
        delay = OUTBOX_OFF_BACKOFF_MS;
      } else if (!res.ok) {
        log("avisos no reclamados:", res.status);
      } else {
        const body = await res.json().catch(() => null);
        const messages = Array.isArray(body?.messages) ? body.messages : [];
        for (const m of messages) {
          if (typeof m?.id !== "string" || typeof m?.to !== "string" || typeof m?.text !== "string") continue;
          const ok = await openwaSend(m.to, m.text.slice(0, 4096), `outbox-${m.id}`);
          const ack = await signedPost("/api/whatsapp/openwa/outbox", JSON.stringify(ok
            ? { action: "ack", id: m.id, ok: true }
            : { action: "ack", id: m.id, ok: false, error: "send_failed" }));
          if (!ack.ok) log("aviso sin confirmar:", ack.status);
          await wait(SEND_GAP_MS);
        }
        if (messages.length) log("avisos enviados:", messages.length);
      }
    } catch (err) {
      log("avisos con error:", err?.name ?? "error");
    }
    if (!stopped) outboxTimer = setTimeout(pollOutbox, delay);
  }

  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, pending: queue.size() }));
      return;
    }
    if (req.method !== "POST" || req.url !== "/openwa") {
      res.writeHead(404).end();
      return;
    }
    let raw;
    try {
      raw = await readBody(req, MAX_WEBHOOK_BYTES);
    } catch (err) {
      res.writeHead(err?.code === 413 ? 413 : 400).end();
      return;
    }
    if (!verifyOpenWaSignature(cfg.webhookSecret, req.headers["x-openwa-signature"], raw)) {
      log("firma de OpenWA inválida");
      res.writeHead(401).end();
      return;
    }
    // 2xx de inmediato: la app puede tardar (comprobantes) y OpenWA reintentaría.
    res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    const key = chatKeyOf(raw);
    if (!key) return;
    if (!queue.push(key, () => forward(raw))) log("cola llena: evento descartado");
  });

  return {
    server,
    forward,
    pollOutbox,
    start() {
      server.listen(cfg.port, () => log(`escuchando en :${cfg.port}`));
      outboxTimer = setTimeout(pollOutbox, 5_000);
    },
    stop() {
      stopped = true;
      if (outboxTimer) clearTimeout(outboxTimer);
      server.close();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const missing = REQUIRED.filter((name) => !env[name]);
  if (missing.length) {
    console.error("[relay] faltan variables:", missing.join(", "));
    process.exit(1);
  }
  if (env.WHATSAPP_OPENWA_RELAY_SECRET.length < 32) {
    console.error("[relay] WHATSAPP_OPENWA_RELAY_SECRET debe tener al menos 32 caracteres");
    process.exit(1);
  }
  const relay = createRelay({
    openwaUrl: OPENWA_URL,
    appUrl: APP_URL,
    apiKey: env.OPENWA_API_KEY,
    sessionId: env.OPENWA_SESSION_ID,
    webhookSecret: env.OPENWA_WEBHOOK_SECRET,
    relaySecret: env.WHATSAPP_OPENWA_RELAY_SECRET,
    outboxIntervalMs: OUTBOX_INTERVAL_MS,
    port: RELAY_PORT,
  });
  relay.start();
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => { relay.stop(); process.exit(0); });
}

#!/usr/bin/env node
// ops/whatsapp-openwa/relay.mjs — Puente entre OpenWA (DGX) y La Polla (Vercel).
//
// 1. OpenWA entrega message.received y poll.vote en POST /openwa, firmados con
//    X-OpenWA-Signature (HMAC del cuerpo con OPENWA_WEBHOOK_SECRET).
// 2. El relay responde 200 de inmediato y reenvía el cuerpo a
//    APP_URL/api/whatsapp/openwa, firmado con x-lapolla-timestamp y
//    x-lapolla-signature (HMAC de "<ts>.<cuerpo>" con WHATSAPP_OPENWA_RELAY_SECRET).
//    Los votos añaden la comprobación de que el votante no es el propio bot.
// 3. Envía texto + encuesta, en orden; firma el ack poll-sent con el id real.
// 4. Cada OUTBOX_INTERVAL_MS reclama los avisos pendientes (pago aprobado o
//    rechazado, cupo de regalo), los envía y confirma cada uno.
//
// Sin dependencias (Node 22+). Los logs nunca llevan números ni textos.

import { createServer } from "node:http";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
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
    if (body?.event !== "message.received" && body?.event !== "poll.vote") return null;
    const data = body.data ?? {};
    if (data.fromMe === true || data.isGroup === true) return null;
    const key = typeof data.chatId === "string" ? data.chatId : typeof data.from === "string" ? data.from : null;
    return key && /^[1-9][0-9]{0,39}@(c\.us|lid)$/.test(key) ? key : null;
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

  async function openwaSend(chatId, content, idempotencyKey, poll = false) {
    const url = `${cfg.openwaUrl}/api/sessions/${encodeURIComponent(cfg.sessionId)}/messages/${poll ? "send-poll" : "send-text"}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      let res;
      try {
        res = await fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": cfg.apiKey, "idempotency-key": idempotencyKey },
          // Sin vista previa: los enlaces de entrada no deben abrirse solos.
          body: JSON.stringify(poll ? { chatId, name: content.name, options: content.options, allowMultipleAnswers: false }
            : { chatId, text: content, linkPreview: false }),
          signal: AbortSignal.timeout(60_000),
        });
      } catch (err) {
        log("envío sin respuesta:", err?.name ?? "error");
        await wait(3000 * (attempt + 1));
        continue;
      }
      if (res.ok) {
        if (!poll) return true;
        const sent = await res.json().catch(() => null);
        return typeof sent?.messageId === "string" && sent.messageId.length <= 200 && sent.messageId.length > 0 ? sent.messageId : false;
      }
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
      // Una redirección (p. ej. a /login) es configuración rota: se reporta, no se sigue.
      redirect: "manual",
      signal: AbortSignal.timeout(70_000),
    });
  }

  async function openwaGet(path) {
    const res = await fetchImpl(`${cfg.openwaUrl}/api/sessions/${encodeURIComponent(cfg.sessionId)}${path}`, {
      headers: { "x-api-key": cfg.apiKey }, signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error("identity_check_failed");
    return res.json();
  }

  /** Resolve only to exclude our own votes, never to choose a player's account. */
  async function checkedVote(raw) {
    const body = JSON.parse(raw);
    const voter = body?.data?.voterId;
    if (body?.data?.fromMe === true || typeof voter !== "string" || !/^[1-9][0-9]{0,39}@(c\.us|lid)$/.test(voter)) return null;
    const session = await openwaGet("");
    const own = String(session?.phone ?? "").replace(/\D/g, "");
    if (!/^[1-9][0-9]{7,14}$/.test(own)) throw new Error("session_not_linked");
    const resolved = voter.endsWith("@lid")
      ? (await openwaGet(`/contacts/${encodeURIComponent(voter)}/phone`))?.phone
      : voter.slice(0, -5);
    const voterPhone = String(resolved ?? "").replace(/\D/g, "");
    // Fail closed while OpenWA cannot exclude a self-vote from a private id.
    if (!/^[1-9][0-9]{7,14}$/.test(voterPhone)) throw new Error("voter_unresolved");
    if (own === voterPhone) return null;
    return JSON.stringify({ ...body, data: { ...body.data, selfChecked: true, fromMe: false } });
  }

  async function sendReply(reply, key) {
    const ok = await openwaSend(reply.to, reply.text.slice(0, 4096), key);
    const poll = reply.poll;
    if (!ok || !poll) return ok;
    if (typeof poll.nonce !== "string" || !/^[a-f0-9]{32}$/.test(poll.nonce)
      || typeof poll.name !== "string" || !poll.name || poll.name.length > 255
      || !Array.isArray(poll.options) || poll.options.length < 2 || poll.options.length > 12
      || poll.options.some(o => typeof o !== "string" || !o || o.length > 100)
      || new Set(poll.options).size !== poll.options.length || poll.allowMultipleAnswers !== false) return false;
    await wait(SEND_GAP_MS);
    const pollMessageId = await openwaSend(reply.to, poll, `${key}-poll`, true);
    if (!pollMessageId) return false;
    // sendResolved may turn c.us into lid (or vice versa). The serialized native
    // message key carries the actual remote JID used by poll.vote's parent poll.
    const sentChatId = /^true_([1-9][0-9]{0,39}@(c\.us|lid))_/.exec(pollMessageId)?.[1] ?? reply.to;
    const raw = JSON.stringify({ pollMessageId, chatId: sentChatId, nonce: poll.nonce });
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await signedPost("/api/whatsapp/openwa/poll-sent", raw);
        if (res.ok) return (await res.json().catch(() => null))?.ok === true;
        if (res.status < 500 && res.status !== 429) return false;
      } catch { /* Retry the acknowledgement, never a new poll. */ }
      await wait(2000 * (attempt + 1));
    }
    log("encuesta sin confirmar; el menú de texto sigue disponible");
    return false;
  }

  async function forward(raw) {
    let messageId = "msg";
    try {
      const body = JSON.parse(raw);
      if (body?.event === "poll.vote") {
        raw = await checkedVote(raw);
        if (!raw) return;
        messageId = `vote-${createHash("sha256").update(raw).digest("hex")}`;
      } else messageId = String(body?.data?.id ?? "msg").slice(0, 150);
    } catch (err) { log("evento sin identidad verificable:", err?.name ?? "error"); return; }
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
        await sendReply(reply, `in-${messageId}-${i}`);
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
          const ok = await sendReply(m, `outbox-${m.id}`);
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

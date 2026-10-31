#!/usr/bin/env node
// ops/whatsapp-openwa/setup.mjs — Configura la sesión de OpenWA del bot.
//
// Corre en el host del DGX, junto al docker-compose.yml de esta carpeta:
//
//   node setup.mjs init            sesión + llave del relay + secreto (relay.env)
//   node setup.mjs webhook         registra OpenWA → relay (con el relay arriba)
//   node setup.mjs start           arranca la sesión (pide QR o código)
//   node setup.mjs pair 57300…     código de 8 letras para vincular el número
//   node setup.mjs qr qr.png       guarda el QR como imagen
//   node setup.mjs status          estado de la sesión
//   node setup.mjs test-webhook    OpenWA → relay con un evento de prueba
//   node setup.mjs stop            detiene la sesión (no la borra)
//
// La llave ADMIN de OpenWA se lee del contenedor y nunca se imprime ni se
// guarda. `init` escribe relay.env (600) con la sesión, una llave OPERATOR
// limitada a esa sesión y el secreto del webhook. Nada de esto se imprime.

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OPENWA_URL = (process.env.OPENWA_URL || "http://127.0.0.1:2785").replace(/\/+$/, "");
const CONTAINER = process.env.OPENWA_CONTAINER || "lapolla-openwa";
const SESSION_NAME = process.env.OPENWA_SESSION_NAME || "la-polla-bot";
const WEBHOOK_URL = process.env.RELAY_WEBHOOK_URL || "http://relay:8787/openwa";
const RELAY_ENV = join(HERE, "relay.env");

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function adminKey() {
  try {
    return execFileSync("docker", ["exec", CONTAINER, "cat", "/app/data/.api-key"], { encoding: "utf8", timeout: 15_000 }).trim();
  } catch {
    return fail(`no pude leer la llave admin de ${CONTAINER} (¿está corriendo?)`);
  }
}

function readEnvFile() {
  if (!existsSync(RELAY_ENV)) return {};
  const out = {};
  for (const line of readFileSync(RELAY_ENV, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function writeEnvFile(values) {
  const body = Object.entries(values).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
  writeFileSync(RELAY_ENV, body, { mode: 0o600 });
  chmodSync(RELAY_ENV, 0o600);
}

async function api(key, method, path, body) {
  const res = await fetch(`${OPENWA_URL}${path}`, {
    method,
    headers: { "x-api-key": key, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* no JSON */ }
  if (!res.ok) {
    const detail = json?.code || (Array.isArray(json?.message) ? json.message.join("; ") : json?.message) || res.statusText;
    throw new Error(`${method} ${path.replace(/[0-9a-f-]{36}/g, ":id")} → ${res.status} ${detail}`);
  }
  return json;
}

async function findSession(key) {
  const list = await api(key, "GET", `/api/sessions?name=${encodeURIComponent(SESSION_NAME)}`);
  return Array.isArray(list) ? list.find((s) => s.name === SESSION_NAME) ?? null : null;
}

async function sessionId(key) {
  const saved = readEnvFile().OPENWA_SESSION_ID;
  if (saved) return saved;
  const s = await findSession(key);
  if (!s) fail("no hay sesión: corre primero `node setup.mjs init`");
  return s.id;
}

const mask = (phone) => (phone ? `${String(phone).slice(0, 3)}…${String(phone).slice(-2)}` : "sin vincular");

async function init() {
  const key = adminKey();
  const saved = readEnvFile();

  let session = await findSession(key);
  if (!session) {
    session = await api(key, "POST", "/api/sessions", { name: SESSION_NAME });
    console.log(`✓ sesión creada (${session.status})`);
  } else {
    console.log(`✓ sesión existente (${session.status})`);
  }

  const values = { ...saved, OPENWA_SESSION_ID: session.id };
  if (!values.OPENWA_WEBHOOK_SECRET) values.OPENWA_WEBHOOK_SECRET = randomBytes(32).toString("hex");
  if (!values.OPENWA_API_KEY) {
    const created = await api(key, "POST", "/api/auth/api-keys", {
      name: "la-polla-relay",
      role: "operator",
      allowedSessions: [session.id],
    });
    values.OPENWA_API_KEY = created.apiKey;
    console.log("✓ llave del relay creada (operator, solo esta sesión)");
  }
  writeEnvFile(values);
  console.log(`✓ ${RELAY_ENV} actualizado (600)`);

  console.log("Siguiente: `docker compose up -d relay` y después `node setup.mjs webhook`.");
}

// Aparte de init: OpenWA resuelve el host «relay» al registrar, así que el
// contenedor del relay ya debe estar arriba.
async function webhook() {
  const key = adminKey();
  const values = readEnvFile();
  if (!values.OPENWA_WEBHOOK_SECRET || !values.OPENWA_SESSION_ID) fail("corre primero `node setup.mjs init`");
  const id = values.OPENWA_SESSION_ID;
  const hooks = await api(key, "GET", `/api/sessions/${id}/webhooks`);
  const existing = Array.isArray(hooks) ? hooks.find((h) => h.url === WEBHOOK_URL) : null;
  // PUT siempre: deja el secreto de relay.env aunque init lo haya regenerado.
  const spec = { events: ["message.received", "poll.vote"], secret: values.OPENWA_WEBHOOK_SECRET, retryCount: 3 };
  if (existing) {
    await api(key, "PUT", `/api/sessions/${id}/webhooks/${existing.id}`, spec);
    console.log("✓ webhook actualizado → relay");
  } else {
    await api(key, "POST", `/api/sessions/${id}/webhooks`, { url: WEBHOOK_URL, ...spec });
    console.log("✓ webhook registrado → relay");
  }
}

async function main() {
  const [command, arg] = process.argv.slice(2);
  switch (command) {
    case "init":
      return init();
    case "webhook":
      return webhook();
    case "start": {
      const key = adminKey();
      const s = await api(key, "POST", `/api/sessions/${await sessionId(key)}/start`);
      return console.log(`✓ sesión iniciada (${s.status})`);
    }
    case "stop": {
      const key = adminKey();
      const s = await api(key, "POST", `/api/sessions/${await sessionId(key)}/stop`);
      return console.log(`✓ sesión detenida (${s.status})`);
    }
    case "status": {
      const key = adminKey();
      const s = await api(key, "GET", `/api/sessions/${await sessionId(key)}`);
      return console.log(`estado: ${s.status} · número: ${mask(s.phone)}${s.lastError ? ` · último error: ${s.lastError}` : ""}`);
    }
    case "pair": {
      if (!/^[0-9]{6,15}$/.test(arg ?? "")) fail("uso: node setup.mjs pair 57300XXXXXXX (solo dígitos, con indicativo)");
      const key = adminKey();
      const r = await api(key, "POST", `/api/sessions/${await sessionId(key)}/pairing-code`, { phoneNumber: arg });
      console.log(`Código: ${r.pairingCode}`);
      return console.log("En el celular del bot: WhatsApp → Dispositivos vinculados → Vincular con número de teléfono.");
    }
    case "qr": {
      const file = arg || join(HERE, "qr.png");
      const key = adminKey();
      const r = await api(key, "GET", `/api/sessions/${await sessionId(key)}/qr`);
      const b64 = String(r.qrCode ?? "").replace(/^data:image\/png;base64,/, "");
      if (!b64) fail("OpenWA no devolvió QR todavía; espera estado qr_ready");
      writeFileSync(file, Buffer.from(b64, "base64"), { mode: 0o600 });
      return console.log(`✓ QR en ${file} (vence en segundos; bórralo al vincular)`);
    }
    case "test-webhook": {
      const key = adminKey();
      const id = await sessionId(key);
      const hooks = await api(key, "GET", `/api/sessions/${id}/webhooks`);
      const hook = Array.isArray(hooks) ? hooks.find((h) => h.url === WEBHOOK_URL) : null;
      if (!hook) fail("no hay webhook: corre `node setup.mjs init`");
      const r = await api(key, "POST", `/api/sessions/${id}/webhooks/${hook.id}/test`);
      return console.log(`webhook → relay: ${r.success ? "OK" : "FALLÓ"} (${r.statusCode ?? r.error ?? "?"})`);
    }
    default:
      console.log("uso: node setup.mjs init|webhook|start|stop|status|pair <número>|qr [archivo]|test-webhook");
  }
}

main().catch((err) => fail(err.message));

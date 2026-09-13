#!/usr/bin/env node
// scripts/telegram-login-set-webhook.mjs — Registra el webhook y los comandos
// del bot PÚBLICO de login por Telegram. Se corre UNA vez, cuando el dueño ya
// creó el bot en @BotFather y cargó las variables. No toca la base de datos.
//
// Uso (Node 22+):
//   node --env-file=.env.local scripts/telegram-login-set-webhook.mjs --dry-run
//   node --env-file=.env.local scripts/telegram-login-set-webhook.mjs
//   node --env-file=.env.local scripts/telegram-login-set-webhook.mjs --url https://lapollacolombiana.com/api/telegram/login
//   node --env-file=.env.local scripts/telegram-login-set-webhook.mjs --texts-only
//
// --texts-only (v2, 2026-09-13): actualiza SOLO comandos y descripciones del
// bot (ya no hablan de códigos). No llama setWebhook ni necesita el secreto:
// el webhook, su secreto y allowed_updates=["message"] quedan como están.
//
// Variables: TELEGRAM_LOGIN_BOT_TOKEN y TELEGRAM_LOGIN_WEBHOOK_SECRET (los
// mismos valores que en Vercel). Nunca imprime sus valores.

const DEFAULT_URL = "https://lapollacolombiana.com/api/telegram/login";

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const dryRun = process.argv.includes("--dry-run");
const textsOnly = process.argv.includes("--texts-only");
const url = arg("--url") ?? DEFAULT_URL;
const token = process.env.TELEGRAM_LOGIN_BOT_TOKEN?.trim() ?? "";
const secret = process.env.TELEGRAM_LOGIN_WEBHOOK_SECRET?.trim() ?? "";

const problems = [];
if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token)) problems.push("TELEGRAM_LOGIN_BOT_TOKEN ausente o mal formado");
if (!textsOnly && !/^[A-Za-z0-9_-]{32,256}$/.test(secret)) problems.push("TELEGRAM_LOGIN_WEBHOOK_SECRET ausente o mal formado (32-256 caracteres A-Z a-z 0-9 _ -)");
let parsed;
try {
  parsed = new URL(url);
  if (parsed.protocol !== "https:") problems.push("La URL del webhook tiene que ser https");
  if (parsed.pathname !== "/api/telegram/login") problems.push("La URL tiene que terminar en /api/telegram/login");
} catch {
  problems.push("URL inválida");
}
if (problems.length) {
  console.error("No se registró nada:\n- " + problems.join("\n- "));
  process.exit(1);
}

const textSteps = [
  ["setMyCommands", {
    commands: [
      { command: "start", description: "Entrar a La Polla" },
      { command: "login", description: "Entrar a La Polla" },
    ],
  }],
  ["setMyCommands", {
    language_code: "en",
    commands: [
      { command: "start", description: "Sign in to Chicken Picks" },
      { command: "login", description: "Sign in to Chicken Picks" },
    ],
  }],
  ["setMyShortDescription", {
    short_description: "Entra a La Polla Colombiana con tu cuenta de Telegram, sin códigos.",
  }],
  ["setMyDescription", {
    description: "Entra a La Polla Colombiana con tu cuenta de Telegram. La primera vez confirmas tu número con el botón Compartir mi número; después basta con tocar Iniciar. No aceptamos números escritos a mano ni contactos de otras personas.",
  }],
];

const steps = textsOnly
  ? textSteps
  : [
      ["setWebhook", {
        url,
        secret_token: secret,
        allowed_updates: ["message"],
        drop_pending_updates: true,
        max_connections: 20,
      }],
      ...textSteps,
    ];

if (dryRun) {
  if (!textsOnly) console.log(`[dry-run] Webhook: ${parsed.origin}${parsed.pathname}`);
  for (const [method, body] of steps) {
    const shown = { ...body };
    if ("secret_token" in shown) shown.secret_token = "(oculto)";
    console.log(`[dry-run] ${method}`, JSON.stringify(shown));
  }
  process.exit(0);
}

async function call(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(`${method}: ${json.description ?? res.status}`);
  return json.result;
}

for (const [method, body] of steps) {
  await call(method, body);
  console.log(`OK ${method}`);
}
const info = await call("getWebhookInfo", {});
console.log("Webhook activo:", {
  url: info.url,
  pending_update_count: info.pending_update_count,
  allowed_updates: info.allowed_updates,
  last_error_message: info.last_error_message ?? null,
});

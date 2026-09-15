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
// el webhook, su secreto y allowed_updates quedan como están. (2026-09-15: el
// servidor agrega callback_query solo, lib/auth/telegram-login/webhook-updates.ts.)
// Ya no hace falta correrlo para los textos: el servidor los sincroniza solo
// una vez por versión (lib/auth/telegram-login/bot-profile.ts).
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

// Mismo perfil que lib/auth/telegram-login/bot-profile.ts (BOT_PROFILE_STEPS).
// Desde 2026-09-14 el servidor lo sincroniza solo (webhook y
// /api/cron/telegram-login-bot-profile); si cambias un texto, cámbialo allá.
// (2026-09-15) El bot también es la app para jugadores (lib/telegram-player).
const SPANISH = {
  commands: [
    { command: "start", description: "Menú principal" },
    { command: "pollas", description: "Pollas abiertas para inscribirte" },
    { command: "mispollas", description: "Mis pollas: pronosticar y ver la tabla" },
    { command: "pagos", description: "Saber si ya confirmamos mi pago" },
    { command: "perfil", description: "Mi nombre, pollito y cuenta de premios" },
    { command: "ayuda", description: "Cómo funciona" },
    { command: "web", description: "Entrar a la página web" },
  ],
  about: [
    "La Polla Colombiana en Telegram: crea tu cuenta, inscríbete a las pollas, envía tu comprobante de pago, pronostica y mira la tabla de posiciones. Todo con botones.",
    "",
    "También te deja entrar a la página web cuando el SMS no llega.",
    "",
    "Página web: https://lapollacolombiana.com",
  ].join(String.fromCharCode(10)),
  short: "Inscríbete, pronostica y mira la tabla de La Polla Colombiana. https://lapollacolombiana.com",
};
// Español para todos los idiomas (pedido del dueño, 2026-09-15).
const PROFILE = { es: SPANISH, en: SPANISH };

const textSteps = [null, "es", "en"].flatMap((lang) => {
  const copy = PROFILE[lang ?? "es"];
  const language = lang ? { language_code: lang } : {};
  return [
    ["setMyCommands", { commands: copy.commands, ...language }],
    ["setMyDescription", { description: copy.about, ...language }],
    ["setMyShortDescription", { short_description: copy.short, ...language }],
  ];
});

const steps = textsOnly
  ? textSteps
  : [
      ["setWebhook", {
        url,
        secret_token: secret,
        allowed_updates: ["message", "callback_query"],
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

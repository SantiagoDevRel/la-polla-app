// scripts/admin-bypass-url.mjs — Genera la URL bookmarkeable del admin.
//
// Uso:
//   node scripts/admin-bypass-url.mjs <phone-e164>
//
// Ejemplo:
//   node scripts/admin-bypass-url.mjs +351934255581
//
// Requiere ADMIN_BYPASS_SECRET en el entorno (mismo valor que vive en
// Vercel prod env). El script computa HMAC-SHA256(phone, secret) y
// arma la URL completa.

import crypto from "node:crypto";

const APP_URL = process.env.APP_URL || "https://lapollacolombiana.com";

function normalizePhone(raw) {
  const s = (raw || "").trim();
  if (!s) return null;
  // Aceptamos +XXXX... o XXXX... — siempre devolvemos con + delante
  // como hace lib/auth/phone.ts. Strip non-digits except leading +.
  const noPlus = s.startsWith("+") ? s.slice(1) : s;
  const digits = noPlus.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return "+" + digits;
}

function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Uso: node scripts/admin-bypass-url.mjs <phone-e164>");
    process.exit(1);
  }

  const secret = process.env.ADMIN_BYPASS_SECRET;
  if (!secret) {
    console.error("ERROR: ADMIN_BYPASS_SECRET no está en el entorno.");
    console.error("Setealo en Vercel y exportalo localmente para correr este script:");
    console.error("  export ADMIN_BYPASS_SECRET='<el-secret>'");
    process.exit(1);
  }

  const phone = normalizePhone(arg);
  if (!phone) {
    console.error("Phone inválido:", arg);
    process.exit(1);
  }

  const token = crypto
    .createHmac("sha256", secret)
    .update(phone)
    .digest("hex");

  const url = `${APP_URL}/api/auth/admin-bypass?phone=${encodeURIComponent(phone)}&token=${token}`;

  console.log("");
  console.log("URL bookmarkeable para login admin sin OTP:");
  console.log("");
  console.log("  " + url);
  console.log("");
  console.log("Bookmarkeala en tu browser/PWA. Cada visita te loguea como ese admin.");
  console.log("Si querés revocar el acceso, rotá ADMIN_BYPASS_SECRET en Vercel.");
}

main();

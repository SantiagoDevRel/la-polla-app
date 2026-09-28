// scripts/rifas-local-env.mjs
//
// LOCAL ONLY. Corre `next build` / `next start` / `next dev` contra el Supabase
// local de scripts/local-pg/local-supabase.mjs (127.0.0.1:54321) con
// RIFAS_ENABLED=true. Nunca lee el .env de producción: las credenciales de
// mensajería y proveedores se vacían, igual que scripts/casa-v2-local-env.mjs.
//
//   node scripts/rifas-local-env.mjs build
//   node scripts/rifas-local-env.mjs start 3101
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { anonKey, serviceKey } from "./local-pg/local-supabase.mjs";

const command = process.argv[2];
const port = process.argv[3] ?? "3101";
if (!["build", "start", "dev"].includes(command)) throw new Error("Usa build, start o dev.");
if (!/^\d{4,5}$/.test(port)) throw new Error("Puerto inválido.");

const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
  SUPABASE_SERVICE_ROLE_KEY: serviceKey,
  SUPABASE_SECRET_KEY: "",
  NEXT_PUBLIC_APP_URL: `http://localhost:${port}`,
  RIFAS_ENABLED: "true",
  // Permite el origen local de Supabase en el CSP (next.config.mjs); solo con URL 127.0.0.1.
  CASA_LOCAL_TEST: "1", CASA_LOCAL_PORT: port,
  TELEGRAM_BOT_TOKEN: "", TELEGRAM_LOGIN_BOT_TOKEN: "", TELEGRAM_WEBHOOK_SECRET: "local-rifas-test",
  META_WA_ACCESS_TOKEN: "", WHATSAPP_OUTBOUND_ENABLED: "false", RESEND_API_KEY: "", API_FOOTBALL_KEY: "",
  SPORTSDB_HIGHLIGHTS_ENABLED: "false", NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_POSTHOG_KEY: "",
};
// Con CASA_LOCAL_TEST, next.config.mjs usa tsconfig.casa-local.json y .next-casa-local-<puerto>
// (igual que scripts/casa-v2-local-env.mjs): tsconfig.json queda limpio.
writeFileSync("tsconfig.casa-local.json", readFileSync("tsconfig.json", "utf8"));
const args = command === "build" ? ["build", "--webpack"] : command === "dev" ? ["dev", "--webpack", "-p", port] : ["start", "-p", port];
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", ...args], { env, stdio: "inherit" });
child.on("exit", (code) => { process.exitCode = code ?? 1; });

// Local integration runner only. Never reads production .env credentials.
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

// CASA_LOCAL_SUPABASE_URL: Windows can reserve 54321 after a reboot; use the local Kong proxy instead.
export const localUrl = process.env.CASA_LOCAL_SUPABASE_URL ?? "http://127.0.0.1:54321";
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(localUrl)) throw new Error("Local Supabase URL must be 127.0.0.1.");
export function localCredentials() {
  const container = JSON.parse(execFileSync("docker", ["inspect", "supabase_auth_la-polla"], { encoding: "utf8" }))[0];
  const secret = container.Config.Env.find((x) => x.startsWith("GOTRUE_JWT_SECRET="))?.slice("GOTRUE_JWT_SECRET=".length);
  if (!secret) throw new Error("Start the local Supabase project first.");
  const token = (role) => {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    // Backdated iat: a sub-second host/container clock skew made PostgREST reject fresh tokens ("JWT issued at future").
    const payload = Buffer.from(JSON.stringify({ role, iss: "supabase", iat: Math.floor(Date.now() / 1000) - 60, exp:Math.floor(Date.now() / 1000) + 86400 })).toString("base64url");
    const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
    return `${header}.${payload}.${signature}`;
  };
  return { anon: token("anon"), service: token("service_role") };
}

export function localEnvironment() {
  const keys = localCredentials();
  return { ...process.env, NEXT_PUBLIC_SUPABASE_URL: localUrl, NEXT_PUBLIC_SUPABASE_ANON_KEY: keys.anon,
    SUPABASE_SERVICE_ROLE_KEY: keys.service, NEXT_PUBLIC_APP_URL: "http://localhost:3101",
    TELEGRAM_BOT_TOKEN: "", TELEGRAM_WEBHOOK_SECRET: "local-casa-test", META_WA_ACCESS_TOKEN: "", RESEND_API_KEY: "",
    API_FOOTBALL_KEY: "", API_FOOTBALL_FINALS_ENABLED: "false", FOOTBALL_DATA_API_KEY: "",
    NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_POSTHOG_KEY: "", CASA_LOCAL_TEST: "1" };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  const port = process.argv[3] ?? "3101";
  if (!/^\d{4,5}$/.test(port) || Number(port) < 1024 || Number(port) > 65535) throw new Error("Use an unprivileged local port.");
  if (!["dev", "build", "start"].includes(command)) throw new Error("Use dev, build or start; target is the local Supabase Docker project.");
  const args = command === "build" ? ["build", "--webpack"] : command === "dev" ? ["dev", "--webpack", "-p", port] : ["start", "-p", port];
  // Next rewrites the include globs of its tsconfig; keep tsconfig.json clean across ports.
  writeFileSync("tsconfig.casa-local.json", readFileSync("tsconfig.json", "utf8"));
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", ...args], { env: { ...localEnvironment(), CASA_LOCAL_PORT: port, NEXT_PUBLIC_APP_URL: `http://localhost:${port}` }, stdio: "inherit", windowsHide: true });
  child.on("exit", (code) => { process.exitCode = code ?? 1; });
}

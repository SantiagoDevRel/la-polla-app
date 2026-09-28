// scripts/local-pg/local-supabase.mjs
//
// LOCAL ONLY. Un «Supabase» mínimo para probar la app de punta a punta cuando
// las imágenes Docker oficiales no se pueden bajar (registro bloqueado o con
// límite). Levanta sobre la base de scripts/local-pg/apply-migrations.sh:
//   · PostgREST real   (POSTGREST_BIN)  → /rest/v1
//   · GoTrue real      (GOTRUE_BIN)     → /auth/v1
//   · Storage simulado (este archivo)   → /storage/v1  (archivos en disco +
//     filas en storage.objects, URLs firmadas con token en memoria)
//   · una puerta en 127.0.0.1:54321 que reparte por prefijo, como Kong.
// Imprime las llaves anon y service_role firmadas con el secreto local.
// Nunca apunta a producción: base, puertos y hosts son 127.0.0.1.
import { spawn } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import http from "node:http";

const SECRET = process.env.LOCAL_JWT_SECRET ?? "local-test-secret-at-least-32-characters-long";
const DB = process.env.PGDB_LOCAL ?? "la_polla_local";
const PGPORT = process.env.PGPORT_LOCAL ?? "54322";
const GATEWAY = 54321, REST = 54331, AUTH = 54332, STORAGE = 54333;
const FILES = process.env.LOCAL_STORAGE_DIR ?? join(process.cwd(), ".local-storage");

function jwt(role) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ role, iss: "supabase", iat: now - 60, exp: now + 30 * 86400 })).toString("base64url");
  return `${header}.${payload}.${createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url")}`;
}
export const anonKey = jwt("anon");
export const serviceKey = jwt("service_role");

function psql(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn("psql", ["-h", "127.0.0.1", "-p", PGPORT, "-U", "postgres", "-d", DB, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql]);
    let err = "";
    child.stderr.on("data", (c) => { err += c; });
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err))));
  });
}
const lit = (s) => `'${String(s).replaceAll("'", "''")}'`;

function start(name, bin, env) {
  const child = spawn(bin, [], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (c) => { if (process.env.LOCAL_VERBOSE) process.stdout.write(`[${name}] ${c}`); });
  child.stderr.on("data", (c) => { if (process.env.LOCAL_VERBOSE || /fatal|error/i.test(String(c))) process.stderr.write(`[${name}] ${c}`); });
  child.on("exit", (code) => console.error(`[${name}] salió con ${code}`));
  return child;
}

// ── Storage simulado ──────────────────────────────────────────────────────
const tokens = new Map(); // token → { bucket, path, kind: "upload"|"read", exp }
const fileOf = (bucket, path) => join(FILES, bucket, path);
async function readBody(req) { const chunks = []; for await (const c of req) chunks.push(c); return Buffer.concat(chunks); }
function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
async function saveObject(bucket, path, bytes, mime, upsert) {
  const target = fileOf(bucket, path);
  if (existsSync(target) && !upsert) return false;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  writeFileSync(`${target}.__mime`, mime ?? "application/octet-stream");
  await psql(`INSERT INTO storage.objects (bucket_id, name, metadata) VALUES (${lit(bucket)}, ${lit(path)},
    jsonb_build_object('size', ${bytes.length}, 'mimetype', ${lit(mime ?? "")}))
    ON CONFLICT (bucket_id, name) DO UPDATE SET metadata = EXCLUDED.metadata, updated_at = now()`);
  return true;
}
async function fileFromRequest(req, body) {
  const type = req.headers["content-type"] ?? "";
  if (type.startsWith("multipart/form-data")) {
    const form = await new Request("http://x", { method: "POST", headers: { "content-type": type }, body }).formData();
    for (const [, value] of form) if (value instanceof Blob) return { bytes: Buffer.from(await value.arrayBuffer()), mime: value.type };
    return null;
  }
  return { bytes: body, mime: type };
}

const storage = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://storage");
    const p = decodeURIComponent(url.pathname);
    let m;
    if (req.method === "POST" && (m = p.match(/^\/object\/upload\/sign\/([^/]+)\/(.+)$/))) {
      if (existsSync(fileOf(m[1], m[2]))) return send(res, 400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
      const token = randomBytes(18).toString("hex");
      tokens.set(token, { bucket: m[1], path: m[2], kind: "upload", exp: Date.now() + 7200_000 });
      return send(res, 200, { url: `/object/upload/sign/${m[1]}/${m[2]}?token=${token}` });
    }
    if (req.method === "PUT" && (m = p.match(/^\/object\/upload\/sign\/([^/]+)\/(.+)$/))) {
      const t = tokens.get(url.searchParams.get("token") ?? "");
      if (!t || t.kind !== "upload" || t.bucket !== m[1] || t.path !== m[2] || t.exp < Date.now()) return send(res, 400, { error: "invalid token" });
      const file = await fileFromRequest(req, await readBody(req));
      if (!file) return send(res, 400, { error: "no file" });
      if (!(await saveObject(m[1], m[2], file.bytes, file.mime, false))) return send(res, 400, { statusCode: "409", error: "Duplicate" });
      return send(res, 200, { Key: `${m[1]}/${m[2]}` });
    }
    if (req.method === "POST" && (m = p.match(/^\/object\/sign\/([^/]+)\/(.+)$/))) {
      if (!existsSync(fileOf(m[1], m[2]))) return send(res, 400, { statusCode: "404", error: "not_found", message: "Object not found" });
      const { expiresIn = 60 } = JSON.parse((await readBody(req)).toString() || "{}");
      const token = randomBytes(18).toString("hex");
      tokens.set(token, { bucket: m[1], path: m[2], kind: "read", exp: Date.now() + expiresIn * 1000 });
      return send(res, 200, { signedURL: `/object/sign/${m[1]}/${m[2]}?token=${token}` });
    }
    if ((req.method === "GET" || req.method === "HEAD") && (m = p.match(/^\/object\/sign\/([^/]+)\/(.+)$/))) {
      const t = tokens.get(url.searchParams.get("token") ?? "");
      if (!t || t.kind !== "read" || t.bucket !== m[1] || t.path !== m[2] || t.exp < Date.now()) return send(res, 400, { error: "invalid token" });
      const f = fileOf(m[1], m[2]);
      return send(res, 200, req.method === "HEAD" ? "" : readFileSync(f), { "Content-Type": readFileSync(`${f}.__mime`, "utf8") });
    }
    if (req.method === "GET" && (m = p.match(/^\/object\/info\/([^/]+)\/(.+)$/))) {
      const f = fileOf(m[1], m[2]);
      return existsSync(f) ? send(res, 200, { name: m[2], bucket_id: m[1], size: readFileSync(f).length }) : send(res, 400, { statusCode: "404", error: "not_found" });
    }
    if ((req.method === "POST" || req.method === "PUT") && (m = p.match(/^\/object\/([^/]+)\/(.+)$/))) {
      const file = await fileFromRequest(req, await readBody(req));
      const ok = file && (await saveObject(m[1], m[2], file.bytes, file.mime, req.method === "PUT" || req.headers["x-upsert"] === "true"));
      return ok ? send(res, 200, { Id: randomUUID(), Key: `${m[1]}/${m[2]}` }) : send(res, 400, { statusCode: "409", error: "Duplicate" });
    }
    if (req.method === "DELETE" && (m = p.match(/^\/object\/([^/]+)$/))) {
      const { prefixes = [] } = JSON.parse((await readBody(req)).toString() || "{}");
      for (const name of prefixes) {
        rmSync(fileOf(m[1], name), { force: true });
        rmSync(`${fileOf(m[1], name)}.__mime`, { force: true });
        await psql(`DELETE FROM storage.objects WHERE bucket_id = ${lit(m[1])} AND name = ${lit(name)}`);
      }
      return send(res, 200, prefixes.map((name) => ({ name })));
    }
    send(res, 404, { error: `storage simulado: ${req.method} ${p} no implementado` });
  } catch (err) {
    send(res, 500, { error: String(err) });
  }
});

// ── Puerta (Kong) ─────────────────────────────────────────────────────────
const routes = [["/rest/v1", REST], ["/auth/v1", AUTH], ["/storage/v1", STORAGE]];
// CORS como el Kong de Supabase: el navegador llama a Auth/Storage desde la app.
function cors(req) {
  return {
    "Access-Control-Allow-Origin": req.headers.origin ?? "*",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": req.headers["access-control-request-headers"] ?? "*",
    "Access-Control-Expose-Headers": "content-range, x-supabase-api-version",
    "Access-Control-Max-Age": "600",
  };
}
const gateway = http.createServer((req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, cors(req)); return res.end(); }
  const route = routes.find(([prefix]) => req.url.startsWith(prefix));
  if (!route) return send(res, 404, { error: "no route" });
  const upstream = http.request({ host: "127.0.0.1", port: route[1], method: req.method, path: req.url.slice(route[0].length) || "/",
    headers: { ...req.headers, host: `127.0.0.1:${route[1]}` } }, (up) => {
    const headers = { ...up.headers };
    for (const key of Object.keys(headers)) if (key.startsWith("access-control-")) delete headers[key];
    res.writeHead(up.statusCode ?? 502, { ...headers, ...cors(req) });
    up.pipe(res);
  });
  upstream.on("error", (err) => send(res, 502, { error: String(err) }));
  req.pipe(upstream);
});

if (process.argv[1] && process.argv[1].endsWith("local-supabase.mjs")) {
  if (process.argv[2] === "keys") {
    console.log(JSON.stringify({ anon: anonKey, service: serviceKey }));
    process.exit(0);
  }
  mkdirSync(FILES, { recursive: true });
  const children = [];
  if (process.env.POSTGREST_BIN) children.push(start("postgrest", process.env.POSTGREST_BIN, {
    PGRST_DB_URI: `postgres://authenticator@127.0.0.1:${PGPORT}/${DB}`, PGRST_DB_SCHEMAS: "public", PGRST_DB_ANON_ROLE: "anon",
    PGRST_JWT_SECRET: SECRET, PGRST_SERVER_PORT: String(REST), PGRST_DB_EXTRA_SEARCH_PATH: "public,extensions",
  }));
  if (process.env.GOTRUE_BIN) children.push(start("gotrue", process.env.GOTRUE_BIN, {
    GOTRUE_API_HOST: "127.0.0.1", PORT: String(AUTH), API_EXTERNAL_URL: `http://127.0.0.1:${GATEWAY}/auth/v1`,
    GOTRUE_DB_DRIVER: "postgres", DATABASE_URL: `postgres://supabase_auth_admin@127.0.0.1:${PGPORT}/${DB}?sslmode=disable`,
    GOTRUE_SITE_URL: "http://localhost:3101", GOTRUE_JWT_SECRET: SECRET, GOTRUE_JWT_EXP: "3600", GOTRUE_JWT_AUD: "authenticated",
    GOTRUE_JWT_DEFAULT_GROUP_NAME: "authenticated", GOTRUE_JWT_ADMIN_ROLES: "service_role", GOTRUE_DISABLE_SIGNUP: "false",
    GOTRUE_EXTERNAL_EMAIL_ENABLED: "true", GOTRUE_MAILER_AUTOCONFIRM: "true", GOTRUE_EXTERNAL_PHONE_ENABLED: "true", GOTRUE_SMS_AUTOCONFIRM: "true",
  }));
  storage.listen(STORAGE, "127.0.0.1");
  gateway.listen(GATEWAY, "127.0.0.1", () => {
    console.log(`Supabase local en http://127.0.0.1:${GATEWAY} (rest ${REST}, auth ${AUTH}, storage simulado ${STORAGE})`);
    console.log(JSON.stringify({ anon: anonKey, service: serviceKey }));
  });
  const stop = () => { for (const c of children) c.kill(); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

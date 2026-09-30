// Local PostgreSQL only. Ten simultaneous sessions must reserve exactly five slots.
// Creates its own synthetic attempts; leaves them for inspection (no deletes).
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
const phone = `995${Date.now().toString().slice(-8)}`;
const ip = randomBytes(32).toString("hex");
const port = process.env.PGPORT_LOCAL ?? "54322";
const database = process.env.PGDB_LOCAL ?? "la_polla_local";
function reserve() {
  return new Promise((resolve, reject) => {
    const process = spawn("psql", ["-h", "127.0.0.1", "-p", port, "-U", "postgres", "-d", database, "-X", "-tA", "-v", "ON_ERROR_STOP=1", "-c",
      `SELECT public.phone_password_reserve_attempt('${phone}', '${ip}');`]);
    let out = "", error = "";
    process.stdout.on("data", c => { out += c; }); process.stderr.on("data", c => { error += c; });
    process.on("error", reject); process.on("close", code => code === 0 ? resolve(out.trim()) : reject(new Error(error)));
  });
}
const results = await Promise.all(Array.from({ length: 10 }, reserve));
assert.equal(results.filter(v => v === "t").length, 5);
assert.equal(results.filter(v => v === "f").length, 5);
console.log("PASS: ten simultaneous requests reserve exactly five attempts.");

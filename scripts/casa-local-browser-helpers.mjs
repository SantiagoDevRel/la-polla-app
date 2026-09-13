// Local Docker fixtures only. Never reads production credentials or sends messages.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { localCredentials, localUrl } from "./casa-v2-local-env.mjs";

const keys = localCredentials();
export const localDb = createClient(localUrl, keys.service, { auth: { persistSession: false } });
export const sqlQuote = (value) => "'" + String(value).replaceAll("'", "''") + "'";
export const localSql = (query) => execFileSync("docker", ["exec", "-i", "supabase_db_la-polla", "psql", "-U", "postgres", "-d", "postgres", "-X", "-tA", "-v", "ON_ERROR_STOP=1"], { input: query, encoding: "utf8", windowsHide: true }).trim();

export async function createLocalBrowserActor(browser, { name, admin = false, origin = process.env.CASA_ORIGIN ?? "http://localhost:3191", timezoneId = "Europe/Berlin" }) {
  if (!/^http:\/\/localhost:\d+$/.test(origin)) throw new Error("Local browser fixtures cannot run against a remote origin.");
  const email = `local-${randomUUID()}@example.invalid`, password = randomUUID();
  const phone = "+1999" + String(Date.now()).slice(-8) + Math.floor(Math.random() * 100);
  const result = await localDb.auth.admin.createUser({ email, password, phone, phone_confirm: true, email_confirm: true });
  if (result.error) throw result.error;
  const id = result.data.user.id;
  localSql(`INSERT INTO public.users(id,whatsapp_number,display_name,avatar_url,is_admin) VALUES(${sqlQuote(id)},${sqlQuote(phone)},${sqlQuote(name)},'millos',${admin}) ON CONFLICT(id) DO UPDATE SET display_name=EXCLUDED.display_name,avatar_url='millos',is_admin=EXCLUDED.is_admin;`);
  const cookies = new Map();
  const auth = createServerClient(localUrl, keys.anon, { cookies: { getAll: () => [...cookies.values()], setAll: (rows) => rows.forEach((row) => cookies.set(row.name, row)) } });
  const login = await auth.auth.signInWithPassword({ email, password });
  if (login.error) throw login.error;
  // A production build registers the Serwist worker; requests it handles are invisible to page.route mocks.
  const context = await browser.newContext({ colorScheme: "dark", locale: "es-CO", timezoneId, viewport: { width: 390, height: 900 }, serviceWorkers: "block" });
  await context.addCookies([...cookies.values()].map((cookie) => ({ name: cookie.name, value: cookie.value, url: origin, sameSite: "Lax" })));
  await context.addInitScript(() => { window.__DISABLE_AGENTATION__ = true; localStorage.setItem("lp_welcome_seen_v1", "1"); sessionStorage.setItem("lp_splash_seen_v2", "1"); });
  return { id, context, page: await context.newPage() };
}

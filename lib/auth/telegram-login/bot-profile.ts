// lib/auth/telegram-login/bot-profile.ts — Comandos y descripciones del bot de
// login, sincronizados desde el propio servidor.
//
// Por qué: el token del bot solo vive en Vercel (sensitive, no se puede leer),
// así que scripts/telegram-login-set-webhook.mjs no se puede correr a mano. En
// la prueba de v2 los comandos de v1 seguían diciendo «Get a sign-in code» a
// quien usa Telegram en inglés. ensureBotProfile() los deja al día UNA vez por
// versión:
//   - la versión es un hash del perfil (comandos + descripciones) y del id
//     público del bot: cambiar un texto o el bot vuelve a sincronizar solo;
//   - se guarda en app_config (telegram_login_bot_profile_version) al terminar
//     bien las nueve llamadas; si una falla, no se guarda y se reintenta más
//     tarde (con una pausa en memoria para no insistir en cada update);
//   - todas las llamadas son idempotentes: dos instancias a la vez no rompen nada.
//
// Se dispara después de responder el webhook (after) y desde
// /api/cron/telegram-login-bot-profile (POST con CRON_SECRET, workflow manual).
// Sin configuración del bot no hace nada. Nunca registra el token.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BotApiCall } from "./bot-api";
import type { TelegramLoginConfig } from "./config";
import { sha256Hex } from "./crypto";

export const BOT_PROFILE_CONFIG_KEY = "telegram_login_bot_profile_version";
/** Sube a mano solo si cambia algo que no está en los textos (p. ej. el scope). */
export const BOT_PROFILE_REVISION = "2026-09-15";
/** Espera por llamada cuando corre después del webhook. */
export const BOT_PROFILE_TIMEOUT_MS = 4000;
/** Pausa en memoria tras un fallo, salvo que se fuerce (ruta de cron). */
export const BOT_PROFILE_RETRY_MS = 10 * 60_000;

// (2026-09-15) El bot también es la app para jugadores (lib/telegram-player).
// Los comandos son atajos del menú fijo; /web emite el enlace de un solo uso.
const COPY = {
  es: {
    commands: [
      { command: "start", description: "Menú principal" },
      { command: "pollas", description: "Pollas abiertas para inscribirte" },
      { command: "mispollas", description: "Mis pollas: pronosticar y ver la tabla" },
      { command: "pagos", description: "Saber si ya confirmamos mi pago" },
      { command: "perfil", description: "Mi nombre, pollito y cuenta de premios" },
      { command: "ayuda", description: "Cómo funciona" },
      { command: "web", description: "Entrar a la página web" },
    ],
    about:
      "La Polla Colombiana en Telegram: crea tu cuenta, inscríbete a las pollas, envía tu comprobante, pronostica y mira la tabla. También te deja entrar a la web cuando el SMS no llega.",
    short: "Inscríbete, pronostica y mira la tabla de La Polla Colombiana desde Telegram.",
  },
  en: {
    commands: [
      { command: "start", description: "Main menu" },
      { command: "pollas", description: "Open pools you can join" },
      { command: "mispollas", description: "My pools: predictions and standings" },
      { command: "pagos", description: "Check whether my payment was confirmed" },
      { command: "perfil", description: "My name, chick and prize account" },
      { command: "ayuda", description: "How it works" },
      { command: "web", description: "Sign in to the website" },
    ],
    about:
      "La Polla Colombiana on Telegram: create your account, join pools, send your payment receipt, make predictions and check the standings. It also signs you in to the website when the SMS doesn't arrive.",
    short: "Join pools, make predictions and check the standings of La Polla Colombiana on Telegram.",
  },
} as const;

type Step = readonly [method: string, body: Readonly<Record<string, unknown>>];

function stepsFor(languageCode: "es" | "en" | null): Step[] {
  const copy = COPY[languageCode ?? "es"];
  const lang = languageCode ? { language_code: languageCode } : {};
  return [
    // /login (v1) sale de la lista; escribirlo sigue funcionando.
    ["setMyCommands", { commands: copy.commands, ...lang }],
    ["setMyDescription", { description: copy.about, ...lang }],
    ["setMyShortDescription", { short_description: copy.short, ...lang }],
  ];
}

/** Perfil completo: por defecto (español), español explícito e inglés. */
export const BOT_PROFILE_STEPS: readonly Step[] = [
  ...stepsFor(null),
  ...stepsFor("es"),
  ...stepsFor("en"),
];

/** Id público del bot (la parte antes de «:» del token). */
function botIdOf(botToken: string): string {
  return botToken.split(":", 1)[0] ?? "";
}

export function botProfileVersion(botToken: string): string {
  const digest = sha256Hex(
    JSON.stringify({ bot: botIdOf(botToken), revision: BOT_PROFILE_REVISION, steps: BOT_PROFILE_STEPS }),
  );
  return `${BOT_PROFILE_REVISION}-${digest.slice(0, 16)}`;
}

type FailStage = "read" | "telegram" | "save" | "unexpected";

export type BotProfileSync =
  | { status: "disabled" }
  | { status: "current" | "synced" | "backoff"; version: string }
  | { status: "failed"; version: string; stage: FailStage; method?: string };

export interface BotProfileDeps {
  config: Pick<TelegramLoginConfig, "botToken"> | null;
  /** Se crea solo si hace falta (sin configuración no se toca la base). */
  db: SupabaseClient | (() => SupabaseClient);
  send: BotApiCall;
  /** Ignora la versión guardada (y la pausa tras un fallo). */
  force?: boolean;
  /** Intenta aunque esta instancia haya fallado hace poco (corrida manual). */
  retryNow?: boolean;
  now?: () => number;
}

// Estado por instancia: evita leer app_config en cada update una vez al día.
let syncedVersion: string | null = null;
let failure: { version: string; at: number } | null = null;
let inflight: { version: string; promise: Promise<BotProfileSync> } | null = null;

/** Solo para pruebas. */
export function resetBotProfileStateForTests(): void {
  syncedVersion = null;
  failure = null;
  inflight = null;
}

function resolveDb(db: BotProfileDeps["db"]): SupabaseClient {
  return typeof db === "function" ? (db as () => SupabaseClient)() : db;
}

async function run(deps: BotProfileDeps & { config: Pick<TelegramLoginConfig, "botToken"> }, version: string): Promise<BotProfileSync> {
  const now = deps.now ?? Date.now;
  const fail = (stage: FailStage, method?: string): BotProfileSync => {
    failure = { version, at: now() };
    console.warn("[telegram-login] perfil del bot sin sincronizar:", stage, method ?? "");
    return method ? { status: "failed", version, stage, method } : { status: "failed", version, stage };
  };

  const db = resolveDb(deps.db);
  if (!deps.force) {
    const { data, error } = await db
      .from("app_config")
      .select("value")
      .eq("key", BOT_PROFILE_CONFIG_KEY)
      .maybeSingle();
    if (error) return fail("read");
    if ((data as { value?: unknown } | null)?.value === version) {
      syncedVersion = version;
      failure = null;
      return { status: "current", version };
    }
  }

  const { send } = deps;
  // En paralelo: nueve llamadas cortas, así el trabajo después del webhook no
  // pasa de un timeout aunque Telegram tarde.
  const results = await Promise.all(
    BOT_PROFILE_STEPS.map(async ([method, body]) => ({ method, ok: await send(method, { ...body }) })),
  );
  const failed = results.find((r) => !r.ok);
  if (failed) return fail("telegram", failed.method);

  const { error } = await db
    .from("app_config")
    .upsert(
      { key: BOT_PROFILE_CONFIG_KEY, value: version, updated_at: new Date(now()).toISOString() },
      { onConflict: "key" },
    );
  // Telegram ya quedó al día: esta instancia no lo repite aunque no se guarde.
  syncedVersion = version;
  if (error) {
    console.warn("[telegram-login] versión del perfil no guardada:", error.code ?? "sin código");
    return { status: "failed", version, stage: "save" };
  }
  failure = null;
  return { status: "synced", version };
}

export async function ensureBotProfile(deps: BotProfileDeps): Promise<BotProfileSync> {
  if (!deps.config?.botToken) return { status: "disabled" };
  const config = deps.config;
  const version = botProfileVersion(config.botToken);
  const now = deps.now ?? Date.now;

  if (!deps.force) {
    if (syncedVersion === version) return { status: "current", version };
    if (
      !deps.retryNow &&
      failure &&
      failure.version === version &&
      now() - failure.at < BOT_PROFILE_RETRY_MS
    ) {
      return { status: "backoff", version };
    }
    if (inflight && inflight.version === version) return inflight.promise;
  }

  const promise = run({ ...deps, config }, version).catch((): BotProfileSync => {
    failure = { version, at: now() };
    console.warn("[telegram-login] perfil del bot sin sincronizar: unexpected");
    return { status: "failed", version, stage: "unexpected" };
  });
  inflight = { version, promise };
  try {
    return await promise;
  } finally {
    if (inflight?.promise === promise) inflight = null;
  }
}

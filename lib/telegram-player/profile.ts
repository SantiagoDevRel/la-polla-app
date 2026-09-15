// lib/telegram-player/profile.ts — Perfil desde Telegram: nombre, pollito y
// cuenta para recibir premios. Mismas reglas que /onboarding y PATCH
// /api/users/me (lib/users/needs-name.ts, POLLITO_TYPES, métodos de Casa).
//
// Toda escritura va a public.users filtrada por el user_id de la cuenta
// vinculada a este Telegram (service_role; ver el TODO de auth.uid()).

import { isValidDisplayName, needsName } from "@/lib/users/needs-name";
import { POLLITO_TYPES } from "@/lib/pollitos";
import { maskPhone } from "@/lib/auth/telegram-login/mask-phone";
import { cb } from "./ids";
import { COPY } from "./copy";
import { clearFlow, esc, sendScreen, sendWelcome, setFlow, show, type PlayerCtx, type Screen } from "./context";

export interface PlayerProfile {
  display_name: string | null;
  avatar_url: string | null;
  default_payout_method: string | null;
  default_payout_account: string | null;
  default_payout_account_name: string | null;
  default_payout_account_type: string | null;
}

const PROFILE_COLUMNS =
  "display_name, avatar_url, default_payout_method, default_payout_account, default_payout_account_name, default_payout_account_type";

export async function readProfile(ctx: PlayerCtx): Promise<PlayerProfile | null> {
  const { data, error } = await ctx.db.from("users").select(PROFILE_COLUMNS).eq("id", ctx.account.userId).maybeSingle();
  if (error) {
    console.warn("[telegram-player] perfil no leído:", error.code);
    return null;
  }
  return (data as PlayerProfile | null) ?? null;
}

export function profileComplete(profile: PlayerProfile | null): boolean {
  return Boolean(profile && !needsName(profile.display_name) && profile.avatar_url);
}

function pollitoLabel(id: string | null): string {
  return POLLITO_TYPES.find((p) => p.id === id)?.label ?? "Sin elegir";
}

export function pollitoPicker(onboarding: boolean): Screen {
  const rows = [];
  for (let i = 0; i < POLLITO_TYPES.length; i += 2) {
    rows.push(
      POLLITO_TYPES.slice(i, i + 2).map((p) => ({
        text: p.label,
        callback_data: onboarding ? cb("pa", p.id, "o") : cb("pa", p.id),
      })),
    );
  }
  if (!onboarding) rows.push([{ text: "⬅️ Volver al perfil", callback_data: "pf" }]);
  return { text: onboarding ? COPY.pollitoOnboarding : COPY.pollitoChange, buttons: rows };
}

/**
 * Si al perfil le falta algo, pide ese paso y devuelve false. Mismo gate que el
 * middleware de la web: sin nombre real y pollito no se juega.
 */
export async function ensureProfile(ctx: PlayerCtx, profile?: PlayerProfile | null): Promise<boolean> {
  const current = profile === undefined ? await readProfile(ctx) : profile;
  if (profileComplete(current)) return true;
  if (!current || needsName(current.display_name)) {
    await setFlow(ctx, "name", { onb: true });
    await sendScreen(ctx, { text: COPY.askName });
    return false;
  }
  await clearFlow(ctx);
  await show(ctx, pollitoPicker(true));
  return false;
}

export async function handleNameInput(ctx: PlayerCtx, text: string): Promise<void> {
  const onboarding = ctx.chat.flow?.data.onb === true;
  const name = text.replace(/\s+/g, " ").trim();
  if (!isValidDisplayName(name)) {
    await sendScreen(ctx, { text: COPY.invalidName });
    return;
  }
  const { error } = await ctx.db.from("users").update({ display_name: name }).eq("id", ctx.account.userId);
  if (error) {
    console.warn("[telegram-player] nombre no guardado:", error.code);
    await sendScreen(ctx, { text: COPY.failure });
    return;
  }
  await clearFlow(ctx);
  const profile = await readProfile(ctx);
  if (onboarding || !profile?.avatar_url) {
    if (!profile?.avatar_url) {
      await sendScreen(ctx, pollitoPicker(true));
      return;
    }
    await sendWelcome(ctx, name);
    return;
  }
  await sendScreen(ctx, { text: `✅ Listo, ahora apareces como <b>${esc(name)}</b>.` });
  await sendScreen(ctx, profileScreen(profile, ctx.account.phoneE164));
}

export async function handlePollitoPick(ctx: PlayerCtx, pollitoId: string, onboarding: boolean): Promise<void> {
  const pollito = POLLITO_TYPES.find((p) => p.id === pollitoId);
  if (!pollito) {
    await show(ctx, pollitoPicker(onboarding));
    return;
  }
  const { error } = await ctx.db.from("users").update({ avatar_url: pollito.id }).eq("id", ctx.account.userId);
  if (error) {
    console.warn("[telegram-player] pollito no guardado:", error.code);
    await show(ctx, { text: COPY.failure });
    return;
  }
  const profile = await readProfile(ctx);
  if (!profile || needsName(profile.display_name)) {
    await ensureProfile(ctx, profile);
    return;
  }
  if (onboarding) {
    await show(ctx, { text: `✅ Elegiste el pollito de <b>${esc(pollito.label)}</b>.` });
    await sendWelcome(ctx, profile.display_name);
    return;
  }
  await show(ctx, profileScreen(profile, ctx.account.phoneE164, `✅ Tu pollito ahora es el de <b>${esc(pollito.label)}</b>.`));
}

function maskAccount(account: string | null): string {
  if (!account) return "";
  const digits = account.replace(/\D/g, "");
  return digits.length >= 4 ? `••••${digits.slice(-4)}` : "••••";
}

function payoutSummary(profile: PlayerProfile): string {
  if (!profile.default_payout_method || !profile.default_payout_account) return "Sin registrar";
  const method = profile.default_payout_method === "nequi" ? "Nequi" : profile.default_payout_method === "bancolombia" ? "Bancolombia" : "Otra cuenta";
  return `${method} ${maskAccount(profile.default_payout_account)}`;
}

export function profileScreen(profile: PlayerProfile, phoneE164: string, notice?: string): Screen {
  return {
    text: [
      notice ? `${notice}\n` : null,
      "<b>Tu perfil</b>",
      "",
      `Nombre: <b>${esc(profile.display_name)}</b>`,
      `Pollito: ${esc(pollitoLabel(profile.avatar_url))}`,
      `Celular: ${esc(maskPhone(phoneE164))}`,
      `Cuenta para recibir premios: ${esc(payoutSummary(profile))}`,
    ].filter((l) => l !== null).join("\n"),
    buttons: [
      [{ text: "✏️ Cambiar nombre", callback_data: "pn" }],
      [{ text: "🐥 Cambiar pollito", callback_data: "pc" }],
      [{ text: "💰 Cuenta para recibir premios", callback_data: "pay" }],
      [{ text: "🌐 Entrar a la página web", callback_data: "web" }],
    ],
  };
}

export async function showProfile(ctx: PlayerCtx, notice?: string): Promise<void> {
  const profile = await readProfile(ctx);
  if (!profile) {
    await show(ctx, { text: COPY.failure });
    return;
  }
  await show(ctx, profileScreen(profile, ctx.account.phoneE164, notice));
}

export async function startNameChange(ctx: PlayerCtx): Promise<void> {
  await setFlow(ctx, "name", { onb: false });
  await show(ctx, { text: COPY.askNameChange, buttons: [[{ text: "❌ Cancelar", callback_data: "pf" }]] });
}

// ── Cuenta para recibir premios ─────────────────────────────────────────────
// Orden a propósito: método → tipo → titular → número. El número de cuenta es
// la ÚLTIMA respuesta y va directo a users: nunca queda en el estado del chat.

export async function showPayoutMethods(ctx: PlayerCtx): Promise<void> {
  await clearFlow(ctx);
  await show(ctx, {
    text: [
      "<b>Cuenta para recibir premios</b>",
      "",
      "Si ganas, te enviamos el dinero a esta cuenta. ¿Dónde quieres recibirlo?",
    ].join("\n"),
    buttons: [
      [{ text: "Nequi", callback_data: "po:n" }, { text: "Bancolombia", callback_data: "po:b" }],
      [{ text: "⬅️ Volver al perfil", callback_data: "pf" }],
    ],
  });
}

export async function choosePayoutMethod(ctx: PlayerCtx, method: string): Promise<void> {
  if (method === "n") {
    await setFlow(ctx, "pay_account", { m: "nequi" });
    await show(ctx, {
      text: "Escribe el número de celular de tu cuenta Nequi (10 dígitos, sin espacios).",
      buttons: [[{ text: "❌ Cancelar", callback_data: "pf" }]],
    });
    return;
  }
  await clearFlow(ctx);
  await show(ctx, {
    text: "¿Tu cuenta Bancolombia es de ahorros o corriente?",
    buttons: [
      [{ text: "Ahorros", callback_data: "pt:a" }, { text: "Corriente", callback_data: "pt:c" }],
      [{ text: "❌ Cancelar", callback_data: "pf" }],
    ],
  });
}

export async function choosePayoutType(ctx: PlayerCtx, type: string): Promise<void> {
  await setFlow(ctx, "pay_name", { m: "bancolombia", t: type === "c" ? "corriente" : "ahorros" });
  await show(ctx, {
    text: "Escribe el nombre del titular de la cuenta, tal como aparece en el banco.",
    buttons: [[{ text: "❌ Cancelar", callback_data: "pf" }]],
  });
}

export async function handlePayoutName(ctx: PlayerCtx, text: string): Promise<void> {
  const name = text.replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 120 || /^\+?\d+$/.test(name)) {
    await sendScreen(ctx, { text: "Escribe el nombre completo del titular (de 2 a 120 letras)." });
    return;
  }
  const flow = ctx.chat.flow!;
  await setFlow(ctx, "pay_account", { m: "bancolombia", t: String(flow.data.t ?? "ahorros"), n: name });
  await sendScreen(ctx, { text: "Ahora escribe el número de la cuenta Bancolombia (solo números).", buttons: [[{ text: "❌ Cancelar", callback_data: "pf" }]] });
}

export async function handlePayoutAccount(ctx: PlayerCtx, text: string): Promise<void> {
  const flow = ctx.chat.flow!;
  const method = flow.data.m === "bancolombia" ? "bancolombia" : "nequi";
  const digits = text.replace(/[\s.-]/g, "");
  const valid = method === "nequi" ? /^3\d{9}$/.test(digits) : /^\d{6,20}$/.test(digits);
  if (!valid) {
    await sendScreen(ctx, {
      text: method === "nequi"
        ? "Ese número no parece un celular de Nequi. Escribe los 10 dígitos, empezando por 3."
        : "Ese número de cuenta no es válido. Escribe solo los números de la cuenta.",
    });
    return;
  }
  const update = {
    default_payout_method: method,
    default_payout_account: digits,
    default_payout_account_name: method === "nequi" ? null : String(flow.data.n ?? "").slice(0, 120) || null,
    default_payout_account_type: method === "nequi" ? null : flow.data.t === "corriente" ? "corriente" : "ahorros",
    default_payout_set_at: new Date(ctx.now()).toISOString(),
  };
  const { error } = await ctx.db.from("users").update(update).eq("id", ctx.account.userId);
  if (error) {
    console.warn("[telegram-player] cuenta de premios no guardada:", error.code);
    await sendScreen(ctx, { text: COPY.failure });
    return;
  }
  await clearFlow(ctx);
  const profile = await readProfile(ctx);
  if (profile) await sendScreen(ctx, profileScreen(profile, ctx.account.phoneE164, "✅ Guardamos tu cuenta para recibir premios."));
}

// lib/telegram-player/handler.ts — Entrada del bot PÚBLICO de Telegram: login a
// la web + app para jugadores.
//
// Reparto:
//   - Contacto compartido, "/start <nonce>" (viene de /login) y "/login": los
//     atiende el flujo de login sin cambios (lib/auth/telegram-login/handler.ts).
//     Si el contacto llega sin solicitud del navegador, la cuenta queda creada o
//     vinculada con las mismas reglas y el bot sigue con perfil y menú.
//   - Cuenta de Telegram SIN vínculo: cualquier otra cosa pide «Compartir mi
//     número» (la única prueba de propiedad del teléfono que aceptamos).
//   - Cuenta vinculada: menú, pollas, inscripción, comprobante, pronósticos,
//     tabla, reglas, pagos y perfil.
//
// Seguridad:
//   - La identidad es SIEMPRE la cuenta vinculada a from.id (telegram_login_
//     linked_accounts), resuelta en cada update. Nada del texto ni de los
//     botones elige a qué cuenta se escribe.
//   - callback_data es dato no confiable: ids con formato estricto y validados
//     otra vez contra la base (polla visible, partido de esa polla, etc.).
//   - Toda escritura pasa por las funciones de Casa que usa la web.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { LoginBotClient } from "@/lib/auth/telegram-login/bot-api";
import type { TelegramLoginConfig } from "@/lib/auth/telegram-login/config";
import { handleLoginUpdate, type LoginHandlerDeps, type LoginHandlerOutcome } from "@/lib/auth/telegram-login/handler";
import { linkedAccountFor, type LoginGrant } from "@/lib/auth/telegram-login/requests";
import type { LoginLocale } from "@/lib/auth/telegram-login/update";
import { normalizePhone } from "@/lib/auth/phone";
import { redactId } from "@/lib/log";
import { COPY, homeButtons, isBareStart, isLoginIntent, MENU_LABELS, menuCommandOf } from "./copy";
import {
  answerCallback,
  clearFlow,
  readPlayerChat,
  sendScreen,
  sendHome,
  sendWelcome,
  show,
  type PlayerCtx,
} from "./context";
import { classifyPlayerUpdate, type PlayerUpdate } from "./update";
import {
  choosePayoutMethod,
  choosePayoutType,
  ensureProfile,
  handleNameInput,
  handlePayoutAccount,
  handlePayoutName,
  handlePollitoPick,
  pollitoPicker,
  readProfile,
  showPayoutMethods,
  showProfile,
  startNameChange,
} from "./profile";
import {
  loadVisiblePolla,
  showHelp,
  showInfo,
  showMyPollas,
  showOpenPollas,
  showPayments,
  showPollaDetail,
  showTable,
} from "./pollas";
import {
  askProofPolla,
  askTicketNumber,
  handleTicketInput,
  proofForPickedPolla,
  randomTicket,
  receiveProofFromFlow,
  resumeTicket,
  startJoin,
  startRaffle,
} from "./entry";
import {
  chooseHomeGoals,
  editMatch,
  editQuestion,
  handleAnswerText,
  handleScoreText,
  listAnswers,
  listPicks,
  save1x2,
  saveOption,
  saveScore,
  skipMatch,
  skipQuestion,
  startPicks,
  startQuestions,
} from "./picks";
import { cb, NEW_MESSAGE_MARK } from "./ids";

export interface PlayerBotDeps {
  config: TelegramLoginConfig;
  db: SupabaseClient;
  bot: LoginBotClient;
  env?: Record<string, string | undefined>;
  now?: () => number;
}

export type PlayerOutcome = LoginHandlerOutcome | "player";

type CallbackUpdate = Extract<PlayerUpdate, { kind: "callback" }>;
type MessageUpdate = Extract<PlayerUpdate, { kind: "message" }>;

function buildCtx(
  deps: PlayerBotDeps,
  base: { chatId: number; telegramUserId: number; userId: string; phoneE164: string; editMessageId: number | null },
  chat: PlayerCtx["chat"],
): PlayerCtx {
  return {
    config: deps.config,
    db: deps.db,
    bot: deps.bot,
    env: deps.env ?? process.env,
    now: deps.now ?? Date.now,
    chatId: base.chatId,
    telegramUserId: base.telegramUserId,
    account: { userId: base.userId, phoneE164: base.phoneE164 },
    chat,
    editMessageId: base.editMessageId,
  };
}

function loginDepsFor(deps: PlayerBotDeps): LoginHandlerDeps {
  return {
    config: deps.config,
    db: deps.db,
    send: deps.bot.send,
    env: deps.env,
    now: deps.now,
    onLinked: (input) => welcomeLinked(deps, input),
  };
}

/** Un update de login sintético (sin texto especial) para pedir el número o emitir el enlace. */
function syntheticMessage(telegramUserId: number, text: string) {
  return {
    update_id: 0,
    message: {
      message_id: 0,
      date: 0,
      chat: { id: telegramUserId, type: "private" },
      from: { id: telegramUserId, is_bot: false },
      text,
    },
  };
}

/** Contacto nuevo sin solicitud del navegador: bienvenida, perfil y menú. */
async function welcomeLinked(
  deps: PlayerBotDeps,
  input: { chatId: number; telegramUserId: number; grant: LoginGrant; locale: LoginLocale },
): Promise<LoginHandlerOutcome> {
  const now = deps.now ?? Date.now;
  // Igual que el login por SMS y lib/auth/phone-session.ts: public.users
  // guarda el teléfono sin "+". Mejor esfuerzo (la columna es única).
  const { error: phoneError } = await deps.db
    .from("users")
    .update({ whatsapp_number: normalizePhone(input.grant.phoneE164), whatsapp_verified: true })
    .eq("id", input.grant.userId);
  if (phoneError) console.warn("[telegram-player] teléfono no sincronizado:", phoneError.code);

  // Quita el teclado «Compartir mi número» (un mensaje admite un solo teclado).
  const sent = await deps.bot.send("sendMessage", {
    chat_id: input.chatId,
    text: COPY.numberConfirmed,
    parse_mode: "HTML",
    reply_markup: { remove_keyboard: true },
  });
  await deps.db.from("telegram_login_chats").upsert(
    {
      telegram_user_id: input.telegramUserId,
      locale: input.locale,
      pending_request_id: null,
      updated_at: new Date(now()).toISOString(),
      ...(sent ? { reply_keyboard_open: false } : {}),
    },
    { onConflict: "telegram_user_id" },
  );

  const chat = await readPlayerChat(deps.db, input.telegramUserId, now());
  const ctx = buildCtx(deps, {
    chatId: input.chatId,
    telegramUserId: input.telegramUserId,
    userId: input.grant.userId,
    phoneE164: input.grant.phoneE164,
    editMessageId: null,
  }, chat);
  const profile = await readProfile(ctx);
  if (await ensureProfile(ctx, profile)) {
    await sendWelcome(ctx, profile?.display_name ?? null);
  }
  return "linked";
}

export async function handleTelegramUpdate(update: unknown, deps: PlayerBotDeps): Promise<PlayerOutcome> {
  const now = deps.now ?? Date.now;
  const loginDeps = loginDepsFor(deps);
  const action = classifyPlayerUpdate(update);
  if (action.kind === "ignore") return "ignored";

  if (action.kind === "message" && (action.hasContact || isLoginIntent(action.text))) {
    return handleLoginUpdate(update, loginDeps);
  }

  if (action.kind === "callback") await answerCallback(deps, action.callbackId);

  const linked = await linkedAccountFor(deps.db, action.telegramUserId);
  if (linked.kind === "error") {
    console.error("[telegram-player] lectura de vínculo falló:", redactId(String(action.telegramUserId)));
    await deps.bot.send("sendMessage", { chat_id: action.chatId, text: COPY.failure });
    return "failed";
  }
  if (linked.kind !== "linked") {
    // Primera vez: se presenta el servicio en el mismo mensaje que pide el número.
    const promptLead = action.kind === "callback" || isBareStart(action.text) ? COPY.intro : undefined;
    return handleLoginUpdate(
      action.kind === "message" ? update : syntheticMessage(action.telegramUserId, ""),
      { ...loginDeps, promptLead },
    );
  }

  // «!» al inicio: la pantalla va en un mensaje nuevo (ids.ts, cbNew).
  const newMessage = action.kind === "callback" && action.data.startsWith(NEW_MESSAGE_MARK);
  const routed = newMessage && action.kind === "callback" ? { ...action, data: action.data.slice(NEW_MESSAGE_MARK.length) } : action;
  const chat = await readPlayerChat(deps.db, action.telegramUserId, now());
  const ctx = buildCtx(deps, {
    chatId: action.chatId,
    telegramUserId: action.telegramUserId,
    userId: linked.userId,
    phoneE164: linked.phoneE164,
    editMessageId: action.kind === "callback" && !newMessage ? action.messageId : null,
  }, chat);

  try {
    if (routed.kind === "callback") await routeCallback(ctx, routed, loginDeps);
    else await routeMessage(ctx, routed, loginDeps);
    return "player";
  } catch (err) {
    console.error("[telegram-player] update falló:", redactId(ctx.account.userId), (err as Error).message);
    ctx.editMessageId = null;
    await sendScreen(ctx, { text: COPY.failure }).catch(() => null);
    return "failed";
  }
}

/** Enlace de un solo uso para entrar a la web (el mismo del login). */
async function webLink(ctx: PlayerCtx, loginDeps: LoginHandlerDeps): Promise<void> {
  await handleLoginUpdate(syntheticMessage(ctx.telegramUserId, "/login"), loginDeps);
}

function homeScreen() {
  return { text: COPY.home, buttons: homeButtons() };
}

async function routeMessage(ctx: PlayerCtx, message: MessageUpdate, loginDeps: LoginHandlerDeps): Promise<void> {
  const flow = ctx.chat.flow;
  // Escribiendo un nombre o una respuesta libre, «Pagos» o «Hola» son texto:
  // solo cuentan como menú los botones de abajo y los comandos con «/».
  const command = menuCommandOf(message.text, { strict: flow?.name === "answer" || flow?.name === "name" });

  if (command === "web") return webLink(ctx, loginDeps);
  if (command === "cancelar") {
    await clearFlow(ctx);
    await sendHome(ctx, `${COPY.cancelled}

${COPY.home}`);
    return;
  }
  if (command) {
    // Moverse por el menú descarta lo que se estaba escribiendo, salvo el
    // comprobante: la persona puede mirar «Mis pagos» y volver con la foto.
    if (flow && flow.name !== "proof") await clearFlow(ctx);
    const profile = await readProfile(ctx);
    if (!(await ensureProfile(ctx, profile))) return;
    switch (command) {
      // /start y «menú»: la bienvenida explica para qué sirve cada botón.
      case "home": return sendWelcome(ctx, profile?.display_name ?? null);
      case "abiertas": return showOpenPollas(ctx);
      case "mias": return showMyPollas(ctx);
      case "pagos": return showPayments(ctx);
      case "perfil": return showProfile(ctx);
      case "ayuda": return showHelp(ctx);
    }
  }

  if (message.photo) {
    if (flow?.name === "proof") return receiveProofFromFlow(ctx, message.photo);
    if (!(await ensureProfile(ctx))) return;
    return askProofPolla(ctx, message.photo);
  }
  if (message.otherMedia) {
    await sendHome(ctx, COPY.onlyImages);
    return;
  }
  const text = message.text;
  if (!text) return;

  if (flow?.name === "name") return handleNameInput(ctx, text);
  if (!(await ensureProfile(ctx))) return;

  switch (flow?.name) {
    case "ticket": return handleTicketInput(ctx, text);
    case "score":
      if (await handleScoreText(ctx, text)) return;
      await sendScreen(ctx, { text: "Escribe el marcador así: <b>2-1</b> (primero los goles del equipo local), o usa los botones del partido." });
      return;
    case "answer": return handleAnswerText(ctx, text);
    case "pay_name": return handlePayoutName(ctx, text);
    case "pay_account": return handlePayoutAccount(ctx, text);
    case "proof":
      await sendScreen(ctx, {
        text: "Estoy esperando la <b>foto del comprobante</b>. Toca el clip 📎, elige la imagen y envíala. Si no vas a pagar ahora, toca Cancelar.",
        buttons: [[{ text: "❌ Cancelar", callback_data: "cx" }]],
      });
      return;
  }
  await sendHome(ctx, COPY.notUnderstood);
}

/** Botones que no necesitan perfil completo (terminarlo, ayuda, web). */
const NO_PROFILE_OPS = new Set(["pa", "web", "hp", "cx"]);
const POLLA_OPS = new Set(["p", "j", "rb", "rr", "rw", "rt", "pk", "x", "h", "s", "sk", "e", "ls", "q", "qs", "qe", "la", "tb", "if", "ph"]);

/**
 * Botones que continúan cada paso de texto. Cualquier otro botón lo abandona:
 * si no, un texto escrito mucho después («ok listo») terminaría guardado como
 * respuesta, marcador o nombre. El comprobante se conserva al navegar (la
 * persona puede revisar la polla y volver con la foto).
 */
const FLOW_CALLBACKS: Record<string, ReadonlySet<string>> = {
  name: new Set(["pn", "pa"]),
  score: new Set(["h", "s", "e", "sk"]),
  answer: new Set(["qs", "qe"]),
  ticket: new Set(["rw"]),
  pay_name: new Set(["pt"]),
  pay_account: new Set(["po", "pt"]),
  photo_pick: new Set(["ph"]),
};

async function routeCallback(ctx: PlayerCtx, query: CallbackUpdate, loginDeps: LoginHandlerDeps): Promise<void> {
  const [op, a, b, c, d] = query.data.split(":");
  const flow = ctx.chat.flow;
  if (flow && flow.name !== "proof" && !FLOW_CALLBACKS[flow.name]?.has(op)) await clearFlow(ctx);
  if (!NO_PROFILE_OPS.has(op) && !(await ensureProfile(ctx))) return;

  switch (op) {
    case "m": return show(ctx, homeScreen());
    case "ol": return showOpenPollas(ctx, Number(a) || 0);
    case "ml": return showMyPollas(ctx, Number(a) || 0);
    case "pg": return showPayments(ctx);
    case "hp": return showHelp(ctx);
    case "web": return webLink(ctx, loginDeps);
    case "pf":
      if (ctx.chat.flow && ctx.chat.flow.name !== "proof") await clearFlow(ctx);
      return showProfile(ctx);
    case "pn": return startNameChange(ctx);
    case "pc": return show(ctx, pollitoPicker(false));
    case "pa": return handlePollitoPick(ctx, a ?? "", b === "o");
    case "pay": return showPayoutMethods(ctx);
    case "po": return choosePayoutMethod(ctx, a ?? "");
    case "pt": return choosePayoutType(ctx, a ?? "");
    case "qo": return saveOption(ctx, a, b);
    case "cx": {
      await clearFlow(ctx);
      const polla = a ? await loadVisiblePolla(a) : null;
      if (polla) return showPollaDetail(ctx, polla, COPY.cancelled);
      return show(ctx, { ...homeScreen(), text: `${COPY.cancelled}\n\n${COPY.home}` });
    }
  }

  if (!POLLA_OPS.has(op)) {
    await show(ctx, { ...homeScreen(), text: `${COPY.expiredButton}\n\n${COPY.home}` });
    return;
  }
  const polla = await loadVisiblePolla(a);
  if (!polla) {
    await show(ctx, {
      text: "Esa polla ya no está disponible.",
      buttons: [[{ text: MENU_LABELS.abiertas, callback_data: cb("ol", 0) }, { text: MENU_LABELS.mias, callback_data: cb("ml", 0) }]],
    });
    return;
  }
  const isRaffle = polla.kind === "rifa";
  const isMatches = polla.kind === "partidos";
  const isManual = polla.kind === "manual";

  switch (op) {
    case "p": return showPollaDetail(ctx, polla);
    case "j": return startJoin(ctx, polla);
    case "ph": return proofForPickedPolla(ctx, a);
    case "tb": return showTable(ctx, polla);
    case "if": return showInfo(ctx, polla);
    case "ls": return isManual ? listAnswers(ctx, polla) : isMatches ? listPicks(ctx, polla) : showPollaDetail(ctx, polla);
    case "la": return isManual ? listAnswers(ctx, polla) : showPollaDetail(ctx, polla);
    case "pk": return startPicks(ctx, polla);
  }
  if (isRaffle) {
    switch (op) {
      case "rb": return startRaffle(ctx, polla);
      case "rr": return randomTicket(ctx, polla);
      case "rw": return askTicketNumber(ctx, polla);
      case "rt": return resumeTicket(ctx, polla, Number(b));
    }
  }
  if (isMatches) {
    switch (op) {
      case "x": return save1x2(ctx, polla, b, c);
      case "h": return chooseHomeGoals(ctx, polla, b, c);
      case "s": return saveScore(ctx, polla, b, c, d);
      case "sk": return skipMatch(ctx, polla, b);
      case "e": return editMatch(ctx, polla, b);
    }
  }
  if (isManual) {
    switch (op) {
      case "q": return startQuestions(ctx, polla);
      case "qs": return skipQuestion(ctx, polla, b);
      case "qe": return editQuestion(ctx, polla, b);
    }
  }
  await showPollaDetail(ctx, polla, COPY.expiredButton);
}

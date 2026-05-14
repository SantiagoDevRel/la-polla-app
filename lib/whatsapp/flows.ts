// lib/whatsapp/flows.ts — All WhatsApp bot conversation flows
// Colombian parcero Spanish + rich formatting + interactive messages
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTextMessage } from "./bot";
import {
  sendReplyButtons,
  sendListMessage,
  sendCTAButton,
} from "./interactive";
import { clearState, setState } from "./state";
import { formatTablaWA } from "./tabla";
import { shortMatchTitle } from "./format";
import { ensureMatchesFresh } from "@/lib/matches/ensure-fresh";
import { joinByCode } from "@/lib/pollas/join";
import { validateJoinCodeFormat } from "@/lib/pollas/join-code";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim() || "https://lapollacolombiana.com";
const FOOTER = "La Polla Colombiana 🐥";
const PAGE_SIZE = 9; // leave 1 slot in the 10-row list for "Ver más partidos"

const TRN_LABELS: Record<string, string> = {
  worldcup_2026: "Mundial 2026 🏆",
  champions_2025: "Champions 2024-25 ⚽",
  liga_betplay_2025: "BetPlay 2025 🇨🇴",
};

// ─── Team flag emojis ───
// Keys are lowercased + trimmed for robust matching against openfootball /
// football-data.org team names, which vary in whitespace, accents and
// abbreviations (e.g. "Cape Verde Islands" vs "Cape Verde Isla").
const TEAM_FLAG_MAP: Record<string, string> = {
  "mexico": "🇲🇽",
  "south africa": "🇿🇦",
  "brazil": "🇧🇷",
  "argentina": "🇦🇷",
  "france": "🇫🇷",
  "germany": "🇩🇪",
  "spain": "🇪🇸",
  "england": "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
  "portugal": "🇵🇹",
  "netherlands": "🇳🇱",
  "belgium": "🇧🇪",
  "italy": "🇮🇹",
  "uruguay": "🇺🇾",
  "colombia": "🇨🇴",
  "chile": "🇨🇱",
  "ecuador": "🇪🇨",
  "peru": "🇵🇪",
  "paraguay": "🇵🇾",
  "bolivia": "🇧🇴",
  "venezuela": "🇻🇪",
  "usa": "🇺🇸",
  "united states": "🇺🇸",
  "canada": "🇨🇦",
  "japan": "🇯🇵",
  "south korea": "🇰🇷",
  "korea republic": "🇰🇷",
  "australia": "🇦🇺",
  "morocco": "🇲🇦",
  "senegal": "🇸🇳",
  "nigeria": "🇳🇬",
  "ghana": "🇬🇭",
  "cameroon": "🇨🇲",
  "tunisia": "🇹🇳",
  "saudi arabia": "🇸🇦",
  "iran": "🇮🇷",
  "qatar": "🇶🇦",
  "poland": "🇵🇱",
  "croatia": "🇭🇷",
  "denmark": "🇩🇰",
  "switzerland": "🇨🇭",
  "serbia": "🇷🇸",
  "czech republic": "🇨🇿",
  "czechia": "🇨🇿",
  "slovakia": "🇸🇰",
  "ukraine": "🇺🇦",
  "hungary": "🇭🇺",
  "turkey": "🇹🇷",
  "romania": "🇷🇴",
  "scotland": "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
  "wales": "🏴󠁧󠁢󠁷󠁬󠁳󠁿",
  "ireland": "🇮🇪",
  "bosnia & herzegovina": "🇧🇦",
  "bosnia-herzegovina": "🇧🇦",
  "bosnia and herzegovina": "🇧🇦",
  "ivory coast": "🇨🇮",
  "cote d'ivoire": "🇨🇮",
  "haiti": "🇭🇹",
  "panama": "🇵🇦",
  "costa rica": "🇨🇷",
  "honduras": "🇭🇳",
  "guatemala": "🇬🇹",
  "jamaica": "🇯🇲",
  "new zealand": "🇳🇿",
  "indonesia": "🇮🇩",
  "thailand": "🇹🇭",
  "cape verde islands": "🇨🇻",
  "cape verde isla": "🇨🇻",
  "cape verde": "🇨🇻",
  "curaçao": "🇨🇼",
  "curacao": "🇨🇼",
  "cuba": "🇨🇺",
  "trinidad": "🇹🇹",
  "trinidad and tobago": "🇹🇹",
};

function getTeamFlag(teamName: string): string {
  if (!teamName) return "⚽";
  const key = teamName.trim().toLowerCase();
  return TEAM_FLAG_MAP[key] || "⚽";
}

function formatMatchLabel(homeTeam: string, awayTeam: string): string {
  return `${getTeamFlag(homeTeam)} ${homeTeam} vs ${getTeamFlag(awayTeam)} ${awayTeam}`;
}

// ─── Helpers ───

interface PollaRow {
  id: string;
  name: string;
  slug: string;
  tournament: string;
  status: string;
  type: string;
  payment_mode: string;
  buy_in_amount: number;
  match_ids: string[] | null;
}

interface ParticipantRow {
  id: string;
  role: string;
  status: string;
  payment_status: string;
  total_points: number;
  rank: number | null;
}

/**
 * Verify the user is an approved participant of the polla AND, for
 * admin_collects pollas, has paid=true. Sends the appropriate Spanish message
 * and returns null if any gate fails. Returns {polla, participant} on success.
 */
async function verifyMemberAndPolla(
  phone: string,
  userId: string,
  pollaId: string
): Promise<{ polla: PollaRow; participant: ParticipantRow } | null> {
  const supabase = createAdminClient();

  const { data: polla } = await supabase
    .from("pollas")
    .select("id, name, slug, tournament, status, type, payment_mode, buy_in_amount, match_ids")
    .eq("id", pollaId)
    .single();

  if (!polla) {
    await sendTextMessage(phone, "🤔 Parce, no encontré esa polla.");
    return null;
  }

  const { data: participant } = await supabase
    .from("polla_participants")
    .select("id, role, status, payment_status, paid, total_points, rank")
    .eq("polla_id", pollaId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!participant || participant.status !== "approved") {
    await sendTextMessage(phone, "No eres participante de esta polla parce.");
    return null;
  }

  // Payment gate only applies to admin_collects pollas that actually charge
  // a buy-in. A free polla (buy_in = 0) has nothing to collect, so gating it
  // on participant.paid would lock the player out forever.
  if (
    polla.payment_mode === "admin_collects" &&
    Number(polla.buy_in_amount) > 0 &&
    !participant.paid
  ) {
    await sendTextMessage(
      phone,
      "Tu pago aún no ha sido aprobado por el organizador. Esperá a que confirme y volvé a intentar."
    );
    return null;
  }

  return { polla: polla as PollaRow, participant: participant as ParticipantRow };
}

// ─── FLOW 1: Main Menu ───

// Entry point UX: go straight to the list of the user's pollas. The old
// top-level three-button menu (Mis Pollas / Pronosticar / Ver Tabla) was
// redundant because every path eventually required picking a polla, so
// we short-circuit to the polla list. Signature preserved for existing
// call sites; displayName is no longer used here.
export async function handleMainMenu(
  phone: string,
  _displayName: string,
  userId?: string
) {
  void _displayName;
  if (userId) {
    await handleMisPollas(phone, userId);
    return;
  }
  const supabase = createAdminClient();
  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("whatsapp_number", phone)
    .maybeSingle();
  if (!user?.id) return;
  await handleMisPollas(phone, user.id);
}

// ─── FLOW 2: Mis Pollas ───
//
// Onboarding for unknown phones lives entirely in router.ts → routeOnboarding
// + lib/whatsapp/onboarding.ts. The account is created find-or-create style
// in handleNameConfirmed once the user confirms their name — see those files.

export async function handleMisPollas(phone: string, userId: string) {
  const supabase = createAdminClient();

  const { data: participations } = await supabase
    .from("polla_participants")
    .select("polla_id, total_points, rank, role, status")
    .eq("user_id", userId)
    .eq("status", "approved");

  if (!participations || participations.length === 0) {
    // Asumimos intent: si el user llegó aquí, quiere unirse a una polla.
    // Pedimos el código directo y seteamos state waiting_join_code para
    // que el bareCode handler salte el SI/NO y una de una. Ahorramos 2
    // mensajes (el botón "Unirme con código" + el SI/NO de confirm).
    await setState(phone, { action: "waiting_join_code" });
    await sendTextMessage(
      phone,
      "Todavía no estás en ninguna polla 🐣\n\n" +
        "Mándame el *código de 6 caracteres* de la polla a la que te invitaron y te uno enseguida 🐥",
    );
    return;
  }

  const pollaIds = participations.map((p) => p.polla_id);

  const { data: pollas } = await supabase
    .from("pollas")
    .select("id, name, tournament, status")
    .in("id", pollaIds)
    .eq("status", "active");

  if (!pollas || pollas.length === 0) {
    // Tus pollas anteriores cerraron. Mismo patrón: asumimos intent +
    // setState waiting_join_code para que un código bare se procese
    // directo sin pedir confirm.
    await setState(phone, { action: "waiting_join_code" });
    await sendTextMessage(
      phone,
      "😴 No tienes pollas activas en este momento parce.\n\n" +
        "Si te invitaron a una polla nueva, mándame el *código de 6 caracteres* y te uno 🐥",
    );
    return;
  }

  // Count participants per polla
  const { data: participantCounts } = await supabase
    .from("polla_participants")
    .select("polla_id")
    .in("polla_id", pollaIds);

  const countMap = new Map<string, number>();
  participantCounts?.forEach((p) => {
    countMap.set(p.polla_id, (countMap.get(p.polla_id) || 0) + 1);
  });

  // Reply buttons (max 3, auto-send on tap) beat lists (require a confirm
  // step) for the common case of 1-3 pollas. Beyond that, fall back to
  // the scrollable list.
  if (pollas.length <= 3) {
    await sendReplyButtons(
      phone,
      "Tus pollas activas parce 👇 Tocá una para abrirla.",
      pollas.map((polla) => ({
        id: `polla_${polla.id}`,
        // Reply-button title cap is 20 chars — name alone, with a graceful
        // truncate. Stats live in the message body for compactness.
        title:
          polla.name.length <= 20
            ? polla.name
            : polla.name.slice(0, 19) + "…",
      })),
      "Tus Pollas",
      FOOTER,
    );
    return;
  }

  const rows = pollas.map((polla) => {
    const p = participations.find((pp) => pp.polla_id === polla.id);
    const trnLabel = TRN_LABELS[polla.tournament] || polla.tournament;
    const count = countMap.get(polla.id) || 0;
    return {
      id: `polla_${polla.id}`,
      title: polla.name,
      description: `${trnLabel} · ${count} jugadores · ${p?.total_points || 0} pts`,
    };
  });

  await sendListMessage(
    phone,
    `Escoge cuál polla quieres ver 👇`,
    "Ver mis pollas",
    [{ title: "Activas", rows }],
    "Tus Pollas",
    FOOTER,
  );
}

// ─── FLOW 4: Polla Menu ───

export async function handlePollaMenu(
  phone: string,
  userId: string,
  pollaId: string
) {
  const check = await verifyMemberAndPolla(phone, userId, pollaId);
  if (!check) return;
  const { polla, participant } = check;

  const trnLabel = TRN_LABELS[polla.tournament] || polla.tournament;
  await setState(phone, { action: "browsing_polla", pollaId });

  // RULE 4 — ended pollas are read-only (no Pronosticar)
  if (polla.status === "ended") {
    await sendReplyButtons(
      phone,
      `🏆 *${polla.name}*\n\n` +
        `⚽ Torneo: ${trnLabel}\n` +
        `📊 Tu posición final: *#${participant.rank ?? "—"}*\n` +
        `🎯 Tus puntos: *${participant.total_points ?? 0}*\n\n` +
        `Esta polla ya terminó parce. Solo puedes ver los resultados finales.`,
      [
        { id: `rank_${pollaId}`, title: "Ver Tabla 📊" },
        { id: `results_${pollaId}`, title: "Resultados ⚽" },
      ],
      polla.name,
      FOOTER
    );
    return;
  }

  const body =
    `🏆 *${polla.name}*\n\n` +
    `⚽ Torneo: ${trnLabel}\n` +
    `📊 Tu posición: *#${participant.rank ?? "—"}*\n` +
    `🎯 Tus puntos: *${participant.total_points ?? 0}*\n\n` +
    `¿Qué quieres hacer parce?`;

  // Solo el menú con 3 reply buttons. Antes se mandaba un follow-up
  // "Invitar a la polla" con CTA URL — sacado por feedback del user
  // 2026-05-04: spammeaba en cada renderizado del menú. Para invitar,
  // queda el comando explícito "invitar" o se hace desde la web.
  await sendReplyButtons(
    phone,
    body,
    [
      { id: `pred_${pollaId}`, title: "Pronosticar 🎯" },
      { id: `rank_${pollaId}`, title: "Ver Tabla 📊" },
      { id: `results_${pollaId}`, title: "Resultados ⚽" },
    ],
    polla.name,
    FOOTER,
  );
}

// ─── FLOW 5: Pronosticar ───
//
// UX (decisión del user, 2026-05-14): NADA de "filtrá por fecha o jornada".
// Un tap en "Pronosticar" (o "Siguiente") cae DIRECTO en el próximo partido
// sin pronosticar — el user solo ve el partido y escribe el marcador. La
// lista plana cronológica queda a un tap de distancia ("Ver partidos") como
// escape para saltarse partidos o buscar uno específico.

export async function handlePronosticar(
  phone: string,
  userId: string,
  pollaId: string,
  specificMatchId?: string,
  page: number = 0,
  forceList: boolean = false
) {
  void ensureMatchesFresh();
  const check = await verifyMemberAndPolla(phone, userId, pollaId);
  if (!check) return;
  const { polla } = check;

  if (polla.status === "ended") {
    await sendTextMessage(
      phone,
      "Esta polla ya terminó. Solo puedes ver los resultados finales."
    );
    return;
  }

  const supabase = createAdminClient();
  const lockWindow = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  // RULE 8 — filter by polla.match_ids (not tournament). Legacy pollas with no
  // match_ids fall back to the tournament-level list.
  const useMatchIds = polla.match_ids && polla.match_ids.length > 0;
  let matchQuery = supabase
    .from("matches")
    .select(
      "id, home_team, away_team, home_team_flag, away_team_flag, scheduled_at, phase"
    )
    .eq("status", "scheduled")
    .gt("scheduled_at", lockWindow)
    .order("scheduled_at", { ascending: true });

  if (useMatchIds) {
    matchQuery = matchQuery.in("id", polla.match_ids!);
  } else {
    matchQuery = matchQuery.eq("tournament", polla.tournament);
  }

  const { data: matches } = await matchQuery;

  if (!matches || matches.length === 0) {
    await sendReplyButtons(
      phone,
      "😴 No hay partidos abiertos para pronosticar en este momento.\n\n_Apenas se programen nuevos, te aviso._",
      [
        { id: `rank_${pollaId}`, title: "Ver Tabla 📊" },
        { id: `results_${pollaId}`, title: "Resultados ⚽" },
        { id: "menu", title: "🏠 Menú" },
      ],
      polla.name,
      FOOTER
    );
    return;
  }

  // Existing predictions
  const { data: predictions } = await supabase
    .from("predictions")
    .select("match_id")
    .eq("polla_id", pollaId)
    .eq("user_id", userId);

  const predictedMatchIds = new Set(predictions?.map((p) => p.match_id) || []);

  // Specific match requested (tapped a row in the list) — validate scope.
  if (specificMatchId) {
    const match = matches.find((m) => m.id === specificMatchId);
    if (!match) {
      await sendTextMessage(
        phone,
        "Ese partido ya no está abierto parce, elegí uno de la lista."
      );
      return handlePronosticar(phone, userId, pollaId, undefined, 0, true);
    }
    return showPredictionPrompt(
      phone,
      polla,
      match,
      matches.indexOf(match) + 1,
      matches.length,
      pollaId,
      userId
    );
  }

  const unpredicted = matches.filter((m) => !predictedMatchIds.has(m.id));

  // Everything predicted — celebrate, don't dump a useless list of done ones.
  if (unpredicted.length === 0) {
    await sendReplyButtons(
      phone,
      `✅ ¡Eso es! Ya pronosticaste los *${matches.length}* partidos abiertos de *${polla.name}*.\n\n_Te aviso apenas se programen nuevos._`,
      [
        { id: `rank_${pollaId}`, title: "Ver Tabla 📊" },
        { id: `results_${pollaId}`, title: "Resultados ⚽" },
        { id: "menu", title: "🏠 Menú" },
      ],
      polla.name,
      FOOTER
    );
    return;
  }

  // Default entry (tap on "Pronosticar" / "Siguiente"): jump STRAIGHT to the
  // next match that needs a prediction. No list to scroll, no date/phase
  // picker — just a match and a score box.
  if (!forceList && page === 0) {
    const match = unpredicted[0];
    return showPredictionPrompt(
      phone,
      polla,
      match,
      matches.indexOf(match) + 1,
      matches.length,
      pollaId,
      userId
    );
  }

  // Explicit list view ("Ver partidos" / pagination): flat, chronological,
  // only the matches still missing a prediction. WhatsApp lists cap at 10
  // rows, so we paginate with a trailing "Ver más" row.
  const startIdx = page * PAGE_SIZE;
  const pageMatches = unpredicted.slice(startIdx, startIdx + PAGE_SIZE);
  const hasMore = startIdx + PAGE_SIZE < unpredicted.length;

  await setState(phone, {
    action: "picking_match",
    pollaId,
    page,
  });

  const rows = pageMatches.map((m) => {
    const dateStr = new Date(m.scheduled_at).toLocaleDateString("es-CO", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    return {
      id: `match_${m.id}`,
      // Title is capped at 24 chars by WhatsApp, so we abbreviate here.
      // Description (72 char cap) carries the full names + date.
      title: shortMatchTitle(m.home_team, m.away_team),
      description: (() => {
        const full = `${m.home_team} vs ${m.away_team} · ${dateStr}`;
        return full.length <= 72 ? full : dateStr;
      })(),
    };
  });

  if (hasMore) {
    rows.push({
      id: `more_${pollaId}_${page + 1}`,
      title: "Ver más partidos →",
      description: `Faltan ${unpredicted.length - (startIdx + PAGE_SIZE)} por mostrar`,
    });
  }

  await sendListMessage(
    phone,
    `Estos son los partidos que te faltan pronosticar 👇${page > 0 ? ` _(pág. ${page + 1})_` : ""}`,
    "Ver partidos",
    [{ title: "Toca para pronosticar", rows }],
    `🎯 ${polla.name}`,
    FOOTER
  );
}

// Helper: Show prediction input prompt for a specific match.
// Fetches the user's existing prediction (if any) and surfaces it so they
// know what they're about to overwrite (+ can send "cancelar" to keep it).
async function showPredictionPrompt(
  phone: string,
  polla: { id: string; name: string },
  match: {
    id: string;
    home_team: string;
    away_team: string;
    scheduled_at: string;
  },
  matchIndex: number,
  totalMatches: number,
  pollaId: string,
  userId: string
) {
  await setState(phone, {
    action: "waiting_prediction",
    pollaId,
    matchId: match.id,
    matchIndex,
    totalMatches,
  });

  const dateStr = new Date(match.scheduled_at).toLocaleDateString("es-CO", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const supabase = createAdminClient();
  const { data: existing } = await supabase
    .from("predictions")
    .select("predicted_home, predicted_away")
    .eq("polla_id", pollaId)
    .eq("user_id", userId)
    .eq("match_id", match.id)
    .maybeSingle();

  const matchLabel = formatMatchLabel(match.home_team, match.away_team);
  const header =
    `⚽ *${matchLabel}*\n\n` +
    `🏆 ${polla.name} — Partido ${matchIndex}/${totalMatches}\n` +
    `📅 ${dateStr}\n`;

  // Buttons are escape hatches only — the user answers by TYPING the score
  // (handled by the waiting_prediction state, set above). WhatsApp lets them
  // tap a button OR type, so the score box stays the primary action.
  const buttons = [
    { id: `predlist_${pollaId}`, title: "📋 Ver partidos" },
    { id: "menu", title: "🏠 Menú" },
  ];

  if (existing) {
    await sendReplyButtons(
      phone,
      header +
        `\nYa pronosticaste este partido parce.\n` +
        `Tu pronóstico actual: *${match.home_team} ${existing.predicted_home} - ${existing.predicted_away} ${match.away_team}*\n\n` +
        `Escribí un nuevo marcador para cambiarlo (ej: *2-2*), o *cancelar* para dejarlo igual.`,
      buttons,
      undefined,
      FOOTER
    );
    return;
  }

  await sendReplyButtons(
    phone,
    header +
      `\n¿Cómo va a quedar? Escribí el marcador así:\n*2-1* _(local primero)_\n\n` +
      `_Tienes hasta ${dateStr} para pronosticar_ ⏰`,
    buttons,
    undefined,
    FOOTER
  );
}

// Used when the user sends "cancelar" while in waiting_prediction state.
// Reassures them the existing prediction is untouched and sends them back
// to the polla menu.
export async function handleCancelPrediction(
  phone: string,
  userId: string,
  pollaId: string,
  matchId: string
) {
  const supabase = createAdminClient();

  const { data: match } = await supabase
    .from("matches")
    .select("home_team, away_team")
    .eq("id", matchId)
    .single();

  const { data: existing } = await supabase
    .from("predictions")
    .select("predicted_home, predicted_away")
    .eq("polla_id", pollaId)
    .eq("user_id", userId)
    .eq("match_id", matchId)
    .maybeSingle();

  if (match && existing) {
    await sendTextMessage(
      phone,
      `Listo parce, dejé tu pronóstico como estaba (*${match.home_team} ${existing.predicted_home} - ${existing.predicted_away} ${match.away_team}*)`
    );
  } else {
    await sendTextMessage(phone, "Listo parce, cancelé.");
  }

  await handlePollaMenu(phone, userId, pollaId);
}

// ─── FLOW 5b: Receive Prediction ───

export async function handlePredictionInput(
  phone: string,
  user: { id: string; display_name: string },
  pollaId: string,
  matchId: string,
  predictedHome: number,
  predictedAway: number
) {
  const supabase = createAdminClient();

  const { data: match } = await supabase
    .from("matches")
    .select("id, home_team, away_team, scheduled_at, status")
    .eq("id", matchId)
    .single();

  if (!match) {
    await sendTextMessage(phone, "🤔 Parce, no encontré el partido.");
    return;
  }

  // RULE 1 — 5min lock check before confirming
  const lockTime = new Date(match.scheduled_at).getTime() - 5 * 60 * 1000;
  if (match.status !== "scheduled" || Date.now() >= lockTime) {
    await sendTextMessage(
      phone,
      "Este partido ya está cerrado parce, no se pueden cambiar pronósticos a menos de 5 minutos del inicio."
    );
    return;
  }

  // Save state for confirmation. predictedHome/predictedAway are the
  // canonical fields; matchIndex/totalMatches stay reserved for the
  // picking_match UX counters.
  await setState(phone, {
    action: "confirm_prediction",
    pollaId,
    matchId: match.id,
    predictedHome,
    predictedAway,
  });

  const homeFlag = getTeamFlag(match.home_team);
  const awayFlag = getTeamFlag(match.away_team);
  await sendReplyButtons(
    phone,
    `¿Confirmás tu predicción? 🎯\n\n` +
      `${homeFlag} *${match.home_team}* *${predictedHome}* - *${predictedAway}* *${match.away_team}* ${awayFlag}`,
    [
      { id: "confirm_yes", title: "✅ Confirmar" },
      { id: "confirm_no", title: "❌ Cambiar" },
    ],
    "Confirmar pronóstico",
    FOOTER
  );
}

// ─── FLOW 5c: Confirm Prediction ───

export async function handleConfirmPrediction(
  phone: string,
  user: { id: string; display_name: string },
  state: {
    pollaId: string;
    matchId?: string;
    predictedHome?: number;
    predictedAway?: number;
  }
) {
  const supabase = createAdminClient();

  const predictedHome = state.predictedHome!;
  const predictedAway = state.predictedAway!;
  const matchId = state.matchId!;
  const pollaId = state.pollaId;

  const { data: match } = await supabase
    .from("matches")
    .select("id, home_team, away_team, scheduled_at, status")
    .eq("id", matchId)
    .single();

  if (!match) {
    await sendTextMessage(phone, "🤔 Parce, no encontré el partido.");
    return;
  }

  // RULE 1 — re-check the 5min lock at confirm time. The DB trigger is the
  // ultimate gate, but checking here avoids the generic "error guardando" UX.
  const lockTime = new Date(match.scheduled_at).getTime() - 5 * 60 * 1000;
  if (match.status !== "scheduled" || Date.now() >= lockTime) {
    await sendTextMessage(
      phone,
      "Este partido ya está cerrado parce, no se pueden cambiar pronósticos a menos de 5 minutos del inicio."
    );
    return;
  }

  // Detectar si es la primera predicción del user (en cualquier polla).
  // Lo usamos abajo para disparar el ask de payment method una sola vez,
  // justo cuando la persona ya está activamente jugando.
  const { count: prevPredCount } = await supabase
    .from("predictions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  const isFirstPredictionEver = (prevPredCount ?? 0) === 0;

  // Upsert prediction
  const { error } = await supabase.from("predictions").upsert(
    {
      polla_id: pollaId,
      user_id: user.id,
      match_id: matchId,
      predicted_home: predictedHome,
      predicted_away: predictedAway,
      submitted_at: new Date().toISOString(),
    },
    { onConflict: "polla_id,user_id,match_id" }
  );

  if (error) {
    console.error("[WA] Error saving prediction:", error);
    await sendTextMessage(
      phone,
      "❌ Uy parce, hubo un error guardando tu pronóstico. Intentá de nuevo."
    );
    return;
  }

  // Batch 4a: explicit clear on flow completion.
  // Placed after the successful upsert so the persisted prediction is the
  // source of truth, and before the user-facing send so a network error on
  // the reply-buttons call does not leave stale confirm_prediction state.
  await clearState(phone);

  const homeFlag = getTeamFlag(match.home_team);
  const awayFlag = getTeamFlag(match.away_team);
  await sendReplyButtons(
    phone,
    `✅ ¡Listo parce! Guardé tu pronóstico: ${homeFlag} *${match.home_team}* *${predictedHome}* - *${predictedAway}* *${match.away_team}* ${awayFlag}\n\n` +
      `_Eso es, a esperar el partido_ 🐥`,
    [
      { id: `pred_next_${pollaId}`, title: "Siguiente ➡️" },
      { id: "menu", title: "🏠 Menú" },
    ],
    "Pronóstico guardado ✅",
    FOOTER
  );

  // Después de la PRIMERA predicción de su vida, si la polla tiene
  // buy_in > 0 y no tiene método de pago guardado, le pedimos. Solo en
  // ese momento — no antes (saturaba al unirse) ni después (perdía el
  // momento de mayor engagement).
  if (isFirstPredictionEver) {
    const { data: pollaInfo } = await supabase
      .from("pollas")
      .select("buy_in_amount")
      .eq("id", pollaId)
      .maybeSingle();
    if (pollaInfo && Number(pollaInfo.buy_in_amount) > 0) {
      const { userNeedsPaymentInfo, askPaymentMethod } = await import("./payment");
      if (await userNeedsPaymentInfo(user.id)) {
        await askPaymentMethod(phone);
      }
    }
  }
}

// ─── FLOW 6: Leaderboard ───

export async function handleLeaderboard(
  phone: string,
  userId: string,
  pollaId: string
) {
  void ensureMatchesFresh();
  const check = await verifyMemberAndPolla(phone, userId, pollaId);
  if (!check) return;
  const { polla } = check;

  const supabase = createAdminClient();

  const { data: participants } = await supabase
    .from("polla_participants")
    .select("user_id, total_points, rank, users(display_name)")
    .eq("polla_id", pollaId)
    .eq("status", "approved")
    .eq("paid", true)
    .order("rank", { ascending: true });

  if (!participants || participants.length === 0) {
    await sendTextMessage(
      phone,
      "😅 No hay participantes en esta polla aún parce."
    );
    return;
  }

  const rows = participants.map((p) => ({
    position: p.rank || 0,
    name:
      (p.users as unknown as { display_name: string })?.display_name ||
      "Usuario",
    points: p.total_points || 0,
    predictions: 0,
    isCurrentUser: p.user_id === userId,
  }));

  const tablaText = formatTablaWA(rows, polla.name);
  await sendTextMessage(phone, tablaText);
}

// ─── FLOW 7: Results ───

export async function handleResults(
  phone: string,
  userId: string,
  pollaId: string
) {
  void ensureMatchesFresh();
  const check = await verifyMemberAndPolla(phone, userId, pollaId);
  if (!check) return;
  const { polla } = check;

  const supabase = createAdminClient();

  // RULE 8 — last 5 finished matches scoped to polla.match_ids when set
  const useMatchIds = polla.match_ids && polla.match_ids.length > 0;
  let resultsQuery = supabase
    .from("matches")
    .select(
      "id, home_team, away_team, home_score, away_score, home_team_flag, away_team_flag"
    )
    .eq("status", "finished")
    .order("scheduled_at", { ascending: false })
    .limit(5);

  if (useMatchIds) {
    resultsQuery = resultsQuery.in("id", polla.match_ids!);
  } else {
    resultsQuery = resultsQuery.eq("tournament", polla.tournament);
  }

  const { data: matches } = await resultsQuery;

  if (!matches || matches.length === 0) {
    await sendReplyButtons(
      phone,
      "😴 No hay resultados disponibles aún parce.\n\n_Pilas, te aviso cuando se jueguen partidos_",
      [
        { id: `polla_${pollaId}`, title: "⬅️ Volver" },
        { id: "menu", title: "🏠 Menú" },
      ],
      polla.name,
      FOOTER
    );
    return;
  }

  // Get user's predictions
  const matchIds = matches.map((m) => m.id);
  const { data: predictions } = await supabase
    .from("predictions")
    .select("match_id, predicted_home, predicted_away, points_earned")
    .eq("polla_id", pollaId)
    .eq("user_id", userId)
    .in("match_id", matchIds);

  const predMap = new Map(predictions?.map((p) => [p.match_id, p]) || []);

  let text = `⚽ *Últimos resultados — ${polla.name}*\n\n`;

  for (const m of matches) {
    const homeFlag = getTeamFlag(m.home_team);
    const awayFlag = getTeamFlag(m.away_team);
    text += `${homeFlag} *${m.home_team}* *${m.home_score ?? "?"}* - *${m.away_score ?? "?"}* *${m.away_team}* ${awayFlag}\n`;

    const pred = predMap.get(m.id);
    if (pred) {
      const emoji =
        (pred.points_earned || 0) > 0
          ? `✅ +${pred.points_earned} pts`
          : "❌ 0 pts";
      text += `_Tu pronóstico: ${pred.predicted_home}-${pred.predicted_away} → ${emoji}_\n`;
    } else {
      text += `_Sin pronóstico_ 😅\n`;
    }
    text += `\n`;
  }

  // Total points
  const { data: myP } = await supabase
    .from("polla_participants")
    .select("total_points")
    .eq("polla_id", pollaId)
    .eq("user_id", userId)
    .single();

  text += `💰 *Total acumulado: ${myP?.total_points || 0} pts*`;

  await sendTextMessage(phone, text);
}

// ─── FLOW 8: Join Polla via Link ───

export async function handleJoinPolla(
  phone: string,
  user: { id: string; display_name: string },
  slug: string
) {
  const supabase = createAdminClient();

  const { data: polla } = await supabase
    .from("pollas")
    .select("id, name, slug, status, type, payment_mode, buy_in_amount")
    .eq("slug", slug)
    .single();

  if (!polla) {
    await sendTextMessage(
      phone,
      "🤔 Parce, no encontré una polla con ese link."
    );
    return;
  }

  if (polla.status !== "active") {
    await sendTextMessage(
      phone,
      `😅 La polla *${polla.name}* ya no está activa parce.`
    );
    return;
  }

  // Check if already a member — entrega directa al menú de la polla.
  const { data: existing } = await supabase
    .from("polla_participants")
    .select("id")
    .eq("polla_id", polla.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) {
    await sendReplyButtons(
      phone,
      `¡Parce, ya sos parte de *${polla.name}*! 🐥\n\n_Dale, poné tus pronósticos_`,
      [
        { id: `pred_${polla.id}`, title: "Pronosticar 🎯" },
        { id: `rank_${polla.id}`, title: "Ver Tabla 📊" },
      ],
      polla.name,
      FOOTER
    );
    return;
  }

  // Toda polla es privada — el link por sí solo no alcanza. El user necesita
  // el código de 6 caracteres del admin (lo manda aquí y handleJoinByCode
  // lo procesa).
  await sendTextMessage(
    phone,
    `Esa polla es privada parce 🔒\n\nPedile al admin el código de 6 caracteres y mandámelo aquí.`,
  );
}

// ─── FLOW 9: Help Menu ───

export async function handleHelp(phone: string) {
  await sendListMessage(
    phone,
    "Escoge una opción parce 👇",
    "Ver opciones",
    [
      {
        title: "Mis cosas",
        rows: [
          {
            id: "menu_mis_pollas",
            title: "Mis pollas",
            description: "Ver y gestionar tus pollas",
          },
          {
            id: "menu_predecir",
            title: "Mis predicciones",
            description: "Ver y hacer tus pronósticos",
          },
          {
            id: "menu_tabla",
            title: "Ver tabla",
            description: "Clasificación de tu polla",
          },
          {
            id: "menu_perfil",
            title: "Mi perfil",
            description: "Tus stats y datos",
          },
        ],
      },
      {
        title: "Cómo funciona",
        rows: [
          {
            id: "help_puntaje",
            title: "¿Cómo se puntúa?",
            description: "Sistema de puntos",
          },
          {
            id: "help_crear",
            title: "Crear una polla",
            description: "Abre el link para crear",
          },
        ],
      },
    ],
    "¿En qué te ayudo?",
    FOOTER
  );
}

// ─── FLOW 10: Help Topics ───

export async function handleHelpTopic(
  phone: string,
  user: { id: string; display_name: string },
  topic: string
) {
  if (topic === "help_puntaje") {
    await sendTextMessage(
      phone,
      `🎯 *¿Cómo se puntúa en La Polla?*\n\n` +
        `*5 pts* — Resultado exacto (ej: dijiste 2-1 y fue 2-1) 🔥\n` +
        `*3 pts* — Le pegaste al ganador y a la diferencia de goles ⚡\n` +
        `*2 pts* — Acertaste quién ganó ✅\n` +
        `*1 pt* — Acertaste los goles de uno de los dos equipos 🎯\n` +
        `*0 pts* — No le pegaste 😅\n\n` +
        `_Pilas parce, cada punto cuenta para la tabla_ 📊`
    );
    return;
  }

  if (topic === "help_crear") {
    await sendCTAButton(
      phone,
      "Crea tu polla desde la web, es bacano y rapidito 🐥\n\n_Eliges el torneo, pones el nombre y compartes el link con tus amigos_",
      "Crear mi polla 🏆",
      `${APP_URL}/pollas/crear`,
      FOOTER
    );
    return;
  }

  if (topic === "help_pollas") {
    await handleMisPollas(phone, user.id);
    return;
  }

  if (topic === "help_predicciones") {
    await handleMisPollas(phone, user.id);
    return;
  }

  if (topic === "help_tabla") {
    await handleMisPollas(phone, user.id);
    return;
  }

  // Default
  await handleHelp(phone);
}

// ─── FLOW 11: Profile ───

export async function handleProfile(phone: string, userId: string) {
  const supabase = createAdminClient();

  const { data: user } = await supabase
    .from("users")
    .select("display_name")
    .eq("id", userId)
    .single();

  const { data: participations } = await supabase
    .from("polla_participants")
    .select("polla_id, total_points, rank")
    .eq("user_id", userId);

  const activeCount = participations?.length || 0;

  const { data: predictions } = await supabase
    .from("predictions")
    .select("id")
    .eq("user_id", userId);

  const predCount = predictions?.length || 0;

  const bestRank = participations?.reduce((best, p) => {
    if (!p.rank) return best;
    return p.rank < best ? p.rank : best;
  }, 999);

  const name = user?.display_name || "Parcero";

  await sendTextMessage(
    phone,
    `🐥 *Tu Perfil*\n\n` +
      `👤 *${name}*\n` +
      `📊 Pollas activas: *${activeCount}*\n` +
      `🎯 Predicciones: *${predCount}*\n` +
      `🏆 Mejor posición: *#${bestRank && bestRank < 999 ? bestRank : "—"}*`
  );
  // Sin CTA URL a la web — el resumen alcanza para WA-only users.
}

// ─── Join by code ─────────────────────────────────────────────────────
//
// Two entry points route here:
//   1. "unirse CODIGO" → handleJoinByCode directly
//   2. Bare 6-char message → handleJoinByCodeConfirm asks SI/NO first
//
// Both paths end up calling the shared lib/pollas/join.ts helper so the
// bot and the web endpoint never drift on validation, rate limits, or
// participant-row semantics.

/**
 * Sends the user a SI/NO confirmation before joining with a bare code.
 * Saves the code in conversation state so the SI/NO reply knows which
 * code to apply.
 */
export async function handleJoinByCodeConfirm(phone: string, code: string) {
  const normalized = code.trim().toUpperCase();
  if (!validateJoinCodeFormat(normalized)) {
    await sendTextMessage(
      phone,
      "Parce, ese código no tiene el formato correcto. Deben ser 6 letras o números.",
    );
    return;
  }
  await setState(phone, { action: "waiting_join_confirm", joinCode: normalized });
  await sendReplyButtons(
    phone,
    `¿Quieres unirte a la polla con el código *${normalized}*?`,
    [
      { id: "join_code_yes", title: "Sí, unirme" },
      { id: "join_code_no", title: "No" },
    ],
    FOOTER,
  );
}

/**
 * Performs the join. Shared with the web endpoint via lib/pollas/join.ts.
 * Translates the shared result enum into Spanish bot copy.
 */
export async function handleJoinByCode(
  phone: string,
  userId: string,
  code: string,
) {
  await clearState(phone);
  const result = await joinByCode({ userId, phone, code });

  if (result.ok) {
    // Confirmación inicial. NO CTA URL a web — todo en bot.
    await sendTextMessage(
      phone,
      `¡Te uniste a *${result.polla.name}*! 🎉`,
    );

    // Chequear si necesita subir comprobante (admin_collects, paid=false).
    const supabase2 = createAdminClient();
    const { data: pollaInfo } = await supabase2
      .from("pollas")
      .select(
        "id, name, payment_mode, buy_in_amount, admin_payout_method, admin_payout_account, admin_payout_account_name",
      )
      .eq("id", result.polla.id)
      .maybeSingle();

    const buyIn = pollaInfo ? Number(pollaInfo.buy_in_amount) : 0;
    const isPaid = pollaInfo && pollaInfo.payment_mode === "admin_collects" && buyIn > 0;

    if (
      isPaid &&
      pollaInfo &&
      pollaInfo.admin_payout_method &&
      pollaInfo.admin_payout_account
    ) {
      // Pedir comprobante. Reemplaza el polla menu (lo abrimos cuando
      // pague o si decide pedir aprobación manual).
      const { askPaymentProof } = await import("./payment");
      await askPaymentProof(
        phone,
        pollaInfo.id,
        pollaInfo.name,
        buyIn,
        pollaInfo.admin_payout_method,
        pollaInfo.admin_payout_account,
        pollaInfo.admin_payout_account_name,
      );
      return;
    }

    // Polla gratis o pay_winner: abrir polla menu directo. El método de
    // pago se pide después de la primera predicción (no acá) — evita
    // saturar al user con preguntas apenas se une.
    await handlePollaMenu(phone, userId, result.polla.id);
    return;
  }

  switch (result.code) {
    case "invalid_format":
      await sendTextMessage(
        phone,
        "Parce, ese código no tiene el formato correcto. Deben ser 6 letras o números.",
      );
      return;
    case "rate_limited":
      await sendTextMessage(
        phone,
        "Muchos intentos seguidos parce. Esperá 10 minutos y volvés a probar.",
      );
      return;
    case "not_found":
      await sendTextMessage(
        phone,
        "Ese código no existe. Pedile al admin de la polla que te lo mande de nuevo.",
      );
      return;
    case "not_active":
      await sendTextMessage(
        phone,
        "Esa polla ya no acepta nuevos jugadores.",
      );
      return;
    case "already_member":
      await sendTextMessage(phone, "Ya sos parte de esa polla parce.");
      return;
  }
}



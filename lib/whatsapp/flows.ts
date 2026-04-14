// lib/whatsapp/flows.ts — All WhatsApp bot conversation flows
// Colombian parcero Spanish + rich formatting + interactive messages
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTextMessage } from "./bot";
import {
  sendReplyButtons,
  sendListMessage,
  sendCTAButton,
} from "./interactive";
import { setState } from "./state";
import { formatTablaWA } from "./tabla";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim() || "https://la-polla.vercel.app";
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
 * Verify the user is an approved participant of the polla AND, for digital_pool
 * pollas, has payment_status = 'approved'. Sends the appropriate Spanish message
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
    .select("id, role, status, payment_status, total_points, rank")
    .eq("polla_id", pollaId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!participant || participant.status !== "approved") {
    await sendTextMessage(phone, "No eres participante de esta polla parce.");
    return null;
  }

  if (
    polla.payment_mode === "digital_pool" &&
    participant.payment_status !== "approved"
  ) {
    await sendTextMessage(
      phone,
      `Necesitás pagar la cuota primero. Entrá a la app para completar el pago: ${APP_URL}/pollas/${polla.slug}`
    );
    return null;
  }

  return { polla: polla as PollaRow, participant: participant as ParticipantRow };
}

// ─── FLOW 1: Main Menu ───

export async function handleMainMenu(phone: string, displayName: string) {
  const name =
    /^\d{8,15}$/.test(displayName.replace("+", ""))
      ? "parcero"
      : displayName.split(" ")[0];

  await sendReplyButtons(
    phone,
    `Hey ${name} qué vamos a hacer hoy parce?`,
    [
      { id: "menu_mis_pollas", title: "Mis Pollas 🏆" },
      { id: "menu_predecir", title: "Predecir ⚽" },
      { id: "menu_tabla", title: "Ver Tabla 📊" },
    ],
    "La Polla 🐥",
    FOOTER
  );
}

// ─── FLOW 2: Unknown User ───

export async function handleUnknownUser(phone: string) {
  await sendTextMessage(
    phone,
    `¡Hola parce! 👋 Bienvenido a La Polla 🐔\n\n` +
      `Todavía no tenés cuenta, pero eso se arregla en 30 segundos.\n` +
      `Tocá el botón de abajo y armá tu cuenta para empezar a jugar 👇`
  );
  await sendCTAButton(
    phone,
    "¡Listo parce! Creá tu cuenta acá 🎯",
    "Registrarme 🐔",
    APP_URL,
    FOOTER
  );
}

// ─── FLOW 3: Mis Pollas ───

export async function handleMisPollas(phone: string, userId: string) {
  const supabase = createAdminClient();

  const { data: participations } = await supabase
    .from("polla_participants")
    .select("polla_id, total_points, rank, role, status")
    .eq("user_id", userId)
    .eq("status", "approved");

  if (!participations || participations.length === 0) {
    await sendTextMessage(
      phone,
      "😅 Parce, no estás en ninguna polla todavía.\n\n_Unite a una o creá una nueva desde la web_"
    );
    await sendCTAButton(
      phone,
      "Dale, creá tu polla y armá el parche 🐥",
      "Ir a La Polla",
      APP_URL,
      FOOTER
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
    await sendTextMessage(
      phone,
      "😴 No tenés pollas activas en este momento parce.\n\n_Creá una nueva y armá el parche_"
    );
    await sendCTAButton(
      phone,
      "Dale, creá una polla nueva 🐥",
      "Crear polla",
      `${APP_URL}/pollas/crear`,
      FOOTER
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
    `Escoge cuál polla querés ver parce 👇`,
    "Ver mis pollas",
    [{ title: "Activas", rows }],
    "Tus Pollas",
    FOOTER
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
  setState(phone, { action: "browsing_polla", pollaId, pollaSlug: polla.slug });

  // RULE 4 — ended pollas are read-only (no Predecir)
  if (polla.status === "ended") {
    await sendReplyButtons(
      phone,
      `🏆 *${polla.name}*\n\n` +
        `⚽ Torneo: ${trnLabel}\n` +
        `📊 Tu posición final: *#${participant.rank ?? "—"}*\n` +
        `🎯 Tus puntos: *${participant.total_points ?? 0}*\n\n` +
        `Esta polla ya terminó parce. Solo podés ver los resultados finales.`,
      [
        { id: `rank_${pollaId}`, title: "Ver Tabla 📊" },
        { id: `results_${pollaId}`, title: "Resultados ⚽" },
      ],
      polla.name,
      FOOTER
    );
    return;
  }

  await sendReplyButtons(
    phone,
    `🏆 *${polla.name}*\n\n` +
      `⚽ Torneo: ${trnLabel}\n` +
      `📊 Tu posición: *#${participant.rank ?? "—"}*\n` +
      `🎯 Tus puntos: *${participant.total_points ?? 0}*\n\n` +
      `¿Qué querés hacer parce?`,
    [
      { id: `pred_${pollaId}`, title: "Predecir 🎯" },
      { id: `rank_${pollaId}`, title: "Ver Tabla 📊" },
      { id: `results_${pollaId}`, title: "Resultados ⚽" },
    ],
    polla.name,
    FOOTER
  );
}

// ─── FLOW 5: Pronosticar ───

export async function handlePronosticar(
  phone: string,
  userId: string,
  pollaId: string,
  specificMatchId?: string,
  page: number = 0
) {
  const check = await verifyMemberAndPolla(phone, userId, pollaId);
  if (!check) return;
  const { polla } = check;

  if (polla.status === "ended") {
    await sendTextMessage(
      phone,
      "Esta polla ya terminó parce. Solo podés ver los resultados finales."
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
      "id, home_team, away_team, home_team_flag, away_team_flag, scheduled_at"
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
      "😴 No hay partidos pendientes para pronosticar parce.\n\n_Pilas, te aviso cuando haya nuevos_",
      [
        { id: `polla_${pollaId}`, title: "⬅️ Volver" },
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

  // Specific match requested — validate it's in the polla scope
  if (specificMatchId) {
    const match = matches.find((m) => m.id === specificMatchId);
    if (!match) {
      await sendTextMessage(
        phone,
        "Ese partido no está en esta polla parce, seleccioná uno de la lista."
      );
      return handlePronosticar(phone, userId, pollaId, undefined, 0);
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

  // Auto-advance if only one unpredicted match
  const unpredicted = matches.filter((m) => !predictedMatchIds.has(m.id));
  if (unpredicted.length === 1 && page === 0) {
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

  // List view with pagination (WhatsApp lists are capped at 10 rows)
  const targetMatches = unpredicted.length > 0 ? unpredicted : matches;
  const startIdx = page * PAGE_SIZE;
  const pageMatches = targetMatches.slice(startIdx, startIdx + PAGE_SIZE);
  const hasMore = startIdx + PAGE_SIZE < targetMatches.length;

  setState(phone, {
    action: "picking_match",
    pollaId,
    pollaSlug: polla.slug,
    page,
  });

  const rows = pageMatches.map((m) => {
    const dateStr = new Date(m.scheduled_at).toLocaleDateString("es-CO", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    const predicted = predictedMatchIds.has(m.id);
    return {
      id: `match_${m.id}`,
      title: `${m.home_team} vs ${m.away_team}`,
      description: `${dateStr}${predicted ? " · ✅ Ya pronosticaste" : ""}`,
    };
  });

  if (hasMore) {
    rows.push({
      id: `more_${pollaId}_${page + 1}`,
      title: "Ver más partidos →",
      description: `Mostrar los siguientes ${Math.min(
        PAGE_SIZE,
        targetMatches.length - (startIdx + PAGE_SIZE)
      )}`,
    });
  }

  await sendListMessage(
    phone,
    `¿Cuál partido querés predecir parce? ⚽${page > 0 ? ` _(página ${page + 1})_` : ""}`,
    "Ver partidos",
    [{ title: "Partidos disponibles", rows }],
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
  setState(phone, {
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

  if (existing) {
    await sendTextMessage(
      phone,
      header +
        `\nYa pronosticaste este partido parce.\n` +
        `Tu pronóstico actual: *${match.home_team} ${existing.predicted_home} - ${existing.predicted_away} ${match.away_team}*\n\n` +
        `Escribí un nuevo marcador para actualizarlo, o mandá *cancelar* para dejarlo igual.`
    );
    return;
  }

  await sendTextMessage(
    phone,
    header +
      `\nEscribí el resultado así:\n*2-1* _(local primero)_\n\n` +
      `_Tenés hasta ${dateStr} para predecir_ ⏰`
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

  // Save state for confirmation
  setState(phone, {
    action: "confirm_prediction",
    pollaId,
    matchId: match.id,
    matchIndex: predictedHome,
    totalMatches: predictedAway,
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
    matchIndex?: number;
    totalMatches?: number;
  }
) {
  const supabase = createAdminClient();

  const predictedHome = state.matchIndex!;
  const predictedAway = state.totalMatches!;
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
}

// ─── FLOW 6: Leaderboard ───

export async function handleLeaderboard(
  phone: string,
  userId: string,
  pollaId: string
) {
  const check = await verifyMemberAndPolla(phone, userId, pollaId);
  if (!check) return;
  const { polla } = check;

  const supabase = createAdminClient();

  const { data: participants } = await supabase
    .from("polla_participants")
    .select("user_id, total_points, rank, users(display_name)")
    .eq("polla_id", pollaId)
    .order("rank", { ascending: true })
    .limit(5);

  if (!participants || participants.length === 0) {
    await sendTextMessage(
      phone,
      "😅 No hay participantes en esta polla aún parce."
    );
    return;
  }

  // Get prediction counts per user
  const userIds = participants.map((p) => p.user_id);
  const { data: predCounts } = await supabase
    .from("predictions")
    .select("user_id")
    .eq("polla_id", pollaId)
    .in("user_id", userIds);

  const predCountMap = new Map<string, number>();
  predCounts?.forEach((p) => {
    predCountMap.set(p.user_id, (predCountMap.get(p.user_id) || 0) + 1);
  });

  const rows = participants.map((p) => ({
    position: p.rank || 0,
    name:
      (p.users as unknown as { display_name: string })?.display_name ||
      "Usuario",
    points: p.total_points || 0,
    predictions: predCountMap.get(p.user_id) || 0,
    isCurrentUser: p.user_id === userId,
  }));

  // Check if user is outside top 5
  const userInTop = participants.find((p) => p.user_id === userId);
  let userRow;
  if (!userInTop) {
    const { data: myP } = await supabase
      .from("polla_participants")
      .select("total_points, rank")
      .eq("polla_id", pollaId)
      .eq("user_id", userId)
      .single();

    if (myP) {
      const { data: myUser } = await supabase
        .from("users")
        .select("display_name")
        .eq("id", userId)
        .single();

      const myPredCount = predCountMap.get(userId) || 0;
      userRow = {
        position: myP.rank || 0,
        name: myUser?.display_name || "Tú",
        points: myP.total_points || 0,
        predictions: myPredCount,
        isCurrentUser: true,
      };
    }
  }

  const tablaText = formatTablaWA(
    userRow ? [...rows, userRow] : rows,
    polla.name
  );

  await sendTextMessage(phone, tablaText);

  await sendCTAButton(
    phone,
    "_Dale clic para ver la tabla completa con todos los jugadores_ 👇",
    "Ver tabla completa 📊",
    `${APP_URL}/polla/${polla.id}`,
    FOOTER
  );
}

// ─── FLOW 7: Results ───

export async function handleResults(
  phone: string,
  userId: string,
  pollaId: string
) {
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

  if (polla.type === "closed") {
    await sendTextMessage(
      phone,
      `Esa polla es privada parce, necesitás invitación del admin para entrar.`
    );
    return;
  }

  // Check if already a member
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
        { id: `pred_${polla.id}`, title: "Predecir 🎯" },
        { id: `rank_${polla.id}`, title: "Ver Tabla 📊" },
      ],
      polla.name,
      FOOTER
    );
    return;
  }

  // For digital_pool: pay first, then predict (payment_status=pending gates the app).
  // For other modes: participant is pending until admin approves (matches web app flow).
  const isDigitalPool =
    polla.payment_mode === "digital_pool" && polla.buy_in_amount > 0;

  // Post-migration-010: no more 'pending' participant status. Everyone lands
  // as approved; digital_pool gates predictions via payment_status='pending'.
  const { error } = await supabase.from("polla_participants").insert({
    polla_id: polla.id,
    user_id: user.id,
    role: "player",
    status: "approved",
    payment_status: isDigitalPool ? "pending" : "approved",
    paid: !isDigitalPool,
    total_points: 0,
  });

  if (error) {
    console.error("[WA] Error joining polla:", error);
    await sendTextMessage(
      phone,
      "❌ Uy parce, hubo un error al unirte. Intentá de nuevo."
    );
    return;
  }

  if (isDigitalPool) {
    await sendCTAButton(
      phone,
      `🎉 ¡Listo parce! Te registré en *${polla.name}*\n\n` +
        `Ahora pagá la cuota en la app para que tus pronósticos cuenten 👇`,
      "Pagar y pronosticar",
      `${APP_URL}/pollas/${polla.slug}`,
      FOOTER
    );
    return;
  }

  await sendReplyButtons(
    phone,
    `🎉 ¡Listo parce! Ya sos parte de *${polla.name}*\n\n` +
      `Eso es, ahora poné tus pronósticos y demostrá quién sabe de fútbol 🐥⚽`,
    [
      { id: `pred_${polla.id}`, title: "Predecir 🎯" },
      { id: "menu", title: "🏠 Menú" },
    ],
    "¡Te uniste! 🎉",
    FOOTER
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
        `*3 pts* — Resultado exacto (ej: dijiste 2-1 y fue 2-1) 🔥\n` +
        `*1 pt* — Acertaste quién ganó o si fue empate ✅\n` +
        `*0 pts* — No le pegaste 😅\n\n` +
        `_Pilas parce, cada punto cuenta para la tabla_ 📊`
    );
    return;
  }

  if (topic === "help_crear") {
    await sendCTAButton(
      phone,
      "Creá tu polla desde la web, es bacano y rapidito 🐥\n\n_Elegí torneo, poné el nombre y compartile el link al parche_",
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
      `🏆 Mejor posición: *#${bestRank && bestRank < 999 ? bestRank : "—"}*\n\n` +
      `_Visitá tu perfil completo para ver más stats_`
  );

  await sendCTAButton(
    phone,
    "Dale, mirá todos tus datos 👇",
    "Ver perfil 👤",
    `${APP_URL}/perfil`,
    FOOTER
  );
}

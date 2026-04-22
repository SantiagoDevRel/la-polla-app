// lib/whatsapp/flows.ts — All WhatsApp bot conversation flows
// Colombian parcero Spanish + rich formatting + interactive messages
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTextMessage } from "./bot";
import {
  sendReplyButtons,
  sendListMessage,
  sendCTAButton,
} from "./interactive";
import { clearState, getState, setState } from "./state";
import { formatTablaWA } from "./tabla";
import { shortMatchTitle } from "./format";
import { ensureMatchesFresh } from "@/lib/matches/ensure-fresh";
import {
  groupMatchesByDate,
  groupMatchesByPhase,
  type GroupableMatch,
} from "@/lib/matches/grouping";
import { joinByCode } from "@/lib/pollas/join";
import { validateJoinCodeFormat } from "@/lib/pollas/join-code";
import { rotateJoinCode } from "@/lib/pollas/rotate-code";

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
    .select("id, role, status, payment_status, paid, total_points, rank")
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

  if (polla.payment_mode === "admin_collects" && !participant.paid) {
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

// ─── FLOW 2: Unknown User ───

export async function handleUnknownUser(phone: string) {
  await sendTextMessage(
    phone,
    "No te encuentro en La Polla 🐣. Registrate en la-polla.vercel.app y volvé a escribirme cuando tengas tu cuenta."
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
      "Todavía no estás en ninguna polla 🐣. Creá una en la-polla.vercel.app o pedile a un amigo el link de invitación."
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
  await setState(phone, { action: "browsing_polla", pollaId });

  // RULE 4 — ended pollas are read-only (no Pronosticar)
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

  const body =
    `🏆 *${polla.name}*\n\n` +
    `⚽ Torneo: ${trnLabel}\n` +
    `📊 Tu posición: *#${participant.rank ?? "—"}*\n` +
    `🎯 Tus puntos: *${participant.total_points ?? 0}*\n\n` +
    `¿Qué querés hacer parce?`;

  // Admins see a 4-row list (reply-buttons cap at 3). Non-admins keep the
  // existing 3-button layout so the regular path stays visually identical.
  if (participant.role === "admin") {
    await sendListMessage(
      phone,
      body,
      "Ver opciones",
      [
        {
          title: "Opciones",
          rows: [
            { id: `pred_${pollaId}`, title: "Pronosticar 🎯", description: "Poné tus pronósticos" },
            { id: `rank_${pollaId}`, title: "Ver Tabla 📊", description: "Mirá cómo va el parche" },
            { id: `results_${pollaId}`, title: "Resultados ⚽", description: "Últimos partidos" },
            { id: `rotate_confirm_${pollaId}`, title: "Generar nuevo código", description: "Genera un código de invitación nuevo" },
          ],
        },
      ],
      polla.name,
      FOOTER,
    );
    return;
  }

  await sendReplyButtons(
    phone,
    body,
    [
      { id: `pred_${pollaId}`, title: "Pronosticar 🎯" },
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
  void ensureMatchesFresh();
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

  // Grouping gate. When the polla spans multiple phases OR multiple dates
  // we route the user through an interactive toggle + group selector before
  // showing the paginated match list. State carries the current choice so
  // pagination ("Ver más") stays inside the selected group.
  const baseMatches = unpredicted.length > 0 ? unpredicted : matches;
  const uniquePhases = new Set(
    baseMatches.map((m) => (m as { phase: string | null }).phase ?? "__none__")
  );
  const uniqueDateKeys = new Set(
    baseMatches.map((m) =>
      new Date(m.scheduled_at).toISOString().slice(0, 10)
    )
  );
  const groupingUseful = uniquePhases.size > 1 || uniqueDateKeys.size > 1;
  const existingState = await getState(phone);
  const stateMode = existingState?.predictGroupMode ?? null;
  const stateKey = existingState?.predictGroupKey ?? null;

  let targetMatches = baseMatches;
  if (groupingUseful && page === 0 && !specificMatchId) {
    if (!stateMode) {
      // Ask the user how to group. setState parks them in picking_group so
      // any stray text ends up ignored instead of interpreted as a score.
      await setState(phone, { action: "picking_group", pollaId });
      await sendReplyButtons(
        phone,
        "¿Cómo querés ver los partidos parce?",
        [
          { id: `predgrp_phase_${pollaId}`, title: "Por fase" },
          { id: `predgrp_date_${pollaId}`, title: "Por fecha" },
        ],
        `🎯 ${polla.name}`,
        FOOTER
      );
      return;
    }
    if (!stateKey) {
      const groups =
        stateMode === "phase"
          ? groupMatchesByPhase(baseMatches as GroupableMatch[])
          : groupMatchesByDate(baseMatches as GroupableMatch[]);
      // If the chosen mode only produces a single group, skip the selector
      // and fall through to the flat list with every match visible.
      if (groups.length > 1) {
        const GROUP_PAGE_SIZE = 9; // 1 slot reserved for "Ver más"
        const groupPage = existingState?.predictGroupPage ?? 0;
        const groupStart = groupPage * GROUP_PAGE_SIZE;
        const pageGroups = groups.slice(groupStart, groupStart + GROUP_PAGE_SIZE);
        const hasMoreGroups = groupStart + GROUP_PAGE_SIZE < groups.length;

        const rows: { id: string; title: string; description: string }[] = pageGroups.map((g) => ({
          id: `pgsel|${pollaId}|${g.key}`,
          title: `${g.label} (${g.matches.length})`.slice(0, 24),
          description: g.matches.length === 1 ? "1 partido" : `${g.matches.length} partidos`,
        }));
        if (hasMoreGroups) {
          const remaining = groups.length - (groupStart + GROUP_PAGE_SIZE);
          rows.push({
            id: `pgmore|${pollaId}|${groupPage + 1}`,
            title: stateMode === "phase"
              ? `Ver más fases (${remaining}) →`.slice(0, 24)
              : `Ver más fechas (${remaining}) →`.slice(0, 24),
            description: `Mostrar los siguientes ${Math.min(GROUP_PAGE_SIZE, remaining)}`,
          });
        } else {
          // Last page only: offer an escape hatch to re-pick the grouping
          // mode. If there is still a "Ver más" row we skip this to keep
          // the 10-row WhatsApp cap; the user will see the option once
          // they reach the final page.
          rows.push({
            id: `pgreset|${pollaId}`,
            title: "🔄 Cambiar agrupación".slice(0, 24),
            description: "Volver a elegir por fase o por fecha",
          });
        }

        // Persist the page so pagination taps can increment it.
        await setState(phone, {
          action: "picking_group",
          pollaId,
          predictGroupMode: stateMode,
          predictGroupPage: groupPage,
        });

        await sendListMessage(
          phone,
          stateMode === "phase"
            ? `¿Qué fase querés pronosticar?${groupPage > 0 ? ` _(página ${groupPage + 1})_` : ""}`
            : `¿Qué fecha querés pronosticar?${groupPage > 0 ? ` _(página ${groupPage + 1})_` : ""}`,
          "Ver grupos",
          [{ title: "Grupos", rows }],
          `🎯 ${polla.name}`,
          FOOTER
        );
        return;
      }
    } else {
      // Filter matches to the selected group.
      const groups =
        stateMode === "phase"
          ? groupMatchesByPhase(baseMatches as GroupableMatch[])
          : groupMatchesByDate(baseMatches as GroupableMatch[]);
      const chosen = groups.find((g) => g.key === stateKey);
      if (chosen) {
        targetMatches = chosen.matches as typeof baseMatches;
      }
    }
  }

  // List view with pagination (WhatsApp lists are capped at 10 rows).
  const startIdx = page * PAGE_SIZE;
  const pageMatches = targetMatches.slice(startIdx, startIdx + PAGE_SIZE);
  const hasMore = startIdx + PAGE_SIZE < targetMatches.length;

  await setState(phone, {
    action: "picking_match",
    pollaId,
    page,
    ...(stateMode ? { predictGroupMode: stateMode } : {}),
    ...(stateKey ? { predictGroupKey: stateKey } : {}),
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
      // Title is capped at 24 chars by WhatsApp, so we abbreviate here.
      // Description (72 char cap) carries the full names + date so tappers
      // see the unambiguous matchup. If that combo would overflow, fall
      // back to the original date-only description.
      title: shortMatchTitle(m.home_team, m.away_team),
      description: (() => {
        const full = `${m.home_team} vs ${m.away_team} · ${dateStr}${predicted ? " · ✅" : ""}`;
        if (full.length <= 72) return full;
        return `${dateStr}${predicted ? " · ✅ Ya pronosticaste" : ""}`;
      })(),
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

// Group-mode picker: the user tapped "Por fase" or "Por fecha" from the
// toggle. Persist the choice and re-enter handlePronosticar so the gate
// above advances to the group list (or skips straight to the flat list
// when only one group exists).
export async function handlePredictGroupMode(
  phone: string,
  userId: string,
  pollaId: string,
  mode: "phase" | "date"
) {
  await setState(phone, {
    action: "picking_group",
    pollaId,
    predictGroupMode: mode,
  });
  await handlePronosticar(phone, userId, pollaId);
}

// Reset grouping choice mid-flow: the user tapped "Cambiar agrupación"
// from the group list. Clear the mode/key/page so the gate re-renders the
// "¿Por fase o por fecha?" button message.
export async function handlePredictGroupReset(
  phone: string,
  userId: string,
  pollaId: string
) {
  await setState(phone, { action: "picking_group", pollaId });
  await handlePronosticar(phone, userId, pollaId);
}

// Group-list pagination: the user tapped "Ver más fases/fechas" on the
// group selector. Bump the page index in state and re-enter
// handlePronosticar so the gate renders the next slice.
export async function handlePredictGroupPage(
  phone: string,
  userId: string,
  pollaId: string,
  page: number
) {
  const current = await getState(phone);
  const mode = current?.predictGroupMode ?? "phase";
  await setState(phone, {
    action: "picking_group",
    pollaId,
    predictGroupMode: mode,
    predictGroupPage: page,
  });
  await handlePronosticar(phone, userId, pollaId);
}

// Group selection: the user tapped a row in the group list. Persist the
// key and re-enter handlePronosticar; the gate reads the state and filters
// matches to the chosen group before rendering the paginated list.
export async function handlePredictGroupSelect(
  phone: string,
  userId: string,
  pollaId: string,
  groupKey: string
) {
  const current = await getState(phone);
  const mode = current?.predictGroupMode ?? "phase";
  await setState(phone, {
    action: "picking_match",
    pollaId,
    predictGroupMode: mode,
    predictGroupKey: groupKey,
  });
  await handlePronosticar(phone, userId, pollaId);
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

  if (existing) {
    await sendTextMessage(
      phone,
      header +
        `\nYa pronosticaste este partido parce.\n` +
        `Tu pronóstico actual: *${match.home_team} ${existing.predicted_home} - ${existing.predicted_away} ${match.away_team}*\n\n` +
        `Escribí un nuevo marcador para actualizarlo (ejemplo: 2-2), o mandá *cancelar* para dejarlo igual.`
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
        { id: `pred_${polla.id}`, title: "Pronosticar 🎯" },
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
      { id: `pred_${polla.id}`, title: "Pronosticar 🎯" },
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
    `¿Querés unirte a la polla con el código *${normalized}*?`,
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
    const inviteUrl = `${APP_URL}/pollas/${result.polla.slug}`;
    await sendCTAButton(
      phone,
      `¡Te uniste a *${result.polla.name}*! 🎉\n\nMirá la polla en la app 👇`,
      "Abrir polla 🐔",
      inviteUrl,
      FOOTER,
    );
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

// ─── Rotate join code (admin only) ───────────────────────────────────
//
// Two-step flow: confirmation → execution. Both steps re-check the
// polla_participants.role === "admin" gate independently so a forged
// rotate_yes_<id> payload cannot bypass the confirm step. The admin
// check here is byte-identical to the web route at
// app/api/pollas/[slug]/rotate-code/route.ts.

async function assertPollaAdmin(
  phone: string,
  userId: string,
  pollaId: string,
): Promise<{ polla: { id: string; name: string; slug: string } } | null> {
  const supabase = createAdminClient();

  const { data: polla } = await supabase
    .from("pollas")
    .select("id, name, slug")
    .eq("id", pollaId)
    .maybeSingle();
  if (!polla) {
    await sendTextMessage(phone, "🤔 Parce, no encontré esa polla.");
    return null;
  }

  const { data: membership } = await supabase
    .from("polla_participants")
    .select("role")
    .eq("polla_id", pollaId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!membership || membership.role !== "admin") {
    await sendTextMessage(phone, "No sos admin de esta polla parce.");
    return null;
  }

  return { polla };
}

/**
 * Step 1 of 2: confirm the admin wants to rotate. Sends a SI/NO prompt.
 */
export async function handleRotateCodeConfirm(
  phone: string,
  userId: string,
  pollaId: string,
) {
  const check = await assertPollaAdmin(phone, userId, pollaId);
  if (!check) return;
  const { polla } = check;

  await sendReplyButtons(
    phone,
    `¿Generar un nuevo código de invitación para *${polla.name}*? El código actual dejará de funcionar.`,
    [
      { id: `rotate_yes_${pollaId}`, title: "Sí, rotar" },
      { id: "rotate_no", title: "No" },
    ],
    polla.name,
    FOOTER,
  );
}

/**
 * Step 2 of 2: performs the rotation. Re-verifies admin permission
 * (defense in depth) and calls the shared rotateJoinCode helper so the
 * web + bot paths stay in lockstep.
 */
export async function handleRotateCode(
  phone: string,
  userId: string,
  pollaId: string,
) {
  const check = await assertPollaAdmin(phone, userId, pollaId);
  if (!check) return;
  const { polla } = check;

  const admin = createAdminClient();
  const result = await rotateJoinCode(admin, pollaId);

  if (!result.ok) {
    await sendTextMessage(
      phone,
      "Uy parce, no se pudo rotar el código. Intentá de nuevo.",
    );
    return;
  }

  await sendTextMessage(
    phone,
    `✅ Listo parce. Nuevo código: *${result.code}*\n\n` +
      `Compartilo con el parche. El anterior ya no funciona.`,
  );

  await sendCTAButton(
    phone,
    "O mandales el link directo 👇",
    "Abrir polla",
    `${APP_URL}/pollas/${polla.slug}`,
    FOOTER,
  );
}


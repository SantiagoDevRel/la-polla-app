// lib/whatsapp/flows.ts — All WhatsApp bot conversation flows
// Each flow queries Supabase and sends interactive WhatsApp messages
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTextMessage, sendButtonMessage, sendListMessage } from "./bot";
import { setState } from "./state";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://lapolla.app";

const TRN_LABELS: Record<string, string> = {
  worldcup_2026: "Mundial 2026",
  champions_2025: "Champions 2024-25",
  liga_betplay_2025: "BetPlay 2025",
};

// ─── FLOW 1: Main Menu ───

export async function handleMainMenu(phone: string, displayName: string) {
  // Si display_name es un número de teléfono, usar "parcero" en vez
  const name = /^\d{8,15}$/.test(displayName.replace("+", "")) ? "parcero" : displayName.split(" ")[0];
  await sendButtonMessage(
    phone,
    "⚽ La Polla",
    `Hola ${name}! Que quieres hacer?`,
    [
      { id: "mis_pollas", title: "Mis Pollas" },
      { id: "pronosticar", title: "Pronosticar" },
      { id: "tabla", title: "Tabla" },
    ]
  );
}

// ─── FLOW 2: Unknown User ───

export async function handleUnknownUser(phone: string) {
  await sendTextMessage(
    phone,
    `Hola! No tienes cuenta en La Polla todavia.\n\nRegistrate aqui: ${APP_URL}`
  );
}

// ─── FLOW 3: Mis Pollas ───

export async function handleMisPollas(phone: string, userId: string) {
  const supabase = createAdminClient();

  // Get user's active pollas with participant data
  const { data: participations } = await supabase
    .from("polla_participants")
    .select("polla_id, total_points, rank, role")
    .eq("user_id", userId);

  if (!participations || participations.length === 0) {
    await sendTextMessage(
      phone,
      `No estas en ninguna polla.\n\nUni a una o crea una nueva en la web: ${APP_URL}`
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
      `No tienes pollas activas en este momento.\n\nCrea una nueva en: ${APP_URL}/pollas/crear`
    );
    return;
  }

  const items = pollas.map((polla) => {
    const p = participations.find((pp) => pp.polla_id === polla.id);
    const trnLabel = TRN_LABELS[polla.tournament] || polla.tournament;
    return {
      id: `polla_${polla.id}`,
      title: polla.name,
      description: `${trnLabel} | #${p?.rank || "—"} | ${p?.total_points || 0} pts`,
    };
  });

  await sendListMessage(
    phone,
    "Tus Pollas",
    `Tienes ${pollas.length} polla${pollas.length > 1 ? "s" : ""} activa${pollas.length > 1 ? "s" : ""}. Selecciona una para ver opciones.`,
    "Ver pollas",
    items
  );
}

// ─── FLOW 4: Polla Menu ───

export async function handlePollaMenu(
  phone: string,
  userId: string,
  pollaId: string
) {
  const supabase = createAdminClient();

  const { data: polla } = await supabase
    .from("pollas")
    .select("id, name, tournament")
    .eq("id", pollaId)
    .single();

  if (!polla) {
    await sendTextMessage(phone, "No se encontro esa polla.");
    return;
  }

  const { data: participant } = await supabase
    .from("polla_participants")
    .select("total_points, rank")
    .eq("polla_id", pollaId)
    .eq("user_id", userId)
    .single();

  const trnLabel = TRN_LABELS[polla.tournament] || polla.tournament;

  await sendButtonMessage(
    phone,
    polla.name,
    `Torneo: ${trnLabel}\nTu posicion: #${participant?.rank || "—"}\nTus puntos: ${participant?.total_points || 0}`,
    [
      { id: `pred_${pollaId}`, title: "Pronosticar" },
      { id: `rank_${pollaId}`, title: "Ver Tabla" },
      { id: `results_${pollaId}`, title: "Resultados" },
    ]
  );
}

// ─── FLOW 5: Pronosticar ───

export async function handlePronosticar(
  phone: string,
  userId: string,
  pollaId: string
) {
  const supabase = createAdminClient();

  // Get polla to find its tournament
  const { data: polla } = await supabase
    .from("pollas")
    .select("id, name, tournament")
    .eq("id", pollaId)
    .single();

  if (!polla) {
    await sendTextMessage(phone, "No se encontro esa polla.");
    return;
  }

  const lockWindow = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  // Get upcoming matches that are still open for predictions
  const { data: matches } = await supabase
    .from("matches")
    .select("id, home_team, away_team, home_team_flag, away_team_flag, scheduled_at")
    .eq("tournament", polla.tournament)
    .eq("status", "scheduled")
    .gt("scheduled_at", lockWindow)
    .order("scheduled_at", { ascending: true });

  if (!matches || matches.length === 0) {
    await sendButtonMessage(
      phone,
      polla.name,
      "No hay partidos pendientes para pronosticar.",
      [{ id: `polla_${pollaId}`, title: "Volver" }, { id: "menu", title: "Menu" }]
    );
    return;
  }

  // Get user's existing predictions to find first unsubmitted
  const { data: predictions } = await supabase
    .from("predictions")
    .select("match_id")
    .eq("polla_id", pollaId)
    .eq("user_id", userId);

  const predictedMatchIds = new Set(predictions?.map((p) => p.match_id) || []);
  const unpredicted = matches.filter((m) => !predictedMatchIds.has(m.id));
  const targetMatches = unpredicted.length > 0 ? unpredicted : matches;
  const match = targetMatches[0];
  const matchIndex = matches.indexOf(match) + 1;

  // Set conversation state for prediction input
  setState(phone, {
    action: "waiting_prediction",
    pollaId,
    matchId: match.id,
    matchIndex,
    totalMatches: matches.length,
  });

  const dateStr = new Date(match.scheduled_at).toLocaleDateString("es-CO", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const homeFlag = match.home_team_flag || "";
  const awayFlag = match.away_team_flag || "";
  const alreadyPredicted = predictedMatchIds.has(match.id);

  await sendTextMessage(
    phone,
    `*${polla.name}* — Partido ${matchIndex}/${matches.length}\n\n` +
    `${homeFlag} *${match.home_team}*\n` +
    `vs\n` +
    `${awayFlag} *${match.away_team}*\n\n` +
    `📅 ${dateStr}\n` +
    `${alreadyPredicted ? "⚠️ Ya pronosticaste este partido. Puedes actualizar.\n" : ""}` +
    `\nEnvia tu pronostico como: *goles_local-goles_visitante*\nEjemplo: *2-1*`
  );
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

  // Get match details
  const { data: match } = await supabase
    .from("matches")
    .select("id, home_team, away_team, scheduled_at, status")
    .eq("id", matchId)
    .single();

  if (!match) {
    await sendTextMessage(phone, "No se encontro el partido.");
    return;
  }

  // Check if match is locked (started or < 5 min before kickoff)
  const lockTime = new Date(match.scheduled_at).getTime() - 5 * 60 * 1000;
  if (match.status !== "scheduled" || Date.now() >= lockTime) {
    await sendTextMessage(
      phone,
      "Este partido ya esta cerrado para pronosticos."
    );
    return;
  }

  // Upsert prediction
  const { error } = await supabase
    .from("predictions")
    .upsert(
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
    await sendTextMessage(phone, "Error guardando pronostico. Intenta de nuevo.");
    return;
  }

  await sendButtonMessage(
    phone,
    "Pronostico guardado ✓",
    `${match.home_team} ${predictedHome} - ${predictedAway} ${match.away_team}`,
    [
      { id: `pred_next_${pollaId}`, title: "Siguiente" },
      { id: "menu", title: "Menu" },
    ]
  );
}

// ─── FLOW 6: Leaderboard ───

export async function handleLeaderboard(
  phone: string,
  userId: string,
  pollaId: string
) {
  const supabase = createAdminClient();

  const { data: polla } = await supabase
    .from("pollas")
    .select("name")
    .eq("id", pollaId)
    .single();

  if (!polla) {
    await sendTextMessage(phone, "No se encontro esa polla.");
    return;
  }

  const { data: participants } = await supabase
    .from("polla_participants")
    .select("user_id, total_points, rank, users(display_name)")
    .eq("polla_id", pollaId)
    .order("rank", { ascending: true })
    .limit(10);

  if (!participants || participants.length === 0) {
    await sendTextMessage(phone, "No hay participantes en esta polla aun.");
    return;
  }

  const medals = ["🥇", "🥈", "🥉"];
  let table = `🏆 *Tabla — ${polla.name}*\n\n`;

  participants.forEach((p, i) => {
    const name = (p.users as unknown as { display_name: string })?.display_name || "Usuario";
    const medal = medals[i] || `${i + 1}.`;
    const isMe = p.user_id === userId;
    table += `${medal} ${name}${isMe ? " (tu)" : ""} — ${p.total_points} pts\n`;
  });

  // Find user's position if not in top 10
  const userInTop = participants.find((p) => p.user_id === userId);
  if (!userInTop) {
    const { data: myParticipation } = await supabase
      .from("polla_participants")
      .select("total_points, rank")
      .eq("polla_id", pollaId)
      .eq("user_id", userId)
      .single();

    if (myParticipation) {
      table += `\n...\nTu posicion: #${myParticipation.rank || "—"} con ${myParticipation.total_points} pts`;
    }
  }

  await sendTextMessage(phone, table);
}

// ─── FLOW 7: Results ───

export async function handleResults(
  phone: string,
  userId: string,
  pollaId: string
) {
  const supabase = createAdminClient();

  const { data: polla } = await supabase
    .from("pollas")
    .select("name, tournament")
    .eq("id", pollaId)
    .single();

  if (!polla) {
    await sendTextMessage(phone, "No se encontro esa polla.");
    return;
  }

  // Last 5 finished matches
  const { data: matches } = await supabase
    .from("matches")
    .select("id, home_team, away_team, home_score, away_score, home_team_flag, away_team_flag")
    .eq("tournament", polla.tournament)
    .eq("status", "finished")
    .order("scheduled_at", { ascending: false })
    .limit(5);

  if (!matches || matches.length === 0) {
    await sendButtonMessage(
      phone,
      polla.name,
      "No hay resultados disponibles aun.",
      [{ id: `polla_${pollaId}`, title: "Volver" }, { id: "menu", title: "Menu" }]
    );
    return;
  }

  // Get user's predictions for these matches
  const matchIds = matches.map((m) => m.id);
  const { data: predictions } = await supabase
    .from("predictions")
    .select("match_id, predicted_home, predicted_away, points_earned")
    .eq("polla_id", pollaId)
    .eq("user_id", userId)
    .in("match_id", matchIds);

  const predMap = new Map(predictions?.map((p) => [p.match_id, p]) || []);

  let text = `*Ultimos resultados — ${polla.name}*\n\n`;

  for (const m of matches) {
    const homeFlag = m.home_team_flag || "";
    const awayFlag = m.away_team_flag || "";
    text += `${homeFlag} ${m.home_team} *${m.home_score ?? "?"}*-*${m.away_score ?? "?"}* ${m.away_team} ${awayFlag}\n`;

    const pred = predMap.get(m.id);
    if (pred) {
      const emoji = pred.points_earned > 0 ? "✅" : "❌";
      text += `Tu pronostico: ${pred.predicted_home}-${pred.predicted_away} → ${emoji} ${pred.points_earned} pts\n`;
    } else {
      text += `Sin pronostico\n`;
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

  text += `Total acumulado: *${myP?.total_points || 0} pts*`;

  await sendTextMessage(phone, text);
}

// ─── FLOW 8: Join Polla via Link ───

export async function handleJoinPolla(
  phone: string,
  user: { id: string; display_name: string },
  slug: string
) {
  const supabase = createAdminClient();

  // Find polla by slug
  const { data: polla } = await supabase
    .from("pollas")
    .select("id, name, status, type")
    .eq("slug", slug)
    .single();

  if (!polla) {
    await sendTextMessage(phone, `No se encontro una polla con ese link.`);
    return;
  }

  if (polla.status !== "active") {
    await sendTextMessage(phone, `La polla "${polla.name}" ya no esta activa.`);
    return;
  }

  // Check if already a member
  const { data: existing } = await supabase
    .from("polla_participants")
    .select("id")
    .eq("polla_id", polla.id)
    .eq("user_id", user.id)
    .single();

  if (existing) {
    await sendButtonMessage(
      phone,
      polla.name,
      `Ya eres parte de esta polla!`,
      [
        { id: `pred_${polla.id}`, title: "Pronosticar" },
        { id: `rank_${polla.id}`, title: "Ver Tabla" },
      ]
    );
    return;
  }

  // Join the polla
  const { error } = await supabase.from("polla_participants").insert({
    polla_id: polla.id,
    user_id: user.id,
    role: "participant",
    status: "active",
    total_points: 0,
  });

  if (error) {
    console.error("[WA] Error joining polla:", error);
    await sendTextMessage(phone, "Error al unirte a la polla. Intenta de nuevo.");
    return;
  }

  await sendButtonMessage(
    phone,
    "Te uniste! 🎉",
    `Ahora eres parte de "${polla.name}". Ya puedes pronosticar!`,
    [
      { id: `pred_${polla.id}`, title: "Pronosticar" },
      { id: "menu", title: "Menu" },
    ]
  );
}

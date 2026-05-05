// app/api/cron/match-reminders/route.ts — Daily reminder cron.
//
// Disparado por GitHub Actions a las 13:00 UTC (8am Bogota). Para cada
// user activo con partidos hoy en alguna polla (Bogota TZ) y sin
// pronostico todavia, le manda un template "match_reminder_daily" que
// el bot tiene aprobado en Meta.
//
// Idempotente: si por error el cron se llama dos veces el mismo dia,
// no duplica envios — chequea wa_template_sends por user + template +
// rango "hoy Bogota".
//
// Auth: header Authorization: Bearer ${CRON_SECRET}.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  sendTemplateMessage,
  estimateTemplateCost,
  type TemplateComponent,
} from "@/lib/whatsapp/template";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TEMPLATE_NAME = "match_reminder_daily";
const TEMPLATE_LANGUAGE = "es";
const CATEGORY = "utility" as const;

interface MatchToRemind {
  match_id: string;
  polla_id: string;
  polla_name: string;
  home_team: string;
  away_team: string;
  scheduled_at: string;
}

interface UserToRemind {
  user_id: string;
  display_name: string | null;
  whatsapp_number: string | null;
  matches: MatchToRemind[];
}

export async function POST(request: NextRequest) {
  // ─── Auth ───
  const auth = request.headers.get("authorization") ?? "";
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 },
    );
  }
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  // ─── Bogota day window ───
  // Calculamos el inicio y fin del "hoy" segun America/Bogota (UTC-5).
  // Lo hacemos sin libs: tomar now en UTC, restar 5h para llevarlo a
  // hora Bogota, agarrar el dia, y reconstruir el rango UTC.
  const nowUtc = new Date();
  const bogotaNow = new Date(nowUtc.getTime() - 5 * 60 * 60 * 1000);
  const yyyy = bogotaNow.getUTCFullYear();
  const mm = bogotaNow.getUTCMonth();
  const dd = bogotaNow.getUTCDate();
  // 00:00 Bogota = 05:00 UTC
  const bogotaDayStartUtc = new Date(Date.UTC(yyyy, mm, dd, 5, 0, 0));
  const bogotaDayEndUtc = new Date(bogotaDayStartUtc.getTime() + 24 * 60 * 60 * 1000);

  // ─── Step 1: matches programados HOY (Bogota), aún no jugados ───
  const { data: todaysMatches, error: matchesErr } = await admin
    .from("matches")
    .select("id, home_team, away_team, scheduled_at, status, tournament")
    .gte("scheduled_at", bogotaDayStartUtc.toISOString())
    .lt("scheduled_at", bogotaDayEndUtc.toISOString())
    .in("status", ["scheduled"]);

  if (matchesErr) {
    return NextResponse.json(
      { error: "matches query failed", detail: matchesErr.message },
      { status: 500 },
    );
  }

  if (!todaysMatches || todaysMatches.length === 0) {
    return NextResponse.json({
      ok: true,
      message: "Sin partidos hoy en Bogota TZ",
      sent: 0,
      skipped: 0,
    });
  }

  // ─── Step 2: pollas activas que incluyen alguno de esos matches ───
  // pollas.match_ids es array uuid; usamos overlap operator (&&).
  const todaysMatchIds = todaysMatches.map((m) => m.id);
  const { data: pollas } = await admin
    .from("pollas")
    .select("id, name, match_ids, status")
    .eq("status", "active")
    .overlaps("match_ids", todaysMatchIds);

  if (!pollas || pollas.length === 0) {
    return NextResponse.json({
      ok: true,
      message: "Hay partidos hoy pero ninguna polla activa los incluye",
      sent: 0,
      skipped: 0,
    });
  }

  // Build polla_id → list of (match_id, polla_name) que aplican hoy.
  const pollaIds = pollas.map((p) => p.id);
  const matchById = new Map(
    todaysMatches.map((m) => [
      m.id,
      { id: m.id, home_team: m.home_team, away_team: m.away_team, scheduled_at: m.scheduled_at },
    ]),
  );

  // ─── Step 3: participantes approved+paid de esas pollas ───
  const { data: participants } = await admin
    .from("polla_participants")
    .select("user_id, polla_id")
    .in("polla_id", pollaIds)
    .eq("status", "approved")
    .eq("paid", true);

  if (!participants || participants.length === 0) {
    return NextResponse.json({
      ok: true,
      message: "Sin participantes pagos en pollas con partidos hoy",
      sent: 0,
      skipped: 0,
    });
  }

  // ─── Step 4: predictions YA hechas para los matches de hoy ───
  const userIds = Array.from(new Set(participants.map((p) => p.user_id)));
  const { data: existingPreds } = await admin
    .from("predictions")
    .select("user_id, match_id")
    .in("user_id", userIds)
    .in("match_id", todaysMatchIds);

  const predicted = new Set(
    (existingPreds ?? []).map((p) => `${p.user_id}|${p.match_id}`),
  );

  // ─── Step 5: armar lista de users → matches faltantes ───
  // Para cada (user, polla, match) que matchee:
  //   - el user no haya pronosticado ese match
  //   - el match esté incluido en la polla
  // Agrupamos por user para mandar 1 sola template aunque tenga
  // matches en varias pollas.
  const userToRemind = new Map<string, UserToRemind>();
  for (const p of participants) {
    const polla = pollas.find((pp) => pp.id === p.polla_id);
    if (!polla) continue;
    const matchIdsForThisPolla = (polla.match_ids ?? []).filter((mid: string) =>
      todaysMatchIds.includes(mid),
    );
    for (const mid of matchIdsForThisPolla) {
      if (predicted.has(`${p.user_id}|${mid}`)) continue;
      const m = matchById.get(mid);
      if (!m) continue;
      if (!userToRemind.has(p.user_id)) {
        userToRemind.set(p.user_id, {
          user_id: p.user_id,
          display_name: null,
          whatsapp_number: null,
          matches: [],
        });
      }
      userToRemind.get(p.user_id)!.matches.push({
        match_id: mid,
        polla_id: polla.id,
        polla_name: polla.name,
        home_team: m.home_team,
        away_team: m.away_team,
        scheduled_at: m.scheduled_at,
      });
    }
  }

  if (userToRemind.size === 0) {
    return NextResponse.json({
      ok: true,
      message: "Todos los users ya pronosticaron sus matches de hoy",
      sent: 0,
      skipped: 0,
    });
  }

  // ─── Step 6: enriquecer con whatsapp_number + display_name ───
  const usersInfo = await admin
    .from("users")
    .select("id, display_name, whatsapp_number")
    .in("id", Array.from(userToRemind.keys()));
  for (const u of usersInfo.data ?? []) {
    const entry = userToRemind.get(u.id);
    if (entry) {
      entry.display_name = u.display_name;
      entry.whatsapp_number = u.whatsapp_number;
    }
  }

  // ─── Step 7: para cada user, dedup contra wa_template_sends del dia
  //              de hoy (Bogota), y enviar si no esta marcado ───
  const { data: sentToday } = await admin
    .from("wa_template_sends")
    .select("user_id")
    .eq("template_name", TEMPLATE_NAME)
    .gte("created_at", bogotaDayStartUtc.toISOString());
  const alreadySent = new Set((sentToday ?? []).map((r) => r.user_id));

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const errors: Array<{ user_id: string; error: string }> = [];

  for (const entry of Array.from(userToRemind.values())) {
    if (!entry.whatsapp_number) {
      skipped++;
      continue;
    }
    if (alreadySent.has(entry.user_id)) {
      skipped++;
      continue;
    }

    // Build the body parameters.
    const firstName = (entry.display_name ?? "parce").split(" ")[0];
    const matchesText = formatMatchesBlock(entry.matches);

    const components: TemplateComponent[] = [
      {
        type: "body",
        parameters: [
          { type: "text", text: firstName },
          { type: "text", text: matchesText },
        ],
      },
    ];

    const result = await sendTemplateMessage(
      entry.whatsapp_number,
      TEMPLATE_NAME,
      TEMPLATE_LANGUAGE,
      components,
    );

    const cost = result.ok ? estimateTemplateCost(CATEGORY) : 0;
    await admin.from("wa_template_sends").insert({
      user_id: entry.user_id,
      phone: entry.whatsapp_number,
      template_name: TEMPLATE_NAME,
      variables: { firstName, matchesText, matchCount: entry.matches.length },
      meta_message_id: result.messageId ?? null,
      status: result.ok ? "sent" : "failed",
      error: result.error ?? null,
      cost_usd: cost,
      category: CATEGORY,
    });

    if (result.ok) {
      sent++;
    } else {
      failed++;
      errors.push({ user_id: entry.user_id, error: result.error ?? "unknown" });
    }
  }

  return NextResponse.json({
    ok: true,
    sent,
    skipped,
    failed,
    total_candidates: userToRemind.size,
    bogota_day_window: {
      start: bogotaDayStartUtc.toISOString(),
      end: bogotaDayEndUtc.toISOString(),
    },
    errors: errors.slice(0, 5),
  });
}

/**
 * Formatea la lista de matches como bloque de texto que va en el
 * template variable {{2}}. Ej output:
 *
 *   Tienes 2 pronosticos pendientes hoy:
 *
 *   • 2:00pm Real Madrid vs Barcelona
 *   • 4:30pm PSG vs Bayern Munich
 *
 *   Polla: Champions 2024-25
 */
function formatMatchesBlock(matches: MatchToRemind[]): string {
  const count = matches.length;
  const header =
    count === 1
      ? "Tienes 1 pronostico pendiente hoy:"
      : `Tienes ${count} pronosticos pendientes hoy:`;

  // Sort by kickoff time
  const sorted = [...matches].sort((a, b) =>
    a.scheduled_at.localeCompare(b.scheduled_at),
  );

  const lines = sorted.map((m) => {
    const time = formatBogotaTime(m.scheduled_at);
    return `• ${time} ${m.home_team} vs ${m.away_team}`;
  });

  // Group polla names (may have one or several)
  const pollaNames = Array.from(new Set(sorted.map((m) => m.polla_name)));
  const pollaLine =
    pollaNames.length === 1
      ? `Polla: ${pollaNames[0]}`
      : `Pollas: ${pollaNames.join(", ")}`;

  return `${header}\n\n${lines.join("\n")}\n\n${pollaLine}`;
}

/**
 * Format an ISO timestamp as "h:mma" en Bogota TZ. Ej "2026-05-05T19:00:00Z"
 * → "2:00pm".
 */
function formatBogotaTime(iso: string): string {
  const d = new Date(iso);
  // Adjust to Bogota (UTC-5)
  const bog = new Date(d.getTime() - 5 * 60 * 60 * 1000);
  const h24 = bog.getUTCHours();
  const m = bog.getUTCMinutes();
  const ampm = h24 >= 12 ? "pm" : "am";
  const h12 = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
  const mm = m.toString().padStart(2, "0");
  return `${h12}:${mm}${ampm}`;
}

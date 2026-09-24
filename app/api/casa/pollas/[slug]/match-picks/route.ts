import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCurrentUserAdmin } from "@/lib/auth/admin";
import { getLeaderboard, getMyEntries, getMyEntry, getPollaBySlug, getPollaMatches } from "@/lib/casa/queries";
import { isLiveEntry, isPublicClosedPolla } from "@/lib/casa/types";
import { hasCasaMatchStarted } from "@/lib/casa/match-rules";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const query = z.object({ match: z.string().uuid(), page: z.coerce.number().int().min(0).max(10_000).default(0) });
const PAGE_SIZE = 20;
function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: "Sin sesión." }, 401);
    const parsed = query.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) return json({ error: "El partido o la página no son válidos." }, 400);
    const polla = await getPollaBySlug((await params).slug);
    if (!polla || polla.kind !== "partidos" || polla.status === "borrador" || polla.status === "anulada") return json({ error: "Esa polla no existe." }, 404);
    // Cualquier participación viva de esta persona le deja ver los pronósticos (migración 131).
    // Una polla cerrada desde el 16-sep es pública para cualquier usuario con sesión.
    const [entry, entries] = await Promise.all([getMyEntry(polla.id, user.id), getMyEntries(polla.id, user.id)]);
    const participating = isLiveEntry(entry) || entries.some(isLiveEntry);
    if (!participating && !isPublicClosedPolla(polla) && !(await isCurrentUserAdmin())) return json({ error: "Inscríbete para ver los pronósticos de esta polla." }, 403);
    const matches = await getPollaMatches(polla.id);
    const match = matches.find(item => item.id === parsed.data.match);
    if (!match) return json({ error: "Ese partido no pertenece a la polla." }, 404);
    if (!hasCasaMatchStarted(match)) return json({ error: "Los pronósticos estarán disponibles cuando empiece el partido." }, 409);

    // This deliberate group read is authorized above for this polla's members
    // (or for anyone signed in once the polla is a public closed one).
    // The projection excludes user IDs, phone numbers and all payment details.
    // The caller's own rows (`mine`) are recognised by their own entry ids,
    // already read above, so no user_id ever leaves the database for this.
    const start = parsed.data.page * PAGE_SIZE;
    const scored = Boolean(match.final_verified_at || match.voided_at);
    let picks = createAdminClient().from("casa_picks")
      .select("id, entry_id, pick_1x2, home_score, away_score, points_earned, users!inner(display_name, avatar_url), casa_entries!inner(status)")
      .eq("polla_id", polla.id).eq("match_id", match.id).eq("casa_entries.status", "pagada");
    // Order the full result before pagination, so every scoring pick comes
    // before zero-point picks, including on later pages. Live picks keep their
    // neutral order: unverified points must not reveal a provisional result.
    if (scored) picks = picks.order("points_earned", { ascending: false, nullsFirst: false });
    const { data, error } = await picks.order("id", { ascending: true }).range(start, start + PAGE_SIZE);
    if (error) throw error;
    const page = (data ?? []).slice(0, PAGE_SIZE);
    const myEntryIds = new Set([entry?.id, ...entries.map((item) => item.id)].filter((id): id is string => Boolean(id)));
    // Migración 131: "#N" solo para quien tiene varias participaciones aprobadas.
    // La tabla (SQL) ya trae número y conteo por participación; nada de user_id.
    const numbers = new Map<string, number>();
    if (page.length > 0) {
      for (const row of await getLeaderboard(polla.id)) {
        if ((row.user_entries ?? 1) > 1 && row.entry_number != null) numbers.set(row.entry_id, row.entry_number);
      }
    }
    // Los puntos solo cuando el resultado ya está verificado: antes, un 0 se
    // leería como «fallaste» cuando en realidad todavía no se puntuó.
    const rows = page.map(row => {
      const player = Array.isArray(row.users) ? row.users[0] : row.users;
      return {
        id: row.id, displayName: player?.display_name ?? "Sin nombre", avatarUrl: player?.avatar_url ?? null,
        entryNumber: numbers.get(row.entry_id) ?? null,
        mine: myEntryIds.has(row.entry_id),
        pointsEarned: match.voided_at ? 0 : scored ? row.points_earned ?? 0 : null,
        pick1x2: polla.scoring_mode === "1x2" ? row.pick_1x2 : null,
        homeScore: polla.scoring_mode === "marcador" ? row.home_score : null,
        awayScore: polla.scoring_mode === "marcador" ? row.away_score : null,
      };
    });
    return json({ rows, hasMore: (data?.length ?? 0) > PAGE_SIZE, page: parsed.data.page });
  } catch {
    return json({ error: "No se pudieron cargar los pronósticos." }, 500);
  }
}

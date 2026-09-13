import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCurrentUserAdmin } from "@/lib/auth/admin";
import { getMyEntry, getPollaBySlug, getPollaMatches } from "@/lib/casa/queries";
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
    const entry = await getMyEntry(polla.id, user.id);
    const participating = entry?.status === "pagada" || (entry?.status === "pendiente" && Boolean(entry.proof_path));
    if (!participating && !(await isCurrentUserAdmin())) return json({ error: "Inscríbete para ver los pronósticos de esta polla." }, 403);
    const matches = await getPollaMatches(polla.id);
    const match = matches.find(item => item.id === parsed.data.match);
    if (!match) return json({ error: "Ese partido no pertenece a la polla." }, 404);
    if (!hasCasaMatchStarted(match)) return json({ error: "Los pronósticos estarán disponibles cuando empiece el partido." }, 409);

    // This deliberate group read is authorized above for this polla's members.
    // The projection excludes user IDs, phone numbers and all payment details.
    const start = parsed.data.page * PAGE_SIZE;
    const { data, error } = await createAdminClient().from("casa_picks")
      .select("id, pick_1x2, home_score, away_score, users!inner(display_name, avatar_url), casa_entries!inner(status)")
      .eq("polla_id", polla.id).eq("match_id", match.id).eq("casa_entries.status", "pagada")
      .order("id", { ascending: true }).range(start, start + PAGE_SIZE);
    if (error) throw error;
    const rows = (data ?? []).slice(0, PAGE_SIZE).map(row => {
      const player = Array.isArray(row.users) ? row.users[0] : row.users;
      return {
        id: row.id, displayName: player?.display_name ?? "Sin nombre", avatarUrl: player?.avatar_url ?? null,
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

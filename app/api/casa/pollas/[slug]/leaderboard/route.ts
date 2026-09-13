import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getLeaderboard, getMyEntry, getPollaBySlug } from "@/lib/casa/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

/** Same audience as the authenticated detail: any signed-in visitor. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return privateJson({ error: "Sin sesión." }, 401);

    // getPollaBySlug also excludes archived pollas. Do not expose a draft's
    // leaderboard, even to someone who guesses its slug.
    const polla = await getPollaBySlug((await params).slug);
    if (!polla || polla.status === "borrador" || polla.status === "anulada") {
      return privateJson({ error: "Esa polla no existe." }, 404);
    }

    const [rows, entry] = await Promise.all([
      getLeaderboard(polla.id),
      getMyEntry(polla.id, user.id),
    ]);
    return privateJson({
      rows,
      entryStatus: entry?.status ?? null,
      drawPending: polla.draw_pending ?? false,
      pollaStatus: polla.status,
    });
  } catch {
    return privateJson({ error: "No se pudo cargar la tabla de posiciones." }, 500);
  }
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listHighlightMatches } from "@/lib/highlights/polla-matches";
import { fetchPollaHighlights, highlightsApiKey } from "@/lib/highlights/provider";
import { colombiaDateKey } from "@/lib/time/colombia";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const auth = await createClient();
    const { data: { user }, error } = await auth.auth.getUser();
    if (error || !user) return NextResponse.json({ error: "No autorizado" }, { status: 401, headers });
    const params = new URL(request.url).searchParams;
    const slug = params.get("polla") ?? undefined;
    const matchId = params.get("match") ?? undefined;
    if ((slug !== undefined && !/^[a-zA-Z0-9_-]{1,120}$/.test(slug))
      || (matchId !== undefined && !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(matchId))) {
      return NextResponse.json({ error: "Partido o polla inválidos" }, { status: 400, headers });
    }
    const now = new Date();
    const day = colombiaDateKey(now);
    const key = highlightsApiKey();
    if (!key) return NextResponse.json({ enabled: false, day, videos: [], partial: false }, { headers });
    const matches = await listHighlightMatches(user.id, { slug, matchId }, now);
    const result = await fetchPollaHighlights(matches, key);
    return NextResponse.json({ enabled: true, day, matchCount: matches.length, ...result }, { headers });
  } catch {
    return NextResponse.json({ error: "No pudimos cargar los resúmenes" }, { status: 503, headers });
  }
}

// app/api/highlights/route.ts — Highlights/goles/resúmenes del Mundial para
// el strip "Lo último del Mundial" en /inicio.
//
// Pila persistente: el RSS de Gol Caracol solo trae los 15 uploads más
// recientes (y el canal sube mucho), así que los resúmenes se entierran
// rápido. Acumulamos los gol/resumen en la tabla worldcup_highlights a
// medida que aparecen y mostramos los últimos 6 (más nuevo primero → en el
// strip queda a la izquierda, el viejo se corre a la derecha y sale).
//
// Auth-gated. Caching: el RSS se cachea 15 min (Data Cache, global). La
// respuesta va no-store para que el user vea la pila fresca al instante. El
// video lo sirve YouTube → cero bandwidth de Vercel.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchWorldCupHighlights, buildHighlightVideo } from "@/lib/youtube/highlights";

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const candidates = await fetchWorldCupHighlights();

  try {
    const admin = createAdminClient();

    // Sumar los nuevos a la pila (idempotente: ignora los que ya están).
    if (candidates.length > 0) {
      await admin.from("worldcup_highlights").upsert(
        candidates.map((c) => ({
          video_id: c.videoId,
          title: c.title,
          channel: c.channel,
          published_at: c.publishedAt,
        })),
        { onConflict: "video_id", ignoreDuplicates: true },
      );
    }

    // Leer los últimos 6 de la pila (más nuevo primero).
    const { data, error } = await admin
      .from("worldcup_highlights")
      .select("video_id, title, channel, published_at")
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(6);
    if (error) throw error;

    const videos = (data ?? []).map(buildHighlightVideo);
    return NextResponse.json({ videos }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // Si la tabla aún no existe o falla, caemos al RSS directo (sin pila).
    return NextResponse.json(
      { videos: candidates.slice(0, 6) },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}

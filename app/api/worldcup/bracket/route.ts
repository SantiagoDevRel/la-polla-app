// app/api/worldcup/bracket/route.ts — Persistencia del camino pronosticado de
// la bracket "Road to World Cup" por usuario (tabla bracket_predictions,
// migración 067). Antes el camino vivía solo en localStorage y se perdía al
// cambiar de dispositivo / limpiar el browser.
//
// GET  → devuelve el path guardado del usuario (o null).
// PUT  → upsert del path del usuario.
//
// Auth-gated: getUser() ANTES de tocar DB (401 si no hay sesión). Usa admin
// client (auth.uid() devuelve NULL en el contexto PostgREST — ver CLAUDE.md)
// con filtro user_id EXPLÍCITO (defense-in-depth; RLS es el colchón). NO suma
// puntos: es predicción libre de cruces.
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const TOURNAMENT = "worldcup_2026";

// El camino: dos mapas string→string (slotKey→teamId, matchDay→teamId). Caps
// para que nadie infle el JSONB: el bracket real tiene 64 slots directos + ~31
// winners; 200 entradas por mapa es holgado y acota el abuso.
const idMap = z.record(z.string().max(64), z.string().max(64)).refine(
  (m) => Object.keys(m).length <= 200,
  { message: "too_many_entries" },
);
const PathSchema = z.object({
  assignments: idMap,
  winners: idMap,
});

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("bracket_predictions")
      .select("path, updated_at")
      .eq("user_id", user.id)
      .eq("tournament", TOURNAMENT)
      .maybeSingle();
    if (error) throw error;
    return NextResponse.json(
      { path: data?.path ?? null, updatedAt: data?.updated_at ?? null },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    // Si la tabla aún no existe o falla, el cliente cae a localStorage.
    return NextResponse.json({ path: null, updatedAt: null }, { headers: { "Cache-Control": "no-store" } });
  }
}

export async function PUT(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const parsed = PathSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("bracket_predictions")
      .upsert(
        {
          user_id: user.id,
          tournament: TOURNAMENT,
          path: parsed.data,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,tournament" },
      )
      .select("updated_at")
      .single();
    if (error) throw error;
    return NextResponse.json({ ok: true, updatedAt: data?.updated_at ?? null });
  } catch {
    return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
  }
}

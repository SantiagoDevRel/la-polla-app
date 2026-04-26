// app/api/pollas/[slug]/prize-distribution/route.ts
//
// PATCH: admin-only. Guarda la distribución de premios de la polla.
// Shape esperado:
//   { mode: 'percentage' | 'cop',
//     prizes: [ { position: int, value: number }, ... ] }
//
// Validaciones:
// - mode requerido.
// - prizes debe tener al menos una entrada.
// - position >= 1, único, value > 0.
// - mode='percentage': suma de values <= 100 (no exigimos === 100 porque
//   el organizador puede dejar un margen para fee/comida/etc.).
// - mode='cop': value es entero >= 0.
//
// DELETE: admin-only. Borra la distribución (vuelve a winner-takes-all).
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

interface PrizeEntry {
  position: number;
  value: number;
}

interface PrizeDistribution {
  mode: "percentage" | "cop";
  prizes: PrizeEntry[];
}

function validate(body: unknown): { ok: true; value: PrizeDistribution } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "body inválido" };
  const b = body as Record<string, unknown>;
  const mode = b.mode;
  if (mode !== "percentage" && mode !== "cop") {
    return { ok: false, error: "mode debe ser 'percentage' o 'cop'" };
  }
  if (!Array.isArray(b.prizes) || b.prizes.length === 0) {
    return { ok: false, error: "prizes debe tener al menos una posición" };
  }
  const seen = new Set<number>();
  const prizes: PrizeEntry[] = [];
  for (const raw of b.prizes) {
    if (!raw || typeof raw !== "object") return { ok: false, error: "premio inválido" };
    const p = raw as Record<string, unknown>;
    const position = Number(p.position);
    const value = Number(p.value);
    if (!Number.isInteger(position) || position < 1) {
      return { ok: false, error: "position debe ser entero >= 1" };
    }
    if (seen.has(position)) {
      return { ok: false, error: `position duplicada: ${position}` };
    }
    seen.add(position);
    if (!Number.isFinite(value) || value <= 0) {
      return { ok: false, error: "value debe ser > 0" };
    }
    prizes.push({ position, value });
  }
  prizes.sort((a, b) => a.position - b.position);
  if (mode === "percentage") {
    const sum = prizes.reduce((acc, p) => acc + p.value, 0);
    if (sum > 100.0001) {
      return { ok: false, error: `los porcentajes suman ${sum.toFixed(2)}%, máximo 100%` };
    }
  }
  return { ok: true, value: { mode, prizes } };
}

async function resolveAdminPolla(slug: string, userId: string) {
  const admin = createAdminClient();
  const { data: polla, error } = await admin
    .from("pollas")
    .select("id, slug, prize_distribution")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  if (!polla) return { error: NextResponse.json({ error: "Polla no encontrada" }, { status: 404 }) };
  const { data: membership } = await admin
    .from("polla_participants")
    .select("role")
    .eq("polla_id", polla.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!membership || membership.role !== "admin") {
    return {
      error: NextResponse.json(
        { error: "Solo el admin puede modificar los premios" },
        { status: 403 },
      ),
    };
  }
  return { polla, admin };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { slug: string } },
) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const result = validate(body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const ctx = await resolveAdminPolla(params.slug, user.id);
  if ("error" in ctx) return ctx.error;

  const { error: updateErr } = await ctx.admin
    .from("pollas")
    .update({ prize_distribution: result.value })
    .eq("id", ctx.polla.id);
  if (updateErr) {
    return NextResponse.json({ error: "No se pudo guardar la distribución" }, { status: 500 });
  }
  return NextResponse.json({ prize_distribution: result.value });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { slug: string } },
) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const ctx = await resolveAdminPolla(params.slug, user.id);
  if ("error" in ctx) return ctx.error;

  const { error: updateErr } = await ctx.admin
    .from("pollas")
    .update({ prize_distribution: null })
    .eq("id", ctx.polla.id);
  if (updateErr) {
    return NextResponse.json({ error: "No se pudo borrar la distribución" }, { status: 500 });
  }
  return NextResponse.json({ prize_distribution: null });
}

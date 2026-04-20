// app/api/pollas/[slug]/invite-token/route.ts — open shareable link per polla.
// GET: return the existing token (mint one on first call). DELETE: rotate it.
// Both require the caller to be the polla admin.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import crypto from "crypto";

function newToken(): string {
  return crypto.randomBytes(16).toString("hex"); // 32 chars
}

// Carga la polla por slug y confirma que el usuario tiene sesión. Devuelve
// también la fila de polla_participants del caller para que los helpers
// específicos de rol decidan si aceptan o rechazan. Los dos helpers de
// abajo (ensureParticipant y ensureAdmin) comparten este paso base.
async function loadContext(slug: string) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autorizado", status: 401 as const };

  const admin = createAdminClient();
  const { data: polla } = await admin
    .from("pollas")
    .select("id, slug, invite_token")
    .eq("slug", slug)
    .maybeSingle();
  if (!polla) return { error: "Polla no encontrada", status: 404 as const };

  const { data: part } = await admin
    .from("polla_participants")
    .select("role")
    .eq("polla_id", polla.id)
    .eq("user_id", user.id)
    .maybeSingle();

  return { polla, admin, part };
}

// Lectura: cualquier participante aprobado o expulsado puede leer el token.
// Para compartir el link no se requiere ser admin, solo pertenecer a la polla.
async function ensureParticipant(slug: string) {
  const ctx = await loadContext(slug);
  if ("error" in ctx) return ctx;
  if (!ctx.part) {
    return { error: "No sos parte de esta polla", status: 403 as const };
  }
  return { polla: ctx.polla, admin: ctx.admin };
}

// Rotación: solo admin puede invalidar el link actual y generar uno nuevo.
async function ensureAdmin(slug: string) {
  const ctx = await loadContext(slug);
  if ("error" in ctx) return ctx;
  if (!ctx.part || ctx.part.role !== "admin") {
    return { error: "Solo el admin puede renovar el link", status: 403 as const };
  }
  return { polla: ctx.polla, admin: ctx.admin };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { slug: string } }
) {
  const ctx = await ensureParticipant(params.slug);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  let token = ctx.polla.invite_token;
  if (!token) {
    token = newToken();
    const { error: updErr } = await ctx.admin
      .from("pollas")
      .update({ invite_token: token })
      .eq("id", ctx.polla.id);
    if (updErr) {
      console.error("[invite-token] mint failed:", updErr);
      return NextResponse.json({ error: "Error generando link" }, { status: 500 });
    }
  }
  return NextResponse.json({ token });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { slug: string } }
) {
  const ctx = await ensureAdmin(params.slug);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const token = newToken();
  const { error: updErr } = await ctx.admin
    .from("pollas")
    .update({ invite_token: token })
    .eq("id", ctx.polla.id);
  if (updErr) {
    console.error("[invite-token] rotate failed:", updErr);
    return NextResponse.json({ error: "Error renovando link" }, { status: 500 });
  }
  return NextResponse.json({ token });
}

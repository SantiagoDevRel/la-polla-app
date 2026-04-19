// app/api/pollas/[slug]/rotate-code/route.ts
//
// POST endpoint: admin-only rotation of a polla's 6-char join code.
// Generates a fresh unique code via the shared util and writes it
// over pollas.join_code. Any in-flight /api/pollas/join-by-code
// requests referencing the previous code will miss the lookup and
// fall through to "Código no válido", which is the desired behavior.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateUniqueJoinCode } from "@/lib/pollas/join-code";

export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  { params }: { params: { slug: string } },
) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Resolve polla by slug and verify caller is admin. Single round-trip
  // using the admin client to bypass the RLS propagation issue.
  const { data: polla, error: pollaErr } = await admin
    .from("pollas")
    .select("id, slug")
    .eq("slug", params.slug)
    .maybeSingle();
  if (pollaErr) throw pollaErr;
  if (!polla) {
    return NextResponse.json({ error: "Polla no encontrada" }, { status: 404 });
  }

  const { data: membership } = await admin
    .from("polla_participants")
    .select("role")
    .eq("polla_id", polla.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership || membership.role !== "admin") {
    return NextResponse.json(
      { error: "Solo el admin puede rotar el código" },
      { status: 403 },
    );
  }

  const code = await generateUniqueJoinCode(admin);

  const { error: updateErr } = await admin
    .from("pollas")
    .update({ join_code: code })
    .eq("id", polla.id);
  if (updateErr) throw updateErr;

  return NextResponse.json({ code });
}

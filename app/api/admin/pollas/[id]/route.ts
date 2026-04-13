// app/api/admin/pollas/[id]/route.ts — Admin-only DELETE for pollas.
// Explicitly cascades to polla_participants and predictions in case FK cascades
// aren't set up on all environments.
import { NextRequest, NextResponse } from "next/server";
import { isCurrentUserAdmin } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { id } = await params;
  const admin = createAdminClient();

  // Delete children first, then the polla itself.
  await admin.from("predictions").delete().eq("polla_id", id);
  await admin.from("polla_participants").delete().eq("polla_id", id);

  const { error } = await admin.from("pollas").delete().eq("id", id);
  if (error) {
    console.error("[admin/pollas DELETE]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

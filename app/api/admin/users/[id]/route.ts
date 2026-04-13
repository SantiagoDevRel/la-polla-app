// app/api/admin/users/[id]/route.ts — Admin-only DELETE for users.
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

  // Delete from public.users — polla_participants + predictions cascade via FK.
  const { error } = await admin.from("users").delete().eq("id", id);
  if (error) {
    console.error("[admin/users DELETE]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Also try to drop the auth user so the login can't be reused.
  const { error: authError } = await admin.auth.admin.deleteUser(id);
  if (authError) {
    console.warn("[admin/users DELETE] auth.admin.deleteUser:", authError.message);
  }

  return NextResponse.json({ ok: true });
}

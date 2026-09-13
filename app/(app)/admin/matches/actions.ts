"use server";

import { isCurrentUserAdmin } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

export async function purgeMatchesAction() {
  if (!(await isCurrentUserAdmin())) {
    throw new Error("No autorizado");
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("matches")
    .delete()
    .lt("scheduled_at", "2026-01-01T00:00:00Z")
    .select("id");

  if (error) throw new Error(error.message);

  const deleted = data?.length || 0;
  revalidatePath("/admin/matches");
  return { deleted };
}

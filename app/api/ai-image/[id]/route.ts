// app/api/ai-image/[id]/route.ts — estado de UN job (para el polling del sheet).
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCurrentUserAdmin } from "@/lib/auth/admin";

export const dynamic = "force-dynamic";
const BUCKET = "ai-images";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "Solo admin" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: job } = await admin
    .from("ai_image_jobs")
    .select("id, status, result_path, error, created_at, done_at")
    .eq("id", params.id)
    .eq("user_id", user.id) // defense-in-depth: solo tus jobs
    .maybeSingle();

  if (!job) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  let resultUrl: string | null = null;
  if (job.result_path) {
    const { data: signed } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(job.result_path, 3600);
    resultUrl = signed?.signedUrl ?? null;
  }

  return NextResponse.json({
    id: job.id,
    status: job.status,
    error: job.error,
    result_url: resultUrl,
    created_at: job.created_at,
    done_at: job.done_at,
  });
}

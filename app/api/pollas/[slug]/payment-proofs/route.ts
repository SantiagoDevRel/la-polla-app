// app/api/pollas/[slug]/payment-proofs/route.ts
//
// GET — lista los payment_proofs de una polla específica. Solo
// accesible para el organizador (created_by) o un global admin.
// Devuelve cada proof con signed URL (1h) para mostrar la imagen.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCurrentUserAdmin } from "@/lib/auth/admin";

export async function GET(
  _request: NextRequest,
  { params }: { params: { slug: string } },
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: polla } = await admin
    .from("pollas")
    .select("id, created_by")
    .eq("slug", params.slug)
    .maybeSingle();
  if (!polla) {
    return NextResponse.json({ error: "Polla no encontrada" }, { status: 404 });
  }

  const isGlobalAdmin = await isCurrentUserAdmin();
  if (polla.created_by !== user.id && !isGlobalAdmin) {
    return NextResponse.json(
      { error: "Solo el organizador puede ver los comprobantes" },
      { status: 403 },
    );
  }

  const { data: proofs } = await admin
    .from("payment_proofs")
    .select(
      `id, polla_id, user_id, storage_path, ai_source_type, ai_valid,
       ai_confidence, ai_detected_amount, ai_detected_account,
       ai_detected_recipient_name, ai_detected_date, ai_rejection_reason,
       ai_evidence, ai_cost_usd, admin_decision, admin_reviewed_at,
       admin_notes, created_at, expires_at,
       users:user_id ( display_name, whatsapp_number )`,
    )
    .eq("polla_id", polla.id)
    .gte("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });

  // Signed URLs (1h) para cada storage_path.
  const enriched = await Promise.all(
    (proofs ?? []).map(async (p) => {
      const { data: signed } = await admin.storage
        .from("payment-proofs")
        .createSignedUrl(p.storage_path, 60 * 60);
      return { ...p, signed_url: signed?.signedUrl ?? null };
    }),
  );

  return NextResponse.json({ proofs: enriched });
}

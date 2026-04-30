// app/api/admin/payment-proofs/route.ts
//
// GET — lista todos los payment_proofs no expirados (últimos 7 días)
// para revisión del admin de la polla. Solo el organizador de cada
// polla ve los proofs de su polla; admins globales (is_admin=true) ven todos.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCurrentUserAdmin } from "@/lib/auth/admin";

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const isGlobalAdmin = await isCurrentUserAdmin();
  const admin = createAdminClient();

  // Si es global admin, ve todo. Si no, solo proofs de pollas que él
  // creó (organizadores normales).
  const query = admin
    .from("payment_proofs")
    .select(
      `id, polla_id, user_id, storage_path, ai_source_type, ai_valid,
       ai_confidence, ai_detected_amount, ai_detected_account,
       ai_detected_recipient_name, ai_detected_date, ai_rejection_reason,
       ai_evidence, ai_cost_usd, admin_decision, admin_reviewed_at,
       admin_notes, created_at, expires_at,
       pollas:polla_id ( slug, name, buy_in_amount, admin_payout_method,
                          admin_payout_account, admin_payout_account_name,
                          created_by ),
       users:user_id ( display_name, whatsapp_number )`,
    )
    .gte("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });

  const { data: proofs, error } = await query;
  if (error) {
    console.error("[admin/payment-proofs] query failed:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }

  // Filtrar a las pollas de las que el viewer es admin (a menos que
  // sea global admin).
  const filtered = (proofs ?? []).filter((p) => {
    if (isGlobalAdmin) return true;
    const polla = p.pollas as { created_by: string } | { created_by: string }[] | null;
    const created_by = Array.isArray(polla) ? polla[0]?.created_by : polla?.created_by;
    return created_by === user.id;
  });

  // Generar signed URLs (1 hora) para cada storage_path.
  const enriched = await Promise.all(
    filtered.map(async (p) => {
      const { data: signed } = await admin.storage
        .from("payment-proofs")
        .createSignedUrl(p.storage_path, 60 * 60);
      return {
        ...p,
        signed_url: signed?.signedUrl ?? null,
      };
    }),
  );

  return NextResponse.json({ proofs: enriched });
}

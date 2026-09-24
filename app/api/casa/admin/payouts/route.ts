// app/api/casa/admin/payouts/route.ts — el reparto de una polla visto desde el
// panel: si ya se puede repartir, a quién y cuánto; y cuando se repartió, la
// cuenta de cada ganador y su prueba de pago (migraciones 133 y 134).
//
// Etapas:
//   en_curso    faltan partidos/preguntas, hay casos o comprobantes pendientes
//   lista       todo verificado: vista previa por persona, falta confirmar
//   repartida   premios escritos por casa_settle_polla_v2 → pagar uno a uno
//   sin_ganador la polla terminó sin puntos (regla de la casa: no hay premio)
//   no_aplica   rifas, objetos o pollas que todavía reciben inscripciones
//
// La cuenta de pago del ganador (Nequi / Bancolombia) sale de `users` y SOLO
// viaja acá: es la única pantalla que la necesita y solo la ve el admin.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPayouts, getPot, getProvisionalPayouts, getSettlementReadiness } from "@/lib/casa/queries";
import { signPayoutProofs } from "@/lib/casa/payout-proofs";
import { getAdminPollaAccess } from "@/lib/casa/private-draft-query";
import type { AdminPayoutRow, AdminPayoutStage, CasaSettlementReadiness } from "@/lib/casa/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

type Account = { id: string; default_payout_method: string | null; default_payout_account: string | null; default_payout_account_name: string | null; default_payout_account_type: string | null };

async function accountsFor(userIds: string[]) {
  const accounts = new Map<string, Account>();
  const names = new Map<string, { display_name: string | null; avatar_url: string | null }>();
  if (userIds.length === 0) return { accounts, names };
  const { data, error } = await createAdminClient()
    .from("users")
    .select("id, display_name, avatar_url, default_payout_method, default_payout_account, default_payout_account_name, default_payout_account_type")
    .in("id", userIds);
  if (error) throw error;
  for (const row of data ?? []) {
    accounts.set(row.id, row);
    names.set(row.id, { display_name: row.display_name, avatar_url: row.avatar_url });
  }
  return { accounts, names };
}

function accountOf(account: Account | undefined): AdminPayoutRow["account"] {
  return account?.default_payout_account
    ? { method: account.default_payout_method, number: account.default_payout_account, holder: account.default_payout_account_name, type: account.default_payout_account_type }
    : null;
}

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return privateJson({ error: "No autenticado." }, 401);
  if (!user.is_admin) return privateJson({ error: "Solo el administrador." }, 403);
  const pollaId = request.nextUrl.searchParams.get("pollaId");
  if (!pollaId || !z.string().uuid().safeParse(pollaId).success) return privateJson({ error: "Polla inválida." }, 400);

  try {
    if (!(await getAdminPollaAccess(pollaId, user))) return privateJson({ error: "No existe esa polla." }, 404);
    const db = createAdminClient();
    const { data: polla, error: pollaError } = await db
      .from("casa_pollas")
      // settlement_prize_cop lo escribió el reparto en SQL: es el pozo repartido.
      .select("id, kind, status, settlement_outcome, prize_kind, archived_at, settlement_prize_cop")
      .eq("id", pollaId)
      .maybeSingle();
    if (pollaError) return privateJson({ error: "No se pudo leer la polla." }, 500);
    if (!polla || polla.archived_at) return privateJson({ error: "No existe esa polla." }, 404);

    // ── Ya repartida: premios reales, pago uno a uno ──────────────────────
    if (polla.status === "resuelta") {
      const stage: AdminPayoutStage = polla.settlement_outcome === "money_awarded" ? "repartida"
        : polla.settlement_outcome === "house_retained_zero_points" ? "sin_ganador" : "no_aplica";
      const payouts = stage === "repartida" ? (await getPayouts(pollaId)).filter((p) => (p.prize_kind ?? "pozo") === "pozo" && p.id) : [];
      const [proofUrls, { accounts }] = await Promise.all([signPayoutProofs(payouts), accountsFor(payouts.map((p) => p.user_id))]);
      const rows: AdminPayoutRow[] = payouts.map((p) => ({
        id: p.id!, userId: p.user_id, displayName: p.display_name ?? "Sin nombre", avatarUrl: p.avatar_url,
        amountCop: p.amount_cop, points: p.points, note: p.note ?? null,
        paidAt: p.paid_at, paidReference: p.paid_reference ?? null, proofUrl: proofUrls[p.id!] ?? null,
        account: accountOf(accounts.get(p.user_id)),
      }));
      return privateJson({
        stage, payable: stage === "repartida", preview: false,
        prizeCop: Number(polla.settlement_prize_cop ?? 0),
        rows, paidCount: rows.filter((r) => r.paidAt).length, totalCount: rows.length, readiness: null,
      });
    }

    // ── Antes de repartir: ¿ya se puede? ───────────────────────────────────
    const readiness: CasaSettlementReadiness | null = (await getSettlementReadiness([pollaId]))[pollaId] ?? null;
    if (!readiness || !readiness.inscriptionsClosed) {
      return privateJson({ stage: "no_aplica", payable: false, preview: false, prizeCop: 0, rows: [], paidCount: 0, totalCount: 0, readiness });
    }
    if (!readiness.ready) {
      return privateJson({ stage: "en_curso", payable: false, preview: false, prizeCop: 0, rows: [], paidCount: 0, totalCount: 0, readiness });
    }

    // Lista: el mismo cálculo que hará el reparto, por persona, con su cuenta.
    const [provisional, pot] = await Promise.all([getProvisionalPayouts(pollaId), getPot(pollaId)]);
    const { accounts, names } = await accountsFor(provisional.map((p) => p.user_id));
    const tie = provisional.length > 1;
    const rows: AdminPayoutRow[] = provisional.map((p) => ({
      id: p.user_id, userId: p.user_id,
      displayName: names.get(p.user_id)?.display_name ?? "Sin nombre", avatarUrl: names.get(p.user_id)?.avatar_url ?? null,
      amountCop: p.amount_cop, points: null,
      note: [tie ? "Empate en el primer puesto" : null, p.winning_entries > 1 ? `${p.winning_entries} cupos ganadores` : null].filter(Boolean).join(" · ") || null,
      paidAt: null, paidReference: null, proofUrl: null,
      account: accountOf(accounts.get(p.user_id)),
    }));
    return privateJson({
      stage: "lista", payable: false, preview: true,
      // Sigue marcada abierta aunque su cierre ya pasó: el panel la cierra antes de repartir.
      needsClose: polla.status === "abierta",
      prizeCop: Number(pot.prize_cop ?? 0),
      rows, paidCount: 0, totalCount: rows.length, readiness,
    });
  } catch {
    return privateJson({ error: "No se pudieron cargar los premios." }, 500);
  }
}

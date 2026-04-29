// app/api/pollas/[slug]/payout-summary/route.ts
//
// GET — devuelve la fotografía de payouts de la polla:
//   - allocations[] (calculadas desde participants + prize_distribution)
//   - transactions[] (persistidas en polla_payouts una vez al cerrar la polla)
//   - errors / warnings (del algoritmo)
//   - canSettle (true cuando hay $ que mover y no hay errores)
//   - isAdmin / isViewerWinner (para personalizar la UI)
//
// Idempotencia: la primera vez que se llama después de polla.status='ended'
// con allocations sin errores, persistimos las transactions. Si ya hay
// filas en polla_payouts para esta polla, NO recalculamos — la
// liquidación queda anclada al momento del cierre y los confirmes
// (paid_at, paid_by_user_id) no se pueden borrar por accidente.
//
// Solo participantes approved+paid forman parte del pozo. Los que no
// pagaron quedan fuera del settlement (incluso si su rank lo merecía).

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  computePayout,
  type PaymentMode,
  type PrizeDistribution,
} from "@/lib/pollas/payout-allocation";

interface ParticipantRow {
  user_id: string;
  rank: number | null;
  total_points: number | null;
  joined_at: string;
  paid: boolean;
  status: string;
  payout_method: string | null;
  payout_account: string | null;
  users: { id: string; display_name: string | null } | null;
}

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
  const { data: polla, error: pollaErr } = await admin
    .from("pollas")
    .select(
      "id, slug, name, status, payment_mode, buy_in_amount, prize_distribution, created_by",
    )
    .eq("slug", params.slug)
    .maybeSingle();

  if (pollaErr) {
    console.error("[payout-summary] polla lookup failed:", pollaErr);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
  if (!polla) {
    return NextResponse.json({ error: "Polla no encontrada" }, { status: 404 });
  }

  // Acceso: participante de la polla o el creador.
  const { data: viewerMembership } = await admin
    .from("polla_participants")
    .select("role, status")
    .eq("polla_id", polla.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!viewerMembership && polla.created_by !== user.id) {
    return NextResponse.json({ error: "No tienes acceso" }, { status: 403 });
  }

  const isAdmin =
    viewerMembership?.role === "admin" || polla.created_by === user.id;

  // Participantes que ENTRAN al pozo: approved + paid. Si la polla es
  // pay_winner, paid=true al join (nada que cobrar al inicio); si es
  // admin_collects, paid=true cuando el admin aprueba el comprobante.
  const { data: partsRaw } = await admin
    .from("polla_participants")
    .select(
      "user_id, rank, total_points, joined_at, paid, status, payout_method, payout_account, users:user_id ( id, display_name )",
    )
    .eq("polla_id", polla.id)
    .eq("status", "approved")
    .eq("paid", true);

  const parts = (partsRaw ?? []) as unknown as ParticipantRow[];

  const buyIn = Number(polla.buy_in_amount ?? 0);
  const pot = parts.length * buyIn;
  const paymentMode = (polla.payment_mode as PaymentMode | null) ?? "admin_collects";
  const prizeDistribution = polla.prize_distribution as PrizeDistribution | null;

  // Si la polla todavía no terminó, devolvemos el preview sin persistir.
  // canSettle=false hasta que polla.status='ended'.
  const isEnded = polla.status === "ended";

  const computation = computePayout({
    participants: parts.map((p) => ({
      user_id: p.user_id,
      display_name: p.users?.display_name ?? "—",
      rank: p.rank ?? 9999,
      joined_at: p.joined_at,
    })),
    prizeDistribution,
    pot,
    buyIn,
    paymentMode,
    adminUserId: polla.created_by,
  });

  // Persistir transactions una sola vez después del cierre. Si ya hay
  // filas en polla_payouts no tocamos nada (idempotente). Si no hay
  // filas, insertamos las nuevas. Insert con onConflict para que un
  // recompute paralelo no choque.
  let persisted: Array<{
    id: string;
    polla_id: string;
    from_user_id: string;
    to_user_id: string;
    amount: number;
    paid_at: string | null;
    paid_by_user_id: string | null;
    notes: string | null;
    created_at: string;
  }> = [];

  if (isEnded) {
    const { data: existing } = await admin
      .from("polla_payouts")
      .select(
        "id, polla_id, from_user_id, to_user_id, amount, paid_at, paid_by_user_id, notes, created_at",
      )
      .eq("polla_id", polla.id);

    persisted = existing ?? [];

    if (
      computation.errors.length === 0 &&
      computation.transactions.length > 0 &&
      persisted.length === 0
    ) {
      const rows = computation.transactions.map((t) => ({
        polla_id: polla.id,
        from_user_id: t.from_user_id,
        to_user_id: t.to_user_id,
        amount: t.amount,
      }));
      const { data: inserted, error: insErr } = await admin
        .from("polla_payouts")
        .insert(rows)
        .select(
          "id, polla_id, from_user_id, to_user_id, amount, paid_at, paid_by_user_id, notes, created_at",
        );
      if (insErr) {
        // Race posible: dos requests calcularon a la vez y la otra
        // ya escribió. La UNIQUE (polla, from, to) catchea, así que
        // re-leemos las filas persistidas en vez de devolver [].
        console.warn("[payout-summary] insert race or constraint error, re-reading:", insErr.message);
        const { data: refetched } = await admin
          .from("polla_payouts")
          .select(
            "id, polla_id, from_user_id, to_user_id, amount, paid_at, paid_by_user_id, notes, created_at",
          )
          .eq("polla_id", polla.id);
        persisted = refetched ?? [];
      } else {
        persisted = inserted ?? [];
      }
    }
  }

  // Decoración: nombre + método de cobro del receptor para cada tx.
  const partsByUser = new Map<string, ParticipantRow>();
  for (const p of parts) partsByUser.set(p.user_id, p);

  // Necesitamos el nombre del admin si no es participante (admin_collects
  // típico). Lo cargamos por separado solo si hace falta.
  let adminDisplayName: string | null = null;
  if (!partsByUser.has(polla.created_by)) {
    const { data: adminUser } = await admin
      .from("users")
      .select("id, display_name")
      .eq("id", polla.created_by)
      .maybeSingle();
    adminDisplayName = adminUser?.display_name ?? null;
  }
  const nameFor = (uid: string): string => {
    const p = partsByUser.get(uid);
    if (p?.users?.display_name) return p.users.display_name;
    if (uid === polla.created_by && adminDisplayName) return adminDisplayName;
    if (uid === polla.created_by) return "Admin";
    return "—";
  };

  const decoratedTransactions = persisted.map((t) => {
    const toP = partsByUser.get(t.to_user_id);
    return {
      id: t.id,
      from_user_id: t.from_user_id,
      to_user_id: t.to_user_id,
      from_display_name: nameFor(t.from_user_id),
      to_display_name: nameFor(t.to_user_id),
      to_payout_method: toP?.payout_method ?? null,
      to_payout_account: toP?.payout_account ?? null,
      amount: Number(t.amount),
      paid_at: t.paid_at,
      paid_by_user_id: t.paid_by_user_id,
      created_at: t.created_at,
      involvesViewer:
        t.from_user_id === user.id || t.to_user_id === user.id || isAdmin,
    };
  });

  const myAllocation = computation.allocations.find(
    (a) => a.user_id === user.id,
  );
  const isViewerWinner = !!myAllocation && myAllocation.allocation > 0;

  const viewerParticipant = partsByUser.get(user.id);
  const viewerHasPayoutAccount = !!(
    viewerParticipant?.payout_method && viewerParticipant?.payout_account
  );

  // Resúmen rápido de "tus pendientes" para el banner / modal.
  const myOutgoing = decoratedTransactions.filter(
    (t) => t.from_user_id === user.id && !t.paid_at,
  );
  const myIncoming = decoratedTransactions.filter(
    (t) => t.to_user_id === user.id && !t.paid_at,
  );
  const allUnpaidTransactions = decoratedTransactions.filter((t) => !t.paid_at);

  return NextResponse.json({
    polla: {
      id: polla.id,
      slug: polla.slug,
      name: polla.name,
      status: polla.status,
      payment_mode: paymentMode,
      buy_in_amount: buyIn,
      created_by: polla.created_by,
    },
    pot,
    isEnded,
    isAdmin,
    isViewerWinner,
    viewerHasPayoutAccount,
    myAllocation: myAllocation
      ? {
          allocation: myAllocation.allocation,
          rank: myAllocation.rank,
          isTied: myAllocation.isTied,
        }
      : null,
    allocations: computation.allocations.map((a) => ({
      user_id: a.user_id,
      display_name: a.display_name,
      rank: a.rank,
      allocation: a.allocation,
      isTied: a.isTied,
      payout_method: partsByUser.get(a.user_id)?.payout_method ?? null,
      payout_account: partsByUser.get(a.user_id)?.payout_account ?? null,
    })),
    transactions: decoratedTransactions,
    myOutgoing,
    myIncoming,
    allUnpaidTransactions,
    pendingTransactionsCount: allUnpaidTransactions.length,
    errors: computation.errors,
    warnings: computation.warnings,
    canSettle:
      isEnded &&
      computation.errors.length === 0 &&
      computation.transactions.length > 0,
  });
}

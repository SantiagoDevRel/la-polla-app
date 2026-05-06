// app/api/admin/payouts-by-polla/route.ts
//
// GET → todos los pagos (polla_payouts) agrupados por polla. El admin
// dashboard lo usa para tener vista global del estado de pagos sin
// tener que entrar polla por polla.
//
// Solo pollas que tienen al menos 1 fila en polla_payouts (osea pollas
// que ya cerraron y se computaron las allocations).

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCurrentUserAdmin } from "@/lib/auth/admin";

interface PayoutRow {
  id: string;
  polla_id: string;
  from_user_id: string;
  to_user_id: string;
  amount: number;
  paid_at: string | null;
  paid_by_user_id: string | null;
  proof_storage_path: string | null;
  proof_uploaded_at: string | null;
  created_at: string;
}

interface PollaRow {
  id: string;
  slug: string;
  name: string;
  status: string;
  payment_mode: string;
  buy_in_amount: number;
}

interface UserRow {
  id: string;
  display_name: string | null;
}

export async function GET() {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const admin = createAdminClient();

  const { data: txs, error: txErr } = await admin
    .from("polla_payouts")
    .select(
      "id, polla_id, from_user_id, to_user_id, amount, paid_at, paid_by_user_id, proof_storage_path, proof_uploaded_at, created_at",
    )
    .order("created_at", { ascending: false });

  if (txErr) {
    return NextResponse.json(
      { error: "query failed", detail: txErr.message },
      { status: 500 },
    );
  }

  const transactions = (txs ?? []) as PayoutRow[];
  if (transactions.length === 0) {
    return NextResponse.json({ pollas: [] });
  }

  const pollaIds = Array.from(new Set(transactions.map((t) => t.polla_id)));
  const userIds = Array.from(
    new Set(transactions.flatMap((t) => [t.from_user_id, t.to_user_id])),
  );

  const [{ data: pollas }, { data: users }] = await Promise.all([
    admin
      .from("pollas")
      .select("id, slug, name, status, payment_mode, buy_in_amount")
      .in("id", pollaIds),
    admin
      .from("users")
      .select("id, display_name")
      .in("id", userIds),
  ]);

  const pollaById = new Map<string, PollaRow>();
  for (const p of (pollas ?? []) as PollaRow[]) pollaById.set(p.id, p);
  const userById = new Map<string, UserRow>();
  for (const u of (users ?? []) as UserRow[]) userById.set(u.id, u);

  // Group by polla_id, mantener orden de pollas por la transaccion mas
  // reciente (pollas con actividad reciente arriba).
  const byPolla = new Map<
    string,
    {
      polla: PollaRow | null;
      txs: Array<{
        id: string;
        fromName: string;
        toName: string;
        amount: number;
        paid: boolean;
        paidAt: string | null;
        hasProof: boolean;
        proofUploadedAt: string | null;
      }>;
      paidCount: number;
      pendingCount: number;
      totalAmount: number;
      paidAmount: number;
    }
  >();

  for (const t of transactions) {
    const polla = pollaById.get(t.polla_id) ?? null;
    let bucket = byPolla.get(t.polla_id);
    if (!bucket) {
      bucket = {
        polla,
        txs: [],
        paidCount: 0,
        pendingCount: 0,
        totalAmount: 0,
        paidAmount: 0,
      };
      byPolla.set(t.polla_id, bucket);
    }
    const isPaid = Boolean(t.paid_at);
    bucket.txs.push({
      id: t.id,
      fromName: userById.get(t.from_user_id)?.display_name ?? "—",
      toName: userById.get(t.to_user_id)?.display_name ?? "—",
      amount: Number(t.amount),
      paid: isPaid,
      paidAt: t.paid_at,
      hasProof: Boolean(t.proof_storage_path),
      proofUploadedAt: t.proof_uploaded_at,
    });
    bucket.totalAmount += Number(t.amount);
    if (isPaid) {
      bucket.paidCount++;
      bucket.paidAmount += Number(t.amount);
    } else {
      bucket.pendingCount++;
    }
  }

  // Sort tx adentro: pendientes primero, después pagadas (por paid_at desc).
  for (const b of Array.from(byPolla.values())) {
    b.txs.sort((a, c) => {
      if (a.paid !== c.paid) return a.paid ? 1 : -1;
      return (c.paidAt ?? "").localeCompare(a.paidAt ?? "");
    });
  }

  // Pollas ordenadas: la que tenga mas pendientes arriba; empate por
  // total amount desc.
  const pollasOut = Array.from(byPolla.entries())
    .map(([pollaId, b]) => ({
      pollaId,
      pollaSlug: b.polla?.slug ?? null,
      pollaName: b.polla?.name ?? "—",
      pollaStatus: b.polla?.status ?? "—",
      paymentMode: b.polla?.payment_mode ?? "—",
      buyIn: Number(b.polla?.buy_in_amount ?? 0),
      totalAmount: b.totalAmount,
      paidAmount: b.paidAmount,
      paidCount: b.paidCount,
      pendingCount: b.pendingCount,
      txs: b.txs,
    }))
    .sort((a, b) => {
      if (a.pendingCount !== b.pendingCount) return b.pendingCount - a.pendingCount;
      return b.totalAmount - a.totalAmount;
    });

  return NextResponse.json({ pollas: pollasOut });
}

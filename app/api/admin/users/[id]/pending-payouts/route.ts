// app/api/admin/users/[id]/pending-payouts/route.ts
//
// GET → mismos pending payouts que /api/users/me/pending-payouts pero
// para cualquier user_id (admin only). El admin lo usa para previsualizar
// "lo que ve Casvi" / "lo que ve John" / etc desde el dashboard, sin
// tener que loguearse como esa persona.
//
// Read-only: el endpoint solo devuelve datos. La UI del admin se encarga
// de renderizar sin botones de accion.

import { NextResponse } from "next/server";
import { isCurrentUserAdmin } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { materializePayoutsIfNeeded } from "@/lib/pollas/materialize-payouts";

interface Params {
  params: { id: string };
}

interface PayoutRow {
  id: string;
  polla_id: string;
  from_user_id: string;
  to_user_id: string;
  amount: number;
  paid_at: string | null;
  proof_storage_path: string | null;
  proof_uploaded_at: string | null;
}

interface PollaRow {
  id: string;
  slug: string;
  name: string;
  payment_mode: string;
  created_by: string;
}

interface ParticipantRow {
  polla_id: string;
  user_id: string;
  role: string;
  payout_method: string | null;
  payout_account: string | null;
}

interface UserRow {
  id: string;
  display_name: string | null;
}

export async function GET(_request: Request, { params }: Params) {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const targetUserId = params.id;
  const admin = createAdminClient();

  const { data: target } = await admin
    .from("users")
    .select("id, display_name")
    .eq("id", targetUserId)
    .maybeSingle();

  if (!target) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }

  // Mismo pipeline que /api/users/me/pending-payouts, pero filtrando por
  // targetUserId en lugar del viewer.
  const [{ data: myParts }, { data: myAdminPollas }] = await Promise.all([
    admin
      .from("polla_participants")
      .select("polla_id, role")
      .eq("user_id", targetUserId),
    admin
      .from("pollas")
      .select("id")
      .eq("created_by", targetUserId),
  ]);

  const pollaIds = new Set<string>();
  for (const p of (myParts ?? []) as Array<{ polla_id: string }>)
    pollaIds.add(p.polla_id);
  for (const p of (myAdminPollas ?? []) as Array<{ id: string }>)
    pollaIds.add(p.id);

  if (pollaIds.size === 0) {
    return NextResponse.json({
      target: { id: target.id, displayName: target.display_name },
      pending: [],
    });
  }

  // Lazy materialize por si alguna polla cerrada todavía no tiene tx.
  await materializePayoutsIfNeeded(admin, Array.from(pollaIds));

  const { data: txs } = await admin
    .from("polla_payouts")
    .select(
      "id, polla_id, from_user_id, to_user_id, amount, paid_at, proof_storage_path, proof_uploaded_at",
    )
    .in("polla_id", Array.from(pollaIds))
    .is("paid_at", null);

  const transactions = (txs ?? []) as PayoutRow[];
  if (transactions.length === 0) {
    return NextResponse.json({
      target: { id: target.id, displayName: target.display_name },
      pending: [],
    });
  }

  const involvedPollaIds = Array.from(new Set(transactions.map((t) => t.polla_id)));
  const involvedUserIds = Array.from(
    new Set(transactions.flatMap((t) => [t.from_user_id, t.to_user_id])),
  );

  const [{ data: pollas }, { data: parts }, { data: users }] = await Promise.all([
    admin
      .from("pollas")
      .select("id, slug, name, payment_mode, created_by")
      .in("id", involvedPollaIds),
    admin
      .from("polla_participants")
      .select("polla_id, user_id, role, payout_method, payout_account")
      .in("polla_id", involvedPollaIds),
    admin
      .from("users")
      .select("id, display_name")
      .in("id", involvedUserIds),
  ]);

  const pollaById = new Map<string, PollaRow>();
  for (const p of (pollas ?? []) as PollaRow[]) pollaById.set(p.id, p);

  const userById = new Map<string, UserRow>();
  for (const u of (users ?? []) as UserRow[]) userById.set(u.id, u);

  const partByKey = new Map<string, ParticipantRow>();
  for (const p of (parts ?? []) as ParticipantRow[]) {
    partByKey.set(`${p.polla_id}|${p.user_id}`, p);
  }

  const pending = transactions
    .filter((t) => t.from_user_id === targetUserId || t.to_user_id === targetUserId)
    .map((t) => {
      const polla = pollaById.get(t.polla_id);
      const direction: "incoming" | "outgoing" =
        t.to_user_id === targetUserId ? "incoming" : "outgoing";
      const counterpartyId =
        direction === "incoming" ? t.from_user_id : t.to_user_id;
      const counterparty = userById.get(counterpartyId);
      const counterpartyPart = partByKey.get(`${t.polla_id}|${counterpartyId}`);
      const counterpartyAccount =
        direction === "outgoing"
          ? {
              method: counterpartyPart?.payout_method ?? null,
              account: counterpartyPart?.payout_account ?? null,
            }
          : null;
      return {
        transactionId: t.id,
        pollaSlug: polla?.slug ?? "",
        pollaName: polla?.name ?? "Polla",
        paymentMode: polla?.payment_mode ?? "admin_collects",
        direction,
        amount: Number(t.amount),
        counterpartyName: counterparty?.display_name ?? "—",
        counterpartyAccount,
        hasProof: Boolean(t.proof_storage_path),
        proofUploadedAt: t.proof_uploaded_at,
      };
    });

  return NextResponse.json({
    target: { id: target.id, displayName: target.display_name },
    pending,
  });
}

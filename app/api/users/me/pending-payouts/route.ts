// app/api/users/me/pending-payouts/route.ts
//
// GET → todas las transacciones pendientes (paid_at IS NULL) en las
// que el viewer está involucrado:
//   - como from_user_id (debe pagar)  → outgoing
//   - como to_user_id   (le tienen que pagar) → incoming
//
// Y para admins de pollas finalizadas con tx pendientes que no
// involucran al admin directamente (admin_collects mode con admin no
// participante, raro pero posible) — esas también van.
//
// Se usa en /inicio para que el modal/banner de pagos aparezca para
// cada parte involucrada sin tener que entrar a cada polla.
//
// Devuelve también la cuenta de cobro del receptor para que el que
// paga pueda copiarla con un toque.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

interface PayoutRow {
  id: string;
  polla_id: string;
  from_user_id: string;
  to_user_id: string;
  amount: number;
  paid_at: string | null;
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

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const admin = createAdminClient();

  // 1. Pollas donde el user es participante O admin (created_by).
  //    Para ambos casos necesitamos saber el rol para decidir qué
  //    transacciones le mostramos.
  const [{ data: myParts }, { data: myAdminPollas }] = await Promise.all([
    admin
      .from("polla_participants")
      .select("polla_id, role")
      .eq("user_id", user.id),
    admin
      .from("pollas")
      .select("id")
      .eq("created_by", user.id),
  ]);

  const pollaIds = new Set<string>();
  for (const p of (myParts ?? []) as Array<{ polla_id: string }>) pollaIds.add(p.polla_id);
  for (const p of (myAdminPollas ?? []) as Array<{ id: string }>) pollaIds.add(p.id);

  if (pollaIds.size === 0) {
    return NextResponse.json({ pending: [] });
  }

  // 2. Transacciones unpaid en esas pollas.
  const { data: txs } = await admin
    .from("polla_payouts")
    .select("id, polla_id, from_user_id, to_user_id, amount, paid_at")
    .in("polla_id", Array.from(pollaIds))
    .is("paid_at", null);

  const transactions = (txs ?? []) as PayoutRow[];
  if (transactions.length === 0) {
    return NextResponse.json({ pending: [] });
  }

  // 3. Cargar pollas y participants para enriquecer.
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

  const partByKey = new Map<string, ParticipantRow>(); // key = `${polla_id}|${user_id}`
  for (const p of (parts ?? []) as ParticipantRow[]) {
    partByKey.set(`${p.polla_id}|${p.user_id}`, p);
  }

  // 4. Filtrar a las que involucran al viewer:
  //    - viewer = from o viewer = to → mostrar
  //    - viewer = admin de la polla y la transacción no involucra al
  //      viewer (ej. en pay_winner mode, otro user pagó a otro user)
  //      → no mostrar (no es asunto del admin a menos que él esté
  //      directamente involucrado).
  //    Resultado: solo mostramos lo que el viewer puede ACCIONAR.
  const pending = transactions
    .filter((t) => t.from_user_id === user.id || t.to_user_id === user.id)
    .map((t) => {
      const polla = pollaById.get(t.polla_id);
      const direction: "incoming" | "outgoing" =
        t.to_user_id === user.id ? "incoming" : "outgoing";
      const counterpartyId =
        direction === "incoming" ? t.from_user_id : t.to_user_id;
      const counterparty = userById.get(counterpartyId);
      const counterpartyPart = partByKey.get(`${t.polla_id}|${counterpartyId}`);
      // Si el otro lado es el admin (created_by) de la polla y NO
      // tiene row en polla_participants (caso admin_collects con
      // admin no participante), su cuenta de cobro no aplica acá —
      // el admin paga, no recibe.
      const counterpartyAccount =
        direction === "outgoing"
          ? {
              method: counterpartyPart?.payout_method ?? null,
              account: counterpartyPart?.payout_account ?? null,
            }
          : null;
      return {
        transactionId: t.id,
        pollaId: t.polla_id,
        pollaSlug: polla?.slug ?? "",
        pollaName: polla?.name ?? "Polla",
        paymentMode: polla?.payment_mode ?? "admin_collects",
        direction,
        amount: Number(t.amount),
        counterpartyName: counterparty?.display_name ?? "—",
        counterpartyAccount,
      };
    });

  return NextResponse.json({ pending });
}

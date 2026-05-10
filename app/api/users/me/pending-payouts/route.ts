// app/api/users/me/pending-payouts/route.ts
//
// GET → transacciones donde el viewer está involucrado, pendientes y
// pagadas-recientemente (últimos 30 días):
//   - como from_user_id (debe pagar / pagó)  → outgoing
//   - como to_user_id   (le pagan / le pagaron) → incoming
//
// El cliente filtra por `paidAt`:
//   - paidAt=null  → acción posible (marcar pagado / cobrar)
//   - paidAt!=null → solo info + botón "Ver comprobante"
//
// Por qué incluir las pagadas: el receptor necesita ver "X ya te pagó"
// para confirmar visualmente y revisar el comprobante. Si solo
// devolvieramos pendientes, las tx desaparecerían apenas el otro lado
// las marca y el receptor nunca ve el comprobante.
//
// Para admins de pollas finalizadas con tx pendientes que no
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
import { materializePayoutsIfNeeded } from "@/lib/pollas/materialize-payouts";

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
  // Default payout — fallback cuando el participant row no tiene cuenta
  // por-polla. El user puede haber guardado su cuenta de cobro a nivel
  // perfil (DefaultPayoutPromptModal o /perfil) sin haber pasado nunca
  // por el WinnerPayoutModal específico de esta polla.
  default_payout_method: string | null;
  default_payout_account: string | null;
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

  // 2. Lazy materialize: si alguna polla cerró pero las tx todavía no
  // se persistieron, las creamos en este momento. Esto hace que Casvi /
  // Dani / cualquier participante vea sus pagos en /inicio sin que el
  // admin tenga que entrar a la polla primero a abrir el modal.
  // Idempotente — si ya hay filas, no hace nada.
  await materializePayoutsIfNeeded(admin, Array.from(pollaIds));

  // 3. Transacciones de esas pollas: pendientes (paid_at IS NULL) +
  // pagadas-recientemente (paid_at >= 30 días atrás) para que el
  // receptor pueda ver el comprobante de las que ya le pagaron.
  const cutoff30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: txs } = await admin
    .from("polla_payouts")
    .select(
      "id, polla_id, from_user_id, to_user_id, amount, paid_at, proof_storage_path, proof_uploaded_at",
    )
    .in("polla_id", Array.from(pollaIds))
    .or(`paid_at.is.null,paid_at.gte.${cutoff30d}`);

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
      .select("id, display_name, default_payout_method, default_payout_account")
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

  // 4. Filtrar a las que involucran al viewer (from o to). Para
  //    incoming agregamos viewerNeedsAccount: si el viewer todavía
  //    no dejó payout_method+account en esa polla, el cliente le
  //    muestra el WinnerPayoutModal de "decinos cómo cobrar" antes
  //    de la lista regular.
  //    Para outgoing agregamos counterpartyAccount (la cuenta del que
  //    cobra, para que el que paga la pueda copiar).
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
      const viewerPart = partByKey.get(`${t.polla_id}|${user.id}`);
      // Si el otro lado es el admin (created_by) de la polla y NO
      // tiene row en polla_participants (caso admin_collects con
      // admin no participante), su cuenta de cobro no aplica acá —
      // el admin paga, no recibe.
      // Fallback al default_payout_* del user si el participant row de
      // esta polla no tiene cuenta. Cubre el caso: ganador ya guardó
      // cuenta a nivel perfil (en otra polla o desde /perfil) y el
      // payout_method/account a nivel polla nunca se llenó.
      const counterpartyAccount =
        direction === "outgoing"
          ? {
              method:
                counterpartyPart?.payout_method ??
                counterparty?.default_payout_method ??
                null,
              account:
                counterpartyPart?.payout_account ??
                counterparty?.default_payout_account ??
                null,
            }
          : null;
      const viewer = userById.get(user.id);
      const viewerHasAccount = Boolean(
        (viewerPart?.payout_method && viewerPart?.payout_account) ||
          (viewer?.default_payout_method && viewer?.default_payout_account),
      );
      const viewerNeedsAccount = direction === "incoming" && !viewerHasAccount;
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
        viewerNeedsAccount,
        hasProof: Boolean(t.proof_storage_path),
        proofUploadedAt: t.proof_uploaded_at,
        paidAt: t.paid_at,
      };
    });

  return NextResponse.json({ pending });
}

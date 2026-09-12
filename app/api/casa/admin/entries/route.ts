import { notifyCasaReview } from "@/lib/casa/review-notify";
// app/api/casa/admin/entries/route.ts — aprobar o rechazar un pago desde la web.
//
// Existe como RESPALDO del bot de Telegram, no como reemplazo. El bot es
// donde Tama vive (el pago pasa en la calle, con una mano, en 2 segundos),
// pero si Telegram se cae, o el chat nunca se vinculó, o se perdió el
// mensaje original, la cola de pagos queda muerta y la gente esperando.
// Con esto siempre hay una segunda puerta.
//
// La decisión que escribe es la MISMA que la del bot: `pagada` o `rechazada`
// con el guard anti doble-tap, para que las dos vías no puedan discrepar.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/auth/admin";
import { casaJson, casaError, requireCasaContract } from "@/lib/casa/operations";
import { signedProofUrl } from "@/lib/telegram/notify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  attemptId: z.string().uuid(),
  decision: z.enum(["aprobar", "rechazar"]),
  motivo: z.string().trim().max(200).optional(),
});

const cursorSchema = z.object({
  id: z.string().uuid(),
  uploadedAt: z.string().datetime({ offset: true }).nullable(),
  pollaId: z.string().uuid().nullable(),
}).strict();

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

/** GET — conteos completos o comprobantes paginados de una polla. */
export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser();
    if (!user?.is_admin) {
      return privateJson({ error: "Solo el admin." }, 403);
    }

    const db = createAdminClient();
    const params = req.nextUrl.searchParams;
    if (params.get("summary") === "1") {
      const counts: Record<string, number> = {};
      let after: string | null = null;
      // Cursor por UUID: revisar un pago entre tandas no desplaza el offset
      // ni hace saltar la siguiente fila. No se firman imagenes para contar.
      for (;;) {
        let query = db.from("casa_entries")
          .select("id, polla_id, casa_pollas!inner(archived_at,status)")
          .eq("status", "pendiente")
          .is("casa_pollas.archived_at", null)
          .in("casa_pollas.status", ["abierta", "cerrada"])
          .not("proof_path", "is", null)
          .order("id", { ascending: true })
          .limit(1000);
        if (after) query = query.gt("id", after);
        const { data, error } = await query;
        if (error) return privateJson({ error: "No se pudieron cargar los pagos pendientes." }, 500);
        const rows: { id: string; polla_id: string }[] = data ?? [];
        for (const row of rows) counts[row.polla_id] = (counts[row.polla_id] ?? 0) + 1;
        if (rows.length < 1000) break;
        after = rows[rows.length - 1].id;
      }
      return privateJson({ counts });
    }

    const pollaId = params.get("pollaId");
    const rawPage = params.get("page") ?? "0";
    const page = Number(rawPage);
    const pageSize = pollaId ? 25 : 50;
    const offset = page * pageSize;
    if ((pollaId !== null && !z.string().uuid().safeParse(pollaId).success)
      || !/^\d+$/.test(rawPage) || !Number.isSafeInteger(offset + pageSize)) {
      return privateJson({ error: "Polla o página inválida." }, 400);
    }

    const rawCursor = params.get("cursor");
    let cursor: z.infer<typeof cursorSchema> | null = null;
    if (rawCursor !== null) {
      try {
        if (rawCursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(rawCursor)) throw new Error("Invalid cursor");
        cursor = cursorSchema.parse(JSON.parse(Buffer.from(rawCursor, "base64url").toString("utf8")));
        if (cursor.pollaId !== pollaId || page !== 0) throw new Error("Wrong cursor scope");
      } catch {
        return privateJson({ error: "Cursor de pagos inválido." }, 400);
      }
    }

    let query = db
      .from("casa_entries")
      .select("id, polla_id, user_id, amount_cop, ticket_number, proof_path, current_proof_attempt_id, proof_uploaded_at, casa_pollas!inner(archived_at,status)")
      .eq("status", "pendiente")
      .is("casa_pollas.archived_at", null)
          .in("casa_pollas.status", ["abierta", "cerrada"])
      .not("proof_path", "is", null)
      .order("proof_uploaded_at", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true });
    if (pollaId) query = query.eq("polla_id", pollaId);
    if (cursor) {
      // Seek after the last visible row, even if another admin or Telegram
      // has since resolved it or any preceding payment. NULL dates sort last.
      query = cursor.uploadedAt === null
        ? query.is("proof_uploaded_at", null).gt("id", cursor.id)
        : query.or(`proof_uploaded_at.gt.${cursor.uploadedAt},and(proof_uploaded_at.eq.${cursor.uploadedAt},id.gt.${cursor.id}),proof_uploaded_at.is.null`);
    }
    // Keep ?page for older clients; the current queue always uses cursors.
    const { data: fetched, error: entriesError } = await (params.has("page") && !cursor
      ? query.range(offset, offset + pageSize)
      : query.limit(pageSize + 1));
    if (entriesError) return privateJson({ error: "No se pudieron cargar los pagos pendientes." }, 500);
    const hasMore = (fetched?.length ?? 0) > pageSize;
    const entries = (fetched ?? []).slice(0, pageSize);

    if (entries.length === 0) return privateJson({ pendientes: [], hasMore: false, nextCursor: null });

    const lastEntry = entries[entries.length - 1];
    const nextCursor = hasMore ? Buffer.from(JSON.stringify({
      id: lastEntry.id,
      uploadedAt: lastEntry.proof_uploaded_at ?? null,
      pollaId,
    })).toString("base64url") : null;

    // Nombres y pollas en dos queries, no una por fila.
    // filter/indexOf en vez de [...new Set()]: el target de tsconfig es ES5.
    // (tsgo deja pasar el spread de un Set; `tsc`, que es el que corre en el
    //  build de produccion, lo rechaza.)
    const userIds = entries
      .map((e) => e.user_id)
      .filter((v, i, a) => a.indexOf(v) === i);
    const pollaIds = entries
      .map((e) => e.polla_id)
      .filter((v, i, a) => a.indexOf(v) === i);

    const [{ data: users, error: usersError }, { data: pollas, error: pollasError }] = await Promise.all([
      db.from("users").select("id, display_name").in("id", userIds),
      db.from("casa_pollas").select("id, name, slug").in("id", pollaIds),
    ]);
    if (usersError || pollasError) return privateJson({ error: "No se pudieron cargar los datos de los pagos." }, 500);

    const nombre = new Map((users ?? []).map((u) => [u.id, u.display_name]));
    const polla = new Map((pollas ?? []).map((p) => [p.id, p]));

    const pendientes = await Promise.all(
      entries.map(async (e) => {
        // Capture legacy metadata once, then bind the displayed proof to its attempt.
        let attemptId = e.current_proof_attempt_id;
        if (!attemptId) {
          const captured = await db.rpc("casa_legacy_proof_attempt_v2", { p_entry_id: e.id, p_contract: 2, p_actor_id: user.id });
          if (captured.error) {
            if (["OPERATIONS_PAUSED", "CASA_V2_NOT_ACTIVE"].includes(captured.error.message)) throw captured.error;
            // The pool/entry may have closed or been reviewed after the list read.
            if (["POLLA_FINAL", "DRAW_PENDING", "PROOF_NOT_UPLOADED", "ALREADY_REVIEWED"].includes(captured.error.message)) return null;
            throw captured.error;
          }
          attemptId = captured.data;
          const proof = await db.from("casa_entry_proof_attempts").select("proof_path")
            .eq("id", attemptId).eq("entry_id", e.id).single();
          if (proof.error || proof.data.proof_path !== e.proof_path) return null;
        }
        return ({
        id: e.id,
        attemptId,
        pollaId: e.polla_id,
        jugador: nombre.get(e.user_id) ?? "Sin nombre",
        polla: polla.get(e.polla_id)?.name ?? "?",
        pollaSlug: polla.get(e.polla_id)?.slug ?? "",
        montoCop: e.amount_cop,
        boleta: e.ticket_number,
        subidoEn: e.proof_uploaded_at,
        // URL firmada de 1h: el bucket es privado y así se ve sin exponerlo.
        comprobanteUrl: e.proof_path ? await signedProofUrl(e.proof_path) : null,
      }); }),
    );

    return privateJson({ pendientes: pendientes.filter((entry) => entry !== null), hasMore, nextCursor });
  } catch (error) {
    if (["OPERATIONS_PAUSED", "CASA_V2_NOT_ACTIVE"].includes((error as { message?: string }).message ?? "")) return casaError(error as { message: string });
    return privateJson({ error: "No se pudieron cargar los pagos pendientes." }, 500);
  }
}

/** POST — la decisión. */
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return casaJson({ error: "No autenticado." }, 401);
  if (!user.is_admin) return casaJson({ error: "Solo el administrador." }, 403);
  const contractError = requireCasaContract(req);
  if (contractError) return contractError;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return casaJson({ error: "Datos inválidos." }, 400);
  const { attemptId, decision, motivo } = parsed.data;
  const { data, error } = await createAdminClient().rpc("casa_review_attempt_v2", {
    p_attempt_id: attemptId, p_decision: decision === "aprobar" ? "pagada" : "rechazada",
    p_reason: motivo ?? null, p_contract: 2, p_actor_id: user.id,
  });
  if (error) return casaError(error);
  if (data.changed) await notifyCasaReview(data.entry_id, data.polla_id, decision === "aprobar");
  return casaJson({ ok: true, ...data });
}

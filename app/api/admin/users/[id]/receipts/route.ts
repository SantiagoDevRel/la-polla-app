// app/api/admin/users/[id]/receipts/route.ts — comprobantes enviados por un usuario.
//
// Solo administradores. La sesión y `users.is_admin` se validan antes de tocar
// la base. Cuenta cada comprobante CONFIRMADO (los que llegaron de verdad al
// servidor) desde USER_RECEIPT_HISTORY_START, incluidos los rechazados y los
// reemplazados, y firma las imágenes por una hora: el bucket es privado.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { signedProofUrl } from "@/lib/telegram/notify";
import { USER_RECEIPT_HISTORY_START, receiptOutcome } from "@/lib/casa/user-receipts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAGE_SIZE = 20;

const cursorSchema = z.object({
  confirmedAt: z.string().datetime({ offset: true }),
  id: z.string().uuid(),
}).strict();

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

interface AttemptRow {
  id: string;
  entry_id: string;
  confirmed_at: string;
  decision: string | null;
  reviewed_at: string | null;
  review_reason: string | null;
  proof_path: string;
  casa_entries: { polla_id: string; amount_cop: number; ticket_number: number | null; entry_number: number | null; current_proof_attempt_id: string | null; status: string } | null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await getAuthenticatedUser();
    if (!admin) return privateJson({ error: "No autenticado." }, 401);
    if (!admin.is_admin) return privateJson({ error: "Solo el administrador." }, 403);

    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return privateJson({ error: "Usuario inválido." }, 400);

    const rawCursor = req.nextUrl.searchParams.get("cursor");
    let cursor: z.infer<typeof cursorSchema> | null = null;
    if (rawCursor !== null) {
      try {
        if (rawCursor.length > 256 || !/^[A-Za-z0-9_-]+$/.test(rawCursor)) throw new Error("cursor");
        cursor = cursorSchema.parse(JSON.parse(Buffer.from(rawCursor, "base64url").toString("utf8")));
      } catch {
        return privateJson({ error: "Cursor inválido." }, 400);
      }
    }

    const db = createAdminClient();
    const since = new Date(USER_RECEIPT_HISTORY_START).toISOString();

    const base = () => db.from("casa_entry_proof_attempts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", id)
      .eq("state", "confirmed")
      .gte("confirmed_at", since);

    let listQuery = db.from("casa_entry_proof_attempts")
      .select("id, entry_id, confirmed_at, decision, reviewed_at, review_reason, proof_path, casa_entries!casa_entry_proof_attempts_entry_id_fkey!inner(polla_id, amount_cop, ticket_number, entry_number, current_proof_attempt_id, status)")
      .eq("user_id", id)
      .eq("state", "confirmed")
      .gte("confirmed_at", since)
      .order("confirmed_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(PAGE_SIZE + 1);
    if (cursor) {
      listQuery = listQuery.or(`confirmed_at.lt.${cursor.confirmedAt},and(confirmed_at.eq.${cursor.confirmedAt},id.lt.${cursor.id})`);
    }

    const [userResult, total, aprobados, rechazados, list] = await Promise.all([
      db.from("users").select("id, display_name, whatsapp_number, created_at").eq("id", id).maybeSingle(),
      base(),
      base().eq("decision", "pagada"),
      base().eq("decision", "rechazada"),
      listQuery,
    ]);
    if (userResult.error || total.error || aprobados.error || rechazados.error || list.error) {
      return privateJson({ error: "No se pudo cargar el historial." }, 500);
    }
    if (!userResult.data) return privateJson({ error: "Ese usuario no existe." }, 404);

    const rows = (list.data ?? []) as unknown as AttemptRow[];
    const hasMore = rows.length > PAGE_SIZE;
    const page = rows.slice(0, PAGE_SIZE);
    const last = page[page.length - 1];
    const nextCursor = hasMore && last
      ? Buffer.from(JSON.stringify({ confirmedAt: last.confirmed_at, id: last.id })).toString("base64url")
      : null;

    const pollaIds = page
      .map((row) => row.casa_entries?.polla_id)
      .filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index);
    const pollas = pollaIds.length
      ? await db.from("casa_pollas").select("id, name").in("id", pollaIds)
      : { data: [], error: null };
    if (pollas.error) return privateJson({ error: "No se pudo cargar el historial." }, 500);
    const pollaName = new Map((pollas.data ?? []).map((polla) => [polla.id, polla.name as string]));

    const recibos = await Promise.all(page.map(async (row) => ({
      id: row.id,
      pollaId: row.casa_entries?.polla_id ?? null,
      polla: row.casa_entries ? pollaName.get(row.casa_entries.polla_id) ?? "Polla sin nombre" : "Polla sin nombre",
      montoCop: row.casa_entries?.amount_cop ?? null,
      boleta: row.casa_entries?.ticket_number ?? null,
      participacion: row.casa_entries?.entry_number ?? null,
      enviadoEn: row.confirmed_at,
      revisadoEn: row.reviewed_at,
      motivo: row.review_reason,
      estado: receiptOutcome({
        id: row.id,
        decision: row.decision,
        currentAttemptId: row.casa_entries?.current_proof_attempt_id ?? null,
        entryStatus: row.casa_entries?.status ?? null,
      }),
      comprobanteUrl: await signedProofUrl(row.proof_path),
    })));

    const totalCount = total.count ?? 0;
    const aprobadosCount = aprobados.count ?? 0;
    const rechazadosCount = rechazados.count ?? 0;

    return privateJson({
      usuario: {
        id: userResult.data.id,
        nombre: userResult.data.display_name,
        telefono: userResult.data.whatsapp_number,
      },
      desde: since,
      resumen: {
        enviados: totalCount,
        aprobados: aprobadosCount,
        rechazados: rechazadosCount,
        sinDecision: Math.max(0, totalCount - aprobadosCount - rechazadosCount),
      },
      recibos,
      hasMore,
      nextCursor,
    });
  } catch {
    return privateJson({ error: "No se pudo cargar el historial." }, 500);
  }
}

// lib/casa/proof-server.ts — la parte de servidor del comprobante de pago.
//
// La web (app/api/casa/pollas/[slug]/join/route.ts) y el bot de Telegram para
// jugadores recorren el mismo contrato v2 (migración 098): begin crea o retoma
// un intento inmutable, el archivo va al bucket privado en la ruta que decidió
// SQL, y confirm lo verifica byte a byte antes de ponerlo en revisión. Aquí
// viven los pasos que no dependen de quién subió el archivo, para que no haya
// dos versiones del flujo del dinero.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPot } from "./queries";
import { verifyCasaUpload } from "./uploads";
import type { CasaPolla } from "./types";
import { notifyNewProof, PROOF_BUCKET } from "@/lib/telegram/notify";

export const CASA_CONTRACT = 2;

export type ProofContentType = "image/jpeg" | "image/png" | "image/webp";

export interface BeginProofInput {
  pollaId: string;
  userId: string;
  requestId: string;
  ticketNumber: number | null;
  sha256: string;
  contentType: ProofContentType;
  bytes: number;
}

export interface BeginProofData {
  entry_id: string;
  attempt_id: string;
  state: "uploading" | "confirmed";
  proof_path: string;
  entry_status?: string;
  expires_at?: string;
}

export function beginCasaProof(db: SupabaseClient, input: BeginProofInput) {
  return db.rpc("casa_begin_entry_proof_v2", {
    p_polla_id: input.pollaId,
    p_user_id: input.userId,
    p_request_id: input.requestId,
    p_ticket: input.ticketNumber,
    p_sha256: input.sha256,
    p_content_type: input.contentType,
    p_bytes: input.bytes,
    p_contract: CASA_CONTRACT,
  }) as unknown as Promise<{ data: BeginProofData | null; error: { message?: string; code?: string } | null }>;
}

export interface OwnedAttempt {
  id: string;
  entry_id: string;
  proof_path: string;
  state: string;
  content_sha256: string;
  content_type: string;
  content_bytes: number;
}

/** Intento de ESTA persona en ESTA polla (filtro explícito por user_id). */
export async function readOwnedProofAttempt(
  db: SupabaseClient,
  input: { pollaId: string; userId: string; attemptId: string },
) {
  const { data, error } = await db.from("casa_entry_proof_attempts")
    .select("id, entry_id, proof_path, state, content_sha256, content_type, content_bytes, casa_entries!casa_entry_proof_attempts_entry_id_fkey!inner(polla_id)")
    .eq("id", input.attemptId).eq("user_id", input.userId).eq("casa_entries.polla_id", input.pollaId).maybeSingle();
  return { data: data as OwnedAttempt | null, error };
}

export function failCasaProof(db: SupabaseClient, input: { attemptId: string; userId: string }) {
  return db.rpc("casa_fail_entry_proof_v2", { p_attempt_id: input.attemptId, p_user_id: input.userId, p_contract: CASA_CONTRACT });
}

export type ConfirmProofResult =
  | { ok: true; data: { entry_id: string; attempt_id: string; state: string; changed: boolean; entry_status?: string } }
  | { ok: false; stage: "verify"; message: string; code?: string }
  | { ok: false; stage: "rpc"; error: { message?: string; code?: string } };

/**
 * Verifica el archivo (si el intento no estaba confirmado), confirma en SQL y,
 * si la confirmación es nueva, avisa a los administradores. El aviso es mejor
 * esfuerzo: el comprobante ya quedó en la cola de revisión aunque falle.
 */
export async function confirmCasaProof(
  db: SupabaseClient,
  polla: Pick<CasaPolla, "id" | "name" | "slug" | "prize_kind" | "prize_object">,
  userId: string,
  attempt: OwnedAttempt,
): Promise<ConfirmProofResult> {
  if (attempt.state !== "confirmed") {
    try {
      await verifyCasaUpload(PROOF_BUCKET, attempt.proof_path, attempt);
    } catch (error) {
      return {
        ok: false,
        stage: "verify",
        message: error instanceof Error ? error.message : "No se pudo verificar la carga.",
        code: (error as { code?: string }).code,
      };
    }
  }
  const { data, error } = await db.rpc("casa_confirm_entry_proof_v2", { p_attempt_id: attempt.id, p_user_id: userId, p_contract: CASA_CONTRACT });
  if (error) return { ok: false, stage: "rpc", error };
  if (data?.changed) await notifyProofToAdmins(db, polla, userId, attempt);
  return { ok: true, data };
}

async function notifyProofToAdmins(
  db: SupabaseClient,
  polla: Pick<CasaPolla, "id" | "name" | "slug" | "prize_kind" | "prize_object">,
  userId: string,
  attempt: OwnedAttempt,
): Promise<void> {
  try {
    const [{ data: profile }, { data: entry }, pot] = await Promise.all([
      db.from("users").select("display_name").eq("id", userId).maybeSingle(),
      db.from("casa_entries").select("amount_cop, ticket_number").eq("id", attempt.entry_id).eq("user_id", userId).single(),
      getPot(polla.id, attempt.entry_id),
    ]);
    if (entry) await notifyNewProof({
      entryId: attempt.entry_id, attemptId: attempt.id, pollaName: polla.name, pollaSlug: polla.slug,
      userName: profile?.display_name ?? "Sin nombre", amountCop: entry.amount_cop,
      proofPath: attempt.proof_path, ticketNumber: entry.ticket_number,
      potAfterCop: pot.projected_prize_cop ?? pot.prize_cop,
      prizeKind: polla.prize_kind, prizeObject: polla.prize_object,
    });
  } catch { console.warn("[casa/join] Comprobante confirmado; aviso administrativo pendiente de consulta en la cola."); }
}

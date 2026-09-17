// Proof upload uses an immutable attempt and goes directly to private Storage.
// The server steps (begin / confirm / fail) live in lib/casa/proof-server.ts,
// shared with the Telegram player bot.
import { cookies } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { linkReferralFromCookie } from "@/lib/casa/referrals";
import { REFERRAL_COOKIE } from "@/lib/casa/referrals-shared";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPollaBySlug } from "@/lib/casa/queries";
import { casaJson, casaError, requireCasaContract } from "@/lib/casa/operations";
import { signedCasaUpload } from "@/lib/casa/uploads";
import { PROOF_BUCKET } from "@/lib/telegram/notify";
import { beginCasaProof, confirmCasaProof, failCasaProof, readOwnedProofAttempt } from "@/lib/casa/proof-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("begin"), requestId: z.string().uuid(), ticketNumber: z.number().int().positive().nullable(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/), contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    bytes: z.number().int().positive().max(8 * 1024 * 1024),
    // Migración 131: número = esa participación, null = una nueva. Ausente = cliente viejo.
    entryNumber: z.number().int().min(1).max(50).nullable().optional() }),
  z.object({ action: z.enum(["confirm", "fail"]), attemptId: z.string().uuid() }),
]);

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return casaJson({ error: "Necesitas iniciar sesión." }, 401);
  const contractError = requireCasaContract(request);
  if (contractError) return contractError;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return casaJson({ error: "Datos de comprobante inválidos. Usa una imagen JPG, PNG o WEBP de hasta 8 MB." }, 400);
  const body = parsed.data;
  const polla = await getPollaBySlug((await params).slug);
  if (!polla || polla.status === "borrador") return casaJson({ error: "Esa polla no existe." }, 404);
  const db = createAdminClient();
  if (body.action === "begin") {
    // Invitaciones (migración 135): quien llegó por un enlace y todavía no
    // tiene invitador queda vinculado antes de su primer pago. "No es así" en
    // /pagar borra la cookie. Mejor esfuerzo: nunca frena el comprobante.
    const referral = await linkReferralFromCookie(user.id, (await cookies()).get(REFERRAL_COOKIE)?.value);
    const { data, error } = await beginCasaProof(db, {
      pollaId: polla.id, userId: user.id, requestId: body.requestId, ticketNumber: body.ticketNumber,
      sha256: body.sha256, contentType: body.contentType, bytes: body.bytes,
      entryNumber: polla.kind === "rifa" ? undefined : body.entryNumber,
    });
    const response = error || !data ? casaError(error ?? {})
      : data.state === "confirmed" ? casaJson({ ok: true, ...data })
      : await signedCasaUpload(PROOF_BUCKET, data.proof_path)
        .then((upload) => casaJson({ ok: true, ...data, upload }))
        .catch(() => casaJson({ error: "No se pudo preparar la carga. Reintenta con el mismo comprobante." }, 503));
    if (referral.clearCookie) response.cookies.delete(REFERRAL_COOKIE);
    return response;
  }
  const { data: attempt, error: readError } = await readOwnedProofAttempt(db, { pollaId: polla.id, userId: user.id, attemptId: body.attemptId });
  if (readError) return casaError(readError);
  if (!attempt) return casaJson({ error: "No existe este intento de carga." }, 404);
  if (body.action === "fail") {
    const { data, error } = await failCasaProof(db, { attemptId: attempt.id, userId: user.id });
    return error ? casaError(error) : casaJson({ ok: true, changed: data });
  }
  const confirmed = await confirmCasaProof(db, polla, user.id, attempt);
  if (!confirmed.ok) {
    return confirmed.stage === "verify"
      ? casaJson({ error: confirmed.message, code: confirmed.code }, 409)
      : casaError(confirmed.error);
  }
  return casaJson({ ok: true, ...confirmed.data });
}

// app/api/admin/test/verify-screenshot/route.ts
//
// POST — endpoint de TESTING para que el admin suba un screenshot,
// declare lo esperado (método + cuenta + nombre opcional + monto) y
// vea qué decide Haiku. NO escribe a polla_participants ni
// polla_payouts; solo retorna el veredicto + costos.
//
// Multipart/form-data esperado:
//   image:           File (image/jpeg|png|webp)
//   method:          string (nequi|bancolombia|otro)
//   account:         string
//   recipient_name:  string (opcional para nequi, requerido para
//                            bancolombia y otro)
//   amount:          string (COP, sin centavos)

import { NextRequest, NextResponse } from "next/server";
import { isCurrentUserAdmin, getAuthenticatedUser } from "@/lib/auth/admin";
import {
  verifyPaymentScreenshot,
  type PayoutMethod,
} from "@/lib/vision/verify-payment";
import { logClaudeUsage } from "@/lib/vision/log-usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_METHODS: PayoutMethod[] = ["nequi", "bancolombia", "otro"];

export async function POST(request: NextRequest) {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const me = await getAuthenticatedUser();
  const userId = me?.id ?? null;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const image = formData.get("image");
  const methodRaw = formData.get("method");
  const account = formData.get("account");
  const recipientName = formData.get("recipient_name");
  const amountRaw = formData.get("amount");

  if (!(image instanceof File) || image.size === 0) {
    return NextResponse.json({ error: "Falta image" }, { status: 400 });
  }
  if (typeof methodRaw !== "string" || !VALID_METHODS.includes(methodRaw as PayoutMethod)) {
    return NextResponse.json({ error: "method inválido (debe ser nequi, bancolombia u otro)" }, { status: 400 });
  }
  if (typeof account !== "string" || account.trim().length < 3) {
    return NextResponse.json({ error: "account inválido" }, { status: 400 });
  }
  // recipient_name: requerido para bancolombia y otro, opcional para nequi.
  const method = methodRaw as PayoutMethod;
  let nameForVerify: string | undefined;
  if (method === "nequi") {
    nameForVerify = typeof recipientName === "string" ? recipientName.trim() || undefined : undefined;
  } else {
    if (typeof recipientName !== "string" || recipientName.trim().length < 2) {
      return NextResponse.json(
        { error: `Para ${method} hay que poner el nombre completo del beneficiario.` },
        { status: 400 },
      );
    }
    nameForVerify = recipientName.trim();
  }
  if (typeof amountRaw !== "string") {
    return NextResponse.json({ error: "amount inválido" }, { status: 400 });
  }
  const amountCOP = parseInt(amountRaw.replace(/\D/g, ""), 10);
  if (!Number.isFinite(amountCOP) || amountCOP <= 0) {
    return NextResponse.json({ error: "amount debe ser > 0" }, { status: 400 });
  }

  const type = image.type;
  let mediaType: "image/jpeg" | "image/png" | "image/webp";
  if (type === "image/jpeg" || type === "image/jpg") mediaType = "image/jpeg";
  else if (type === "image/png") mediaType = "image/png";
  else if (type === "image/webp") mediaType = "image/webp";
  else {
    return NextResponse.json(
      { error: `Formato no soportado: ${type}. Usá JPG, PNG o WebP.` },
      { status: 400 },
    );
  }

  if (image.size > 10 * 1024 * 1024) {
    return NextResponse.json(
      { error: "Imagen mayor a 10 MB. Probá una más liviana." },
      { status: 413 },
    );
  }

  const arrayBuf = await image.arrayBuffer();
  const base64 = Buffer.from(arrayBuf).toString("base64");

  try {
    const result = await verifyPaymentScreenshot({
      imageBase64: base64,
      imageMediaType: mediaType,
      expected: {
        method,
        account: account.trim(),
        recipientName: nameForVerify,
        amountCOP,
      },
    });

    // Log a claude_api_usage. Best-effort — no rompe la response.
    void logClaudeUsage({
      userId,
      endpoint: "test/verify-screenshot",
      model: result.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      imageBytes: image.size,
      costUSD: result.costUSD,
      success: true,
    });

    return NextResponse.json({
      ok: true,
      result,
      bytesIn: image.size,
      mediaType,
    });
  } catch (err) {
    console.error("[admin/test/verify-screenshot] failed:", err);
    const message = err instanceof Error ? err.message : "Error desconocido";

    // Log la falla también para tener visibilidad en /admin.
    void logClaudeUsage({
      userId,
      endpoint: "test/verify-screenshot",
      model: "claude-haiku-4-5-20251001",
      tokensIn: 0,
      tokensOut: 0,
      imageBytes: image.size,
      costUSD: 0,
      success: false,
      errorMessage: message,
    });

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

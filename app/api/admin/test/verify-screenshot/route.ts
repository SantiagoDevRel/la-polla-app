// app/api/admin/test/verify-screenshot/route.ts
//
// POST — endpoint de TESTING para que el admin suba un screenshot,
// declare lo esperado (método + cuenta + monto) y vea qué decide
// Haiku. NO escribe a polla_participants ni polla_payouts; solo
// retorna el veredicto + costos.
//
// Multipart/form-data esperado:
//   image:   File (image/jpeg|png|webp)
//   method:  string (nequi|daviplata|bancolombia|transfiya|otro)
//   account: string
//   amount:  string (COP, sin centavos)

import { NextRequest, NextResponse } from "next/server";
import { isCurrentUserAdmin } from "@/lib/auth/admin";
import {
  verifyPaymentScreenshot,
  type PayoutMethod,
} from "@/lib/vision/verify-payment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_METHODS: PayoutMethod[] = [
  "nequi",
  "daviplata",
  "bancolombia",
  "transfiya",
  "otro",
];

export async function POST(request: NextRequest) {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const image = formData.get("image");
  const methodRaw = formData.get("method");
  const account = formData.get("account");
  const amountRaw = formData.get("amount");

  if (!(image instanceof File) || image.size === 0) {
    return NextResponse.json({ error: "Falta image" }, { status: 400 });
  }
  if (typeof methodRaw !== "string" || !VALID_METHODS.includes(methodRaw as PayoutMethod)) {
    return NextResponse.json({ error: "method inválido" }, { status: 400 });
  }
  if (typeof account !== "string" || account.trim().length < 3) {
    return NextResponse.json({ error: "account inválido" }, { status: 400 });
  }
  if (typeof amountRaw !== "string") {
    return NextResponse.json({ error: "amount inválido" }, { status: 400 });
  }
  const amountCOP = parseInt(amountRaw.replace(/\D/g, ""), 10);
  if (!Number.isFinite(amountCOP) || amountCOP <= 0) {
    return NextResponse.json({ error: "amount debe ser > 0" }, { status: 400 });
  }

  // Determinar media_type aceptado por Anthropic API.
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

  // Tamaño max 10MB upload — Haiku Vision igual va a auto-resize a 1568px.
  // Idealmente el cliente preprocesa con lib/vision/preprocess-image,
  // pero defensive cap por si suben raw.
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
        method: methodRaw as PayoutMethod,
        account: account.trim(),
        amountCOP,
      },
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
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

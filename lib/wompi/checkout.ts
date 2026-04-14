// lib/wompi/checkout.ts — Construye la URL del Checkout Web de Wompi.
// Firma de integridad: SHA256(reference + amountCents + currency + integrityKey)
import crypto from "crypto";

export interface BuildWompiCheckoutUrlParams {
  reference: string;
  amountCents: number;
  currency: string;
  redirectUrl: string;
}

export function buildWompiCheckoutUrl({
  reference,
  amountCents,
  currency,
  redirectUrl,
}: BuildWompiCheckoutUrlParams): string {
  const integrityKey = process.env.WOMPI_INTEGRITY_KEY;
  const publicKey = process.env.WOMPI_PUBLIC_KEY;

  if (!integrityKey || !publicKey) {
    throw new Error("Faltan WOMPI_PUBLIC_KEY o WOMPI_INTEGRITY_KEY");
  }

  const signatureString = `${reference}${amountCents}${currency}${integrityKey}`;
  const signature = crypto
    .createHash("sha256")
    .update(signatureString)
    .digest("hex");

  const params = new URLSearchParams({
    "public-key": publicKey,
    currency,
    "amount-in-cents": String(amountCents),
    reference,
    "signature:integrity": signature,
    "redirect-url": redirectUrl.replace(/[\r\n\t]/g, "").trim(),
  });

  return `https://checkout.wompi.co/p/?${params.toString()}`;
}

// lib/vision/verify-payment.ts
//
// Server-side wrapper para verificar un screenshot de pago contra una
// expectativa estructurada (método + cuenta + monto). Usa Claude Haiku
// 4.5 con temperature=0 para que el output sea determinista — la misma
// imagen + mismo expected da el mismo veredicto siempre.
//
// Devuelve un VerifyResult con los detalles que extrajo + el costo
// calculado en USD para logear en claude_api_usage.

import Anthropic from "@anthropic-ai/sdk";

export type PayoutMethod = "nequi" | "daviplata" | "bancolombia" | "transfiya" | "otro";

export interface VerifyExpected {
  method: PayoutMethod;
  /** Cuenta destino esperada (celular para nequi/daviplata, número de
   *  cuenta para bancolombia, llave/celular para transfiya, texto libre
   *  para otro). Se compara con detectedAccount normalizando dígitos. */
  account: string;
  /** Monto exacto esperado en COP. Sin centavos. Sin tolerancia. */
  amountCOP: number;
}

export interface VerifyResult {
  /** Decisión final: si auto-aprobar este pago o no. */
  valid: boolean;
  /** Confidence del análisis. 'low' siempre forza review manual. */
  confidence: "high" | "low";
  /** Lo que Haiku detectó del screenshot. */
  detectedAmount: number | null;
  detectedAccount: string | null;
  detectedMethod: string | null;
  detectedRecipientName: string | null;
  /** Texto libre con notas — útil para debugging y para mostrar al admin. */
  notes: string;
  /** Razón resumida de por qué se rechazó (si valid=false). */
  rejectionReason: string | null;
  /** Tokens consumidos para logging de costos. */
  tokensIn: number;
  tokensOut: number;
  /** Costo estimado en USD (Haiku 4.5 = $1/MTok in, $5/MTok out). */
  costUSD: number;
}

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const PRICE_IN_PER_MTOK = 1.0;
const PRICE_OUT_PER_MTOK = 5.0;

const SYSTEM_PROMPT = `Sos un verificador de comprobantes de pago bancario en Colombia. Recibís una imagen de un screenshot y un objeto con la transferencia esperada (método, cuenta destino y monto exacto en pesos colombianos).

Tu trabajo es decidir si el screenshot es legítimo Y si las cifras coinciden EXACTAMENTE con lo esperado.

Reglas estrictas:
1. La transferencia debe ser EXITOSA (no pendiente, no rechazada, no en proceso).
2. El monto debe ser EXACTAMENTE el esperado. No aceptes "más cerca", "pago parcial" ni "monto + comisión". Si dice 20.500 y se esperaban 20.000, es INVÁLIDO.
3. La cuenta destino del screenshot debe matchear la cuenta esperada. Comparar solo dígitos (ignorar espacios, puntos, guiones). Si la app muestra cuenta enmascarada (****1234), aceptar si los últimos dígitos coinciden.
4. El método debe matchear (Nequi, Daviplata, Bancolombia, Transfiya, otro). Si la imagen es de una app diferente, INVÁLIDO.
5. Si la imagen no es claramente un screenshot bancario o no podés leer las cifras, devolvé confidence: "low" y valid: false.
6. Confidence "high" solo si pudiste leer claramente: monto, cuenta destino, status del pago, fecha/hora.

Devolvé SIEMPRE un objeto JSON válido con esta forma exacta, sin markdown, sin texto antes o después:

{
  "valid": boolean,
  "confidence": "high" | "low",
  "detected_amount": number | null,
  "detected_account": string | null,
  "detected_method": string | null,
  "detected_recipient_name": string | null,
  "notes": string,
  "rejection_reason": string | null
}

Si valid=true, rejection_reason es null.
Si valid=false, rejection_reason explica brevemente por qué (en español, una oración).`;

function normalizeDigits(s: string): string {
  return (s ?? "").replace(/\D/g, "");
}

function methodLabel(m: PayoutMethod): string {
  switch (m) {
    case "nequi": return "Nequi";
    case "daviplata": return "Daviplata";
    case "bancolombia": return "Bancolombia";
    case "transfiya": return "Transfiya";
    case "otro": return "Otro";
  }
}

export async function verifyPaymentScreenshot(args: {
  imageBase64: string;
  imageMediaType: "image/jpeg" | "image/png" | "image/webp";
  expected: VerifyExpected;
}): Promise<VerifyResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY no está configurada");
  }
  const client = new Anthropic({ apiKey });

  const userText = `Verificá si este screenshot muestra un pago EXITOSO de exactamente $${args.expected.amountCOP.toLocaleString("es-CO")} COP a:
  - Método: ${methodLabel(args.expected.method)}
  - Cuenta destino: ${args.expected.account}

Si las tres cosas (monto exacto, cuenta destino, método) matchean → valid: true.
Cualquier otro caso → valid: false con rejection_reason específica.`;

  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 500,
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: args.imageMediaType,
              data: args.imageBase64,
            },
          },
          { type: "text", text: userText },
        ],
      },
    ],
  });

  const tokensIn = response.usage.input_tokens;
  const tokensOut = response.usage.output_tokens;
  const costUSD =
    (tokensIn * PRICE_IN_PER_MTOK + tokensOut * PRICE_OUT_PER_MTOK) / 1_000_000;

  // Parse del JSON. Si Haiku falla en devolver JSON puro (raro con
  // temperature=0 pero defendámonos), tratamos como confidence:low.
  const text = response.content
    .filter((c): c is Anthropic.TextBlock => c.type === "text")
    .map((c) => c.text)
    .join("");

  let parsed: {
    valid?: boolean;
    confidence?: "high" | "low";
    detected_amount?: number | null;
    detected_account?: string | null;
    detected_method?: string | null;
    detected_recipient_name?: string | null;
    notes?: string;
    rejection_reason?: string | null;
  } = {};
  try {
    // El modelo a veces envuelve en ```json ... ``` por más que pidamos plano.
    const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned);
  } catch {
    return {
      valid: false,
      confidence: "low",
      detectedAmount: null,
      detectedAccount: null,
      detectedMethod: null,
      detectedRecipientName: null,
      notes: `Respuesta no-JSON: ${text.slice(0, 200)}`,
      rejectionReason: "No pudimos parsear la respuesta del verificador.",
      tokensIn,
      tokensOut,
      costUSD,
    };
  }

  // Doble check determinista — aunque Haiku marque valid:true, validamos
  // los matches localmente con reglas estrictas. Defense-in-depth contra
  // alucinaciones del modelo.
  const detectedAccountDigits = normalizeDigits(parsed.detected_account ?? "");
  const expectedAccountDigits = normalizeDigits(args.expected.account);
  const accountMatches =
    detectedAccountDigits.length > 0 &&
    (detectedAccountDigits === expectedAccountDigits ||
      // Para cuentas enmascaradas (****1234), el detected suele tener
      // menos dígitos. Permitimos suffix-match si tiene al menos 4.
      (detectedAccountDigits.length >= 4 &&
        expectedAccountDigits.endsWith(detectedAccountDigits)));
  const amountMatches =
    typeof parsed.detected_amount === "number" &&
    parsed.detected_amount === args.expected.amountCOP;

  const finallyValid =
    !!parsed.valid && parsed.confidence === "high" && accountMatches && amountMatches;

  let rejectionReason = parsed.rejection_reason ?? null;
  if (!finallyValid && !rejectionReason) {
    if (!amountMatches) {
      rejectionReason = `Monto detectado (${parsed.detected_amount ?? "—"}) no coincide con el esperado ($${args.expected.amountCOP}).`;
    } else if (!accountMatches) {
      rejectionReason = `Cuenta detectada (${parsed.detected_account ?? "—"}) no coincide con la esperada (${args.expected.account}).`;
    } else if (parsed.confidence === "low") {
      rejectionReason = "El verificador no pudo leer el screenshot con confianza alta.";
    }
  }

  return {
    valid: finallyValid,
    confidence: parsed.confidence === "high" ? "high" : "low",
    detectedAmount: typeof parsed.detected_amount === "number" ? parsed.detected_amount : null,
    detectedAccount: parsed.detected_account ?? null,
    detectedMethod: parsed.detected_method ?? null,
    detectedRecipientName: parsed.detected_recipient_name ?? null,
    notes: parsed.notes ?? "",
    rejectionReason,
    tokensIn,
    tokensOut,
    costUSD,
  };
}

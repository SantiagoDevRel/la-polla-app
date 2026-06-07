// lib/vision/verify-payment.ts
//
// Server-side wrapper para verificar un screenshot de pago contra una
// expectativa estructurada. Usa Claude Haiku 4.5 con temperature=0
// para que el output sea determinista — la misma imagen + mismo
// expected da el mismo veredicto siempre.
//
// Métodos soportados (intencionalmente reducidos):
//   - 'nequi':       valida monto + cuenta (celular). NO valida nombre.
//   - 'bancolombia': valida monto + cuenta. NO valida nombre — cuando
//                    transferís a una cuenta inscrita, Bancolombia no
//                    muestra el nombre del beneficiario en el comprobante.
//   - 'otro':        Haiku extrae lo que puede, pero la decisión final
//                    SIEMPRE queda como "low confidence" para que el
//                    organizador la valide manualmente.
//
// El "method" detectado del screenshot NO se compara contra el expected
// porque las apps no muestran el nombre del banco con un standard
// (a veces dice "Bancolombia", a veces "BANCOLOMBIA S.A.", a veces
// nada — solo el logo). Confiamos en el match de monto + cuenta.
//
// La fecha del screenshot es informacional (warning si es vieja, no
// bloquea aprobación).

import Anthropic from "@anthropic-ai/sdk";

export type PayoutMethod = "nequi" | "bancolombia" | "otro";

export interface VerifyExpected {
  method: PayoutMethod;
  /** Cuenta destino esperada. Para nequi: celular. Para bancolombia:
   *  número de cuenta. Para otro: lo que el organizador haya puesto. */
  account: string;
  /** Nombre completo del beneficiario. Históricamente requerido para
   *  bancolombia, pero las cuentas inscritas en Colombia ya no lo
   *  muestran en el comprobante — por eso lo ignoramos en la decisión.
   *  Lo dejamos en el tipo para que callers viejos no rompan, pero
   *  la lógica de aprobación NO lo usa. */
  recipientName?: string;
  /** Monto exacto esperado en COP. Sin centavos. Sin tolerancia. */
  amountCOP: number;
}

export type SourceType =
  | "bank_app"
  | "wallet"
  | "notes_app"
  | "messaging"
  | "browser"
  | "edited"
  | "physical"
  | "other"
  | "unclear";

export interface VerifyResult {
  /** Decisión final: si auto-aprobar este pago o no. */
  valid: boolean;
  /** Confidence del análisis. 'low' siempre forza review manual.
   *  Para method='otro' SIEMPRE devolvemos low (admin debe verificar). */
  confidence: "high" | "low";
  /** Qué tipo de imagen Haiku identificó. Solo bank_app y wallet
   *  pueden auto-aprobar — el resto se rechaza sin importar el texto. */
  sourceType: SourceType;
  /** Texto libre que Haiku usó para clasificar la source. Útil para
   *  debugging y para mostrarle al admin por qué se aceptó/rechazó. */
  sourceEvidence: string;
  /** Lo que Haiku detectó del screenshot. */
  detectedAmount: number | null;
  detectedAccount: string | null;
  detectedMethod: string | null;
  detectedRecipientName: string | null;
  /** Número de "Comprobante No." / referencia tal cual lo leyó el
   *  modelo. Para Bancolombia es de 10 dígitos (zero-padded). Usado
   *  como señal de autenticidad en el path de aprobación por comprobante. */
  detectedReceiptNumber: string | null;
  /** true si el comprobante muestra estado exitoso/aprobado/completado.
   *  Independiente de source_type — un comprobante de Bancolombia en
   *  modo oscuro puede tener status OK aunque el modelo no lo clasifique
   *  como bank_app por falta de branding visible. */
  paymentStatusOk: boolean;
  /** Fecha detectada en ISO YYYY-MM-DD. null si no extrajo. Comparada
   *  contra hoy en zona Colombia (UTC-5). Si es older, marcamos
   *  warning pero NO bloqueamos. */
  detectedDate: string | null;
  /** Resultado por chequeo. La decisión final usa solo los relevantes
   *  al método (ej. para nequi, name=true automáticamente). */
  checks: {
    source: boolean; // true si sourceType ∈ {bank_app, wallet}
    amount: boolean;
    account: boolean;
    name: boolean;
    receipt: boolean; // true si hay comprobante de 10 dígitos (Bancolombia)
    date: "today_or_newer" | "older" | "missing";
  };
  /** Razón resumida de por qué se rechazó (si valid=false). */
  rejectionReason: string | null;
  /** Warning informativo opcional (ej. fecha vieja). No bloquea. */
  warning: string | null;
  /** Tokens consumidos para logging de costos. */
  tokensIn: number;
  tokensOut: number;
  /** Costo estimado en USD (Haiku 4.5 = $1/MTok in, $5/MTok out). */
  costUSD: number;
  /** Modelo usado — para logging en claude_api_usage. */
  model: string;
}

const VALID_SOURCES: SourceType[] = ["bank_app", "wallet"];

// Cambiado a Sonnet 4.6 después de que Haiku 4.5 aprobó múltiples
// veces un screenshot de la app de Notas con texto tipo "Pago a X".
// Haiku tiene OCR fuerte pero le falta visual discrimination para
// distinguir UI de banco vs UI de notas confiable.
//
// Sonnet 4.6 cuesta ~3x más por token pero pasa mucho mejor el test
// visual. Tradeoff aceptado por el user (presupuesto $5-10/1k):
//   Haiku 4.5:  ~$2.70 / 1000 screenshots — UNRELIABLE para fraud
//   Sonnet 4.6: ~$9.00 / 1000 screenshots — robusto contra fakes
const SONNET_MODEL = "claude-sonnet-4-6";
const PRICE_IN_PER_MTOK = 3.0;
const PRICE_OUT_PER_MTOK = 15.0;

function buildSystemPrompt(method: PayoutMethod): string {
  void method;
  // Prompt minimalista. Output muy corto = menos costo de tokens.
  // El system prompt es siempre el mismo (apto para prompt caching
  // futuro). NO pedimos explicación libre — solo los campos exactos.
  const base = `Verificador de comprobantes bancarios Colombia. Anti-fraude.

PASO 1 — Clasificar la SOURCE solo por apariencia visual (NO por texto):
  bank_app   = app bancaria real (Nequi, Bancolombia, Daviplata, BBVA, Davivienda, Banco de Bogotá, AV Villas, etc.). Branding/colores del banco + layout móvil + card de comprobante con check.
  wallet     = Movii / Tpaga / RappiPay / dale!. Mismas señales.
  notes_app  = fondo plano + tipografía del OS sin branding. Aunque diga "Pago exitoso", si no hay UI de banco → notes_app.
  messaging  = burbujas de chat (WhatsApp, iMessage, Telegram).
  browser    = barra de URL visible.
  edited     = Photoshop / mockup.
  physical   = foto de papel.
  other      = otro.
  unclear    = no puedes decidir.

Texto solo NO basta para bank_app. Si dudás → notes_app.

PASO 2 — Extraé SIEMPRE (aunque dudes del source): monto, cuenta, método, nombre, número de comprobante, fecha, y si el status es exitoso/aprobado/completado.

Output: SOLO JSON, sin markdown, sin texto antes/después. Mantené strings cortos (1 frase máx).

{
  "source_type": "bank_app|wallet|notes_app|messaging|browser|edited|physical|other|unclear",
  "source_evidence": "string corto (≤12 palabras) citando elementos visuales — ej. 'logo Bancolombia amarillo + check verde + REF: 12345'. Si no puedes citar visual concreto, NO digas bank_app.",
  "valid": boolean,
  "confidence": "high|low",
  "payment_status_ok": boolean,
  "detected_amount": number|null,
  "detected_account": string|null,
  "detected_method": string|null,
  "detected_recipient_name": string|null,
  "detected_receipt_number": string|null,
  "detected_date": "YYYY-MM-DD"|null,
  "rejection_reason": string|null
}

Reglas:
- valid=true SOLO si source_type∈{bank_app,wallet} + status exitoso + datos legibles claros.
- payment_status_ok=true si el comprobante muestra "exitoso/aprobado/completado/Transferencia exitosa", INDEPENDIENTE de source_type.
- detected_receipt_number = el "Comprobante No." / "Comprobante" / "Referencia" / "No. de aprobación" tal cual lo veas, con todos sus dígitos (incluí ceros a la izquierda). null si no hay. En Bancolombia suele ser de 10 dígitos (ej. 0000016800).
- confidence=high SOLO si tu source_evidence cita ≥2 señales visuales concretas.
- rejection_reason=null si valid=true. Si valid=false: 1 frase corta (≤12 palabras).
- OJO: la app de Bancolombia en modo oscuro tiene fondo gris/negro plano y a veces sin logo visible. Eso NO la hace notes_app — si hay "Comprobante No.", check verde y barra de navegación inferior, es bank_app.
- Sin "notes". Sin párrafos. Sin explicaciones largas.`;

  switch (method) {
    case "nequi":
      return base + `

Para esta verificación específica (método Nequi):
- valid=true requiere: monto exacto + cuenta (celular) coincidente + status exitoso.
- NO valides el nombre del beneficiario. Nequi no siempre lo muestra.`;
    case "bancolombia":
      return base + `

Para esta verificación específica (método Bancolombia):
- valid=true requiere: monto exacto + cuenta coincidente + status exitoso.
- NO valides el nombre del beneficiario. Bancolombia no lo muestra
  cuando transferís a una cuenta inscrita.
- IMPRESCINDIBLE: extraé detected_receipt_number (el "Comprobante No.",
  típicamente 10 dígitos) y detected_date. Son la evidencia clave aunque
  el branding no sea visible.`;
    case "otro":
      return base + `

Para esta verificación específica (método Otro):
- Extraé los datos lo mejor que puedas pero MARCÁ confidence="low" siempre. El organizador va a revisar manualmente.
- valid puede ser true si todo coincide claramente, pero el código va a forzar review manual igual.`;
  }
}

function normalizeDigits(s: string): string {
  return (s ?? "").replace(/\D/g, "");
}

/** Parseo robusto de la respuesta del verificador. El modelo a veces
 *  envuelve el JSON en ```json fences o agrega texto antes/después.
 *  Estrategia: (1) intento directo tras limpiar fences; (2) si falla,
 *  extraigo el primer bloque {...} balanceado. Devuelve null si nada
 *  parsea — el caller lo trata como "revisar manual". */
function parseVerifierJson<T = Record<string, unknown>>(text: string): T | null {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // fallthrough al extractor de bloque
  }

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1)) as T;
    } catch {
      return null;
    }
  }
  return null;
}

/** Hoy en zona horaria Colombia (UTC-5, sin DST) como YYYY-MM-DD. */
function todayInColombia(): string {
  const now = new Date();
  const cop = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  return cop.toISOString().slice(0, 10);
}

function checkDate(detectedISO: string | null): "today_or_newer" | "older" | "missing" {
  if (!detectedISO || !/^\d{4}-\d{2}-\d{2}$/.test(detectedISO)) return "missing";
  const today = todayInColombia();
  return detectedISO >= today ? "today_or_newer" : "older";
}

function methodLabel(m: PayoutMethod): string {
  switch (m) {
    case "nequi": return "Nequi";
    case "bancolombia": return "Bancolombia";
    case "otro": return "Otro (especificado por el organizador)";
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

  const today = todayInColombia();

  const userText = `Verificá si este screenshot muestra un pago EXITOSO de exactamente $${args.expected.amountCOP.toLocaleString("es-CO")} COP a:
  - Método: ${methodLabel(args.expected.method)}
  - Cuenta destino: ${args.expected.account}

Hoy en Colombia es ${today}. Si el screenshot dice "Hoy" o similar, esa es la fecha.`;

  const response = await client.messages.create({
    model: SONNET_MODEL,
    // 600 tokens de headroom. Bajamos a 250 una vez y un comprobante
    // real (Casvi, 2026-06-06) truncó el JSON exacto en 250 tokens →
    // JSON.parse falló → "No pudimos parsear" → pago legítimo NO marcado.
    // El JSON cabe en ~250 holgado; 600 deja margen sin costo relevante
    // (output de Sonnet a $15/MTok → ~$0.009 extra por 1000 verificaciones).
    max_tokens: 600,
    temperature: 0,
    system: buildSystemPrompt(args.expected.method),
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

  const text = response.content
    .filter((c): c is Anthropic.TextBlock => c.type === "text")
    .map((c) => c.text)
    .join("");

  let parsed: {
    source_type?: SourceType;
    source_evidence?: string;
    valid?: boolean;
    confidence?: "high" | "low";
    payment_status_ok?: boolean;
    detected_amount?: number | null;
    detected_account?: string | null;
    detected_method?: string | null;
    detected_recipient_name?: string | null;
    detected_receipt_number?: string | null;
    detected_date?: string | null;
    rejection_reason?: string | null;
  } | null = parseVerifierJson(text);

  if (!parsed) {
    return {
      valid: false,
      confidence: "low",
      sourceType: "unclear",
      sourceEvidence: "",
      detectedAmount: null,
      detectedAccount: null,
      detectedMethod: null,
      detectedRecipientName: null,
      detectedReceiptNumber: null,
      paymentStatusOk: false,
      detectedDate: null,
      checks: { source: false, amount: false, account: false, name: false, receipt: false, date: "missing" },
      rejectionReason: "No pudimos parsear la respuesta del verificador.",
      warning: null,
      tokensIn,
      tokensOut,
      costUSD,
      model: SONNET_MODEL,
    };
  }

  // Doble check determinista server-side. Defense-in-depth.
  // PRIMER GATE: source_type. Si no es app bancaria/wallet, rechazar
  // sin importar si el texto del screenshot coincide con lo esperado.
  // Esto es la defensa contra "tomé un screenshot de notas con el
  // texto correcto y lo subí".
  const sourceType: SourceType = parsed.source_type ?? "unclear";
  const sourceMatches = VALID_SOURCES.includes(sourceType);

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

  // Name check — desactivado en todos los métodos. Bancolombia no
  // muestra el nombre cuando transferís a cuenta inscrita, y Nequi
  // tampoco lo expone consistentemente. Confiamos en monto + cuenta.
  const nameMatches = true;

  const dateCheck = checkDate(parsed.detected_date ?? null);

  // Comprobante de Bancolombia: 10 dígitos zero-padded (ej. 0000016800).
  const receiptDigits = normalizeDigits(parsed.detected_receipt_number ?? "");
  const hasBancolombiaReceipt = receiptDigits.length === 10;

  // Status exitoso, independiente del source_type. Si el modelo no
  // emite el campo (back-compat), caemos a su veredicto `valid`.
  const paymentStatusOk =
    typeof parsed.payment_status_ok === "boolean"
      ? parsed.payment_status_ok
      : !!parsed.valid;

  // Decisión por método.
  //
  // PATH A — visual (todos los métodos): el modelo clasifica la imagen
  // como app bancaria/wallet con alta confianza. Defensa fuerte contra
  // "screenshot de notas con el texto correcto".
  const visualPath =
    !!parsed.valid &&
    parsed.confidence === "high" &&
    sourceMatches &&
    accountMatches &&
    amountMatches &&
    nameMatches;

  // PATH B — comprobante Bancolombia (solo método bancolombia): aprueba
  // aunque el modelo NO logre clasificar el source como bank_app (caso
  // típico: app Bancolombia en modo oscuro = fondo gris plano, el modelo
  // lo confundía con notes_app → falso negativo, David 2026-06-06).
  // La evidencia anti-fraude acá es estructural: monto exacto + cuenta
  // exacta + comprobante de 10 dígitos + fecha de HOY + status exitoso.
  // No exige branding ni que diga literalmente "Bancolombia".
  // NO aplica a Nequi (sus referencias no son comprobantes de 10 dígitos).
  const bancolombiaReceiptPath =
    args.expected.method === "bancolombia" &&
    paymentStatusOk &&
    amountMatches &&
    accountMatches &&
    hasBancolombiaReceipt &&
    dateCheck === "today_or_newer";

  let coreMatch =
    args.expected.method === "otro"
      ? false // 'otro' SIEMPRE va a review manual del organizador
      : visualPath || bancolombiaReceiptPath;

  const finalConfidence: "high" | "low" =
    args.expected.method === "otro"
      ? "low"
      : parsed.confidence === "high"
        ? "high"
        : "low";

  let rejectionReason = coreMatch ? null : (parsed.rejection_reason ?? null);
  if (!coreMatch && !rejectionReason) {
    if (args.expected.method === "otro") {
      rejectionReason = "Método 'Otro': el organizador debe revisar manualmente.";
    } else if (!amountMatches) {
      rejectionReason = `Monto detectado (${parsed.detected_amount ?? "—"}) no coincide con el esperado ($${args.expected.amountCOP}).`;
    } else if (!accountMatches) {
      rejectionReason = `Cuenta detectada (${parsed.detected_account ?? "—"}) no coincide con la esperada (${args.expected.account}).`;
    } else if (args.expected.method === "bancolombia" && !paymentStatusOk) {
      rejectionReason = "El comprobante no muestra un pago exitoso/aprobado.";
    } else if (args.expected.method === "bancolombia" && !hasBancolombiaReceipt) {
      rejectionReason =
        "No detectamos el número de comprobante de Bancolombia (10 dígitos). Subí el comprobante completo.";
    } else if (args.expected.method === "bancolombia" && dateCheck !== "today_or_newer") {
      rejectionReason =
        dateCheck === "older"
          ? "El comprobante no es de hoy. Subí el comprobante del pago de hoy."
          : "No detectamos la fecha del comprobante. Subí el comprobante completo.";
    } else if (!sourceMatches) {
      rejectionReason = `La imagen no parece ser de una app bancaria. Detectamos: ${sourceType.replace("_", " ")}.`;
    } else if (parsed.confidence === "low") {
      rejectionReason = "El verificador no pudo leer el screenshot con confianza alta.";
    }
  }

  // Si todo matchea pero la fecha es vieja, exponemos un warning
  // informativo (no bloquea la aprobación).
  let warning: string | null = null;
  if (coreMatch && dateCheck === "older") {
    warning = `Fecha del screenshot (${parsed.detected_date}) anterior a hoy (${todayInColombia()}). Posible reuso.`;
  } else if (coreMatch && dateCheck === "missing") {
    warning = "Fecha no detectada en el screenshot.";
  }

  return {
    valid: coreMatch,
    confidence: finalConfidence,
    sourceType,
    sourceEvidence: parsed.source_evidence ?? "",
    detectedAmount: typeof parsed.detected_amount === "number" ? parsed.detected_amount : null,
    detectedAccount: parsed.detected_account ?? null,
    detectedMethod: parsed.detected_method ?? null,
    detectedRecipientName: parsed.detected_recipient_name ?? null,
    detectedReceiptNumber: parsed.detected_receipt_number ?? null,
    paymentStatusOk,
    detectedDate:
      parsed.detected_date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.detected_date)
        ? parsed.detected_date
        : null,
    checks: {
      source: sourceMatches,
      amount: amountMatches,
      account: accountMatches,
      name: nameMatches,
      receipt: hasBancolombiaReceipt,
      date: dateCheck,
    },
    rejectionReason,
    warning,
    tokensIn,
    tokensOut,
    costUSD,
    model: SONNET_MODEL,
  };
}

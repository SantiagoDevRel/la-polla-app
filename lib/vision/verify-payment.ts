// lib/vision/verify-payment.ts
//
// Server-side wrapper para verificar un screenshot de pago contra una
// expectativa estructurada. Usa Claude Haiku 4.5 con temperature=0
// para que el output sea determinista — la misma imagen + mismo
// expected da el mismo veredicto siempre.
//
// Métodos soportados (intencionalmente reducidos):
//   - 'nequi':       valida monto + cuenta (celular). NO valida nombre.
//   - 'bancolombia': valida monto + cuenta + nombre del beneficiario.
//   - 'otro':        Haiku extrae lo que puede, pero la decisión final
//                    SIEMPRE queda como "low confidence" para que el
//                    organizador la valide manualmente.
//
// El "method" detectado del screenshot NO se compara contra el expected
// porque las apps no muestran el nombre del banco con un standard
// (a veces dice "Bancolombia", a veces "BANCOLOMBIA S.A.", a veces
// nada — solo el logo). Confiamos en el match de monto + cuenta + nombre.
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
  /** Nombre completo del beneficiario, como aparece en la cuenta.
   *  REQUERIDO para bancolombia + otro. IGNORADO para nequi.
   *  Match tolerante a abreviaturas: "Juan Pablo Pérez" matchea con
   *  "JUAN P PEREZ". Tildes y Ñ se normalizan. */
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
  unclear    = no podés decidir.

Texto solo NO basta para bank_app. Si dudás → notes_app.

PASO 2 — Si bank_app/wallet, extraer monto/cuenta/método/nombre/fecha. Status debe ser exitoso/aprobado/completado.

Output: SOLO JSON, sin markdown, sin texto antes/después. Mantené strings cortos (1 frase máx).

{
  "source_type": "bank_app|wallet|notes_app|messaging|browser|edited|physical|other|unclear",
  "source_evidence": "string corto (≤12 palabras) citando elementos visuales — ej. 'logo Bancolombia amarillo + check verde + REF: 12345'. Si no podés citar visual concreto, NO digas bank_app.",
  "valid": boolean,
  "confidence": "high|low",
  "detected_amount": number|null,
  "detected_account": string|null,
  "detected_method": string|null,
  "detected_recipient_name": string|null,
  "detected_date": "YYYY-MM-DD"|null,
  "rejection_reason": string|null
}

Reglas:
- valid=true SOLO si source_type∈{bank_app,wallet} + status exitoso + datos legibles claros.
- confidence=high SOLO si tu source_evidence cita ≥2 señales visuales concretas.
- rejection_reason=null si valid=true. Si valid=false: 1 frase corta (≤12 palabras).
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
- valid=true requiere: monto exacto + cuenta coincidente + nombre del beneficiario que claramente coincida (tolerante a abreviaturas) + status exitoso.`;
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

/** Normaliza un nombre: lowercase + sin tildes + sin Ñ → N + sin
 *  puntos + un solo espacio entre tokens. "Juan P. Núñez" →
 *  "juan p nunez". */
function normalizeName(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ñ/g, "n")
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Match de nombre tolerante a abreviaturas. */
function namesMatch(expected: string, detected: string): boolean {
  const ex = normalizeName(expected).split(" ").filter((t) => t.length >= 3);
  const de = normalizeName(detected).split(" ").filter((t) => t.length >= 1);
  if (ex.length === 0 || de.length === 0) return false;
  let matched = 0;
  for (const tok of ex) {
    const found = de.some((d) => d === tok || d.startsWith(tok) || tok.startsWith(d));
    if (found) matched++;
  }
  const required = Math.min(2, ex.length);
  return matched >= required;
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
  const expectedNameLine =
    args.expected.method !== "nequi" && args.expected.recipientName
      ? `\n  - Beneficiario: ${args.expected.recipientName}`
      : "";

  const userText = `Verificá si este screenshot muestra un pago EXITOSO de exactamente $${args.expected.amountCOP.toLocaleString("es-CO")} COP a:
  - Método: ${methodLabel(args.expected.method)}
  - Cuenta destino: ${args.expected.account}${expectedNameLine}

Hoy en Colombia es ${today}. Si el screenshot dice "Hoy" o similar, esa es la fecha.`;

  const response = await client.messages.create({
    model: SONNET_MODEL,
    // Output reducido: el JSON cabe en ~200 tokens con strings cortos.
    // Antes 500. Ahorra ~50% del costo de output.
    max_tokens: 250,
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
    detected_amount?: number | null;
    detected_account?: string | null;
    detected_method?: string | null;
    detected_recipient_name?: string | null;
    detected_date?: string | null;
    rejection_reason?: string | null;
  } = {};
  try {
    const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned);
  } catch {
    return {
      valid: false,
      confidence: "low",
      sourceType: "unclear",
      sourceEvidence: "",
      detectedAmount: null,
      detectedAccount: null,
      detectedMethod: null,
      detectedRecipientName: null,
      detectedDate: null,
      checks: { source: false, amount: false, account: false, name: false, date: "missing" },
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

  // Name check — depende del método.
  let nameMatches: boolean;
  if (args.expected.method === "nequi") {
    // Nequi no siempre muestra el nombre. No bloqueamos por esto.
    nameMatches = true;
  } else if (args.expected.recipientName) {
    nameMatches = namesMatch(
      args.expected.recipientName,
      parsed.detected_recipient_name ?? "",
    );
  } else {
    // Bancolombia / Otro sin recipientName declarado: asumimos pass
    // (el caller no lo proveyó).
    nameMatches = true;
  }

  const dateCheck = checkDate(parsed.detected_date ?? null);

  // Decisión por método:
  //   - bank_app/wallet REQUERIDO siempre.
  //   - nequi: source + amount + account + status
  //   - bancolombia: source + amount + account + name + status
  //   - otro: SIEMPRE confidence:low → admin review manual
  let coreMatch =
    !!parsed.valid &&
    parsed.confidence === "high" &&
    sourceMatches &&
    accountMatches &&
    amountMatches &&
    nameMatches;

  if (args.expected.method === "otro") {
    // Forzamos low confidence aunque el modelo diga high — el organizador
    // siempre debe ver y aprobar manualmente.
    coreMatch = false;
  }

  const finalConfidence: "high" | "low" =
    args.expected.method === "otro"
      ? "low"
      : parsed.confidence === "high"
        ? "high"
        : "low";

  let rejectionReason = parsed.rejection_reason ?? null;
  if (!coreMatch && !rejectionReason) {
    if (!sourceMatches) {
      rejectionReason = `La imagen no parece ser de una app bancaria. Detectamos: ${sourceType.replace("_", " ")}.`;
    } else if (args.expected.method === "otro") {
      rejectionReason = "Método 'Otro': el organizador debe revisar manualmente.";
    } else if (!amountMatches) {
      rejectionReason = `Monto detectado (${parsed.detected_amount ?? "—"}) no coincide con el esperado ($${args.expected.amountCOP}).`;
    } else if (!accountMatches) {
      rejectionReason = `Cuenta detectada (${parsed.detected_account ?? "—"}) no coincide con la esperada (${args.expected.account}).`;
    } else if (!nameMatches) {
      rejectionReason = `Nombre detectado ("${parsed.detected_recipient_name ?? "—"}") no coincide con el esperado ("${args.expected.recipientName ?? "—"}").`;
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
    detectedDate:
      parsed.detected_date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.detected_date)
        ? parsed.detected_date
        : null,
    checks: {
      source: sourceMatches,
      amount: amountMatches,
      account: accountMatches,
      name: nameMatches,
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

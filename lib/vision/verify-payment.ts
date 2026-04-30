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
  /** Texto libre con notas — útil para debugging y para mostrar al admin. */
  notes: string;
  /** Razón resumida de por qué se rechazó (si valid=false). */
  rejectionReason: string | null;
  /** Tokens consumidos para logging de costos. */
  tokensIn: number;
  tokensOut: number;
  /** Costo estimado en USD (Haiku 4.5 = $1/MTok in, $5/MTok out). */
  costUSD: number;
  /** Modelo usado — para logging en claude_api_usage. */
  model: string;
}

const VALID_SOURCES: SourceType[] = ["bank_app", "wallet"];

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const PRICE_IN_PER_MTOK = 1.0;
const PRICE_OUT_PER_MTOK = 5.0;

function buildSystemPrompt(method: PayoutMethod): string {
  const base = `Sos un verificador de comprobantes de pago bancario en Colombia. Recibís una imagen y un objeto con la transferencia esperada.

PASO 1 — IDENTIFICAR LA SOURCE.
Antes de extraer datos, decidí qué tipo de imagen es. Solo apps bancarias / wallets de pago Colombianas son aceptables. CUALQUIER otra cosa = rechazo automático.

Categorías para source_type:
- "bank_app"      → app bancaria legítima: Nequi (rosa, logo Nequi), Bancolombia (amarillo, logo Bancolombia), Daviplata (rojo, logo DaviPlata), BBVA, Banco de Bogotá, Davivienda, Scotiabank Colpatria, Banco Popular, AV Villas, Itaú, Banco Caja Social, etc. Tienen logo del banco visible, header tipo "Comprobante", "Pago exitoso", "Transferencia exitosa", icono de check, número de comprobante, layout tipo app móvil.
- "wallet"        → wallet de pago Colombiano: Movii, Tpaga, RappiPay, dale!. Mismas señales que bank_app pero del wallet.
- "notes_app"     → captura de Notas / Notes / Apple Notes / Google Keep / Samsung Notes. Texto plano sin chrome de banco. Sin logo. Suele tener fondo blanco / amarillo claro y tipografía system del OS.
- "messaging"     → WhatsApp, Telegram, Messenger, iMessage. Mensajes de chat con burbujas.
- "browser"       → captura de página web (Chrome / Safari address bar visible). Aunque sea una página de banco web, no un comprobante.
- "edited"        → imagen claramente editada / Photoshop / mock. Layout inconsistente, fuentes mezcladas, alineación rara.
- "physical"      → foto de un papel / impresión.
- "other"         → cualquier otra cosa (calculadora, calendario, screenshot de código, meme, screenshot vacío, etc.).
- "unclear"       → no se puede determinar.

REGLA DE ORO: si source_type NO es "bank_app" ni "wallet" → valid=false sin importar qué texto contenga. Es muy fácil escribir "Pago a Santiago $20.000" en una nota; el comprobante REAL tiene logo del banco y branding.

Señales típicas de fraude (forzar source_type apropiado):
- Texto "Pago exitoso" pero sin logo del banco visible → NO es bank_app.
- Layout sin status bar de celular (hora/batería arriba) ni header de app → suele ser nota.
- Texto en una sola fuente del OS (San Francisco / Roboto) sin tipografía de marca → suele ser nota o WhatsApp.
- Muy pocas líneas, sin número de referencia, sin fecha-hora completa → sospechoso.

PASO 2 — SI ES bank_app O wallet, extraer:
1. monto en COP (number, sin centavos, sin separadores)
2. cuenta destino (string — celular para Nequi, número de cuenta para Bancolombia, etc. Si está enmascarada "****1234", devolvé los últimos dígitos visibles).
3. método visible (string — Nequi, Bancolombia, etc. null si no aparece claramente).
4. nombre del beneficiario tal cual aparece (string). null si no se ve.
5. fecha en ISO YYYY-MM-DD. Si dice "Hoy" usás la fecha que te pasan en el contexto. Si solo hora sin fecha, null.

Reglas de status:
- La transferencia debe figurar como EXITOSA / completada / aprobada (no pendiente, no rechazada). Si está en otro estado, valid=false.
- Confidence "high" SOLO si: source_type es bank_app/wallet con logo visible Y pudiste leer claramente monto + cuenta + status exitoso. Cualquier duda → confidence "low".

Devolvé SIEMPRE un objeto JSON válido con esta forma exacta, sin markdown:

{
  "source_type": "bank_app" | "wallet" | "notes_app" | "messaging" | "browser" | "edited" | "physical" | "other" | "unclear",
  "source_evidence": "string — qué señales viste para clasificar (ej. 'Logo Bancolombia visible en el header, icono de check verde, número de comprobante')",
  "valid": boolean,
  "confidence": "high" | "low",
  "detected_amount": number | null,
  "detected_account": string | null,
  "detected_method": string | null,
  "detected_recipient_name": string | null,
  "detected_date": "YYYY-MM-DD" | null,
  "notes": string,
  "rejection_reason": string | null
}

Si source_type NO es bank_app ni wallet:
- valid: false
- confidence: "high" (estás SEGURO de que NO es comprobante bancario)
- rejection_reason: "El comprobante no parece de una app bancaria. Detectamos: [tipo]."
- detected_* puede ser null o lo que veas.

Si valid=true, rejection_reason es null.
Si valid=false por otra razón (monto / cuenta / nombre no coinciden), rejection_reason explica brevemente.`;

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
    model: HAIKU_MODEL,
    max_tokens: 500,
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
    notes?: string;
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
      notes: `Respuesta no-JSON: ${text.slice(0, 200)}`,
      rejectionReason: "No pudimos parsear la respuesta del verificador.",
      tokensIn,
      tokensOut,
      costUSD,
      model: HAIKU_MODEL,
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

  // Si todo matchea pero la fecha es vieja, agregamos warning a notes.
  let notes = parsed.notes ?? "";
  if (coreMatch && dateCheck === "older") {
    const dateNote = `Fecha detectada (${parsed.detected_date}) es anterior a hoy en Colombia (${todayInColombia()}). Posible screenshot reusado — revisá manualmente.`;
    notes = notes ? `${notes} · ${dateNote}` : dateNote;
  } else if (coreMatch && dateCheck === "missing") {
    const dateNote = `No se pudo extraer la fecha del screenshot.`;
    notes = notes ? `${notes} · ${dateNote}` : dateNote;
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
    notes,
    rejectionReason,
    tokensIn,
    tokensOut,
    costUSD,
    model: HAIKU_MODEL,
  };
}

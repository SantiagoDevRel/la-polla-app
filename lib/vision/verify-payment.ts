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
  const base = `Sos un verificador de comprobantes de pago bancario en Colombia. Tu prioridad #1 es detectar FRAUDE. Adversarios van a intentar pasar imágenes que TIENEN el texto correcto pero NO son screenshots de bancos reales — vas a rechazarlas.

⚠️ PRIORIDAD ABSOLUTA — ANTI-FRAUDE.

Antes de mirar lo que dice el texto, mirá QUÉ ES la imagen visualmente. El texto NO importa para clasificar la source — solo la apariencia visual.

Categorías para source_type:

"bank_app" — necesita AL MENOS 2 de estas señales visuales (no de texto):
  • Branding visual de un banco colombiano. Puede ser logo explícito (Bancolombia amarillo, Nequi rosa, Daviplata rojo, BBVA azul, Davivienda rojo, Banco de Bogotá rojo, AV Villas, Scotiabank Colpatria, Itaú, Caja Social) O paleta de colores característica del banco que cubre la imagen entera.
  • Layout de app móvil: status bar del OS arriba con hora/batería/señal, esquinas redondeadas, padding consistente con UI Kit móvil (Material Design o Human Interface).
  • Card de comprobante/recibo con FORMATO de banco: icono grande de check (verde, gris o circular), texto tipo "Listo", "Pago exitoso", "Transferencia exitosa", "Tu transferencia fue exitosa", "Comprobante", "Detalle".
  • Número de referencia/aprobación alfanumérico (>= 6 chars, formato bank-like — ej. "REF: 12345678", "Aprobación: 987654321", "Comprobante #12345").
  • Botones característicos de bank app: "Compartir", "Descargar", "Volver a inicio", "Otra transferencia".
  • Estructura visual de bank app: header colorido con título, separadores, tipografía limpia, datos en formato key-value (Origen / Destino / Valor / Fecha).

"wallet" — Movii, Tpaga, RappiPay, dale!. Mismas señales que bank_app pero del wallet.

"notes_app" — fondo plano blanco/amarillo-claro/gris uniforme. Texto en una sola tipografía del SISTEMA (San Francisco / Roboto / Helvetica). SIN colores de marca. SIN header de app. SIN icono de check. SIN número de referencia formateado. Aunque el TEXTO diga "Pago exitoso a Santiago $20.000", si la imagen es solo texto sobre fondo plano sin estructura de UI bancaria, ES notes_app — el TEXTO no convierte una nota en banco.

"messaging" — burbujas de chat con fondo característico (WhatsApp verde+gris, iMessage azul, Telegram celeste).

"browser" — barra de URL visible (Chrome / Safari / Firefox address bar).

"edited" — fuentes mezcladas, alineación rara, recortes visibles, parche tipo Photoshop.

"physical" — foto de papel impreso, sombras, ángulos no perpendiculares.

"other" — calculadora, calendario, código, meme, etc.

"unclear" — no podés decidir con seguridad.

REGLAS DURAS ANTI-FRAUDE:

1. **Texto solo NO ES suficiente para bank_app.** "Pago exitoso $20000 a Santiago cuenta 123" se puede tipear en cualquier nota. Para clasificar como bank_app necesitás señales VISUALES (color, layout, branding, structure) además del texto.

2. **Si la imagen es texto sobre fondo plano sin chrome de app móvil → notes_app**, sin importar qué diga el texto.

3. **En source_evidence, citá señales VISUALES concretas, no texto.** Bueno: "Layout con header amarillo característico de Bancolombia, icono de check verde grande, formato de comprobante con campos Origen/Destino/Valor en columna". Malo: "Dice pago exitoso a Santiago".

4. Si dudás entre bank_app y notes_app, elegí notes_app — falso negativo es OK (admin revisa manual), falso positivo es fraude.

5. confidence "high" SOLO si source_type=bank_app/wallet con MÚLTIPLES señales visuales claras. Si solo viste 1 señal débil, confidence="low".

PASO 2 — SI ES bank_app O wallet, extraer:
1. monto en COP (number, sin centavos, sin separadores)
2. cuenta destino (string — celular para Nequi, número de cuenta para Bancolombia. Si enmascarada "****1234", devolvé los últimos dígitos).
3. método visible (string — Nequi, Bancolombia, etc. null si no aparece claramente).
4. nombre del beneficiario tal cual aparece (string). null si no se ve.
5. fecha en ISO YYYY-MM-DD. Si dice "Hoy" usás la fecha del contexto. Si solo hora sin fecha, null.

Reglas adicionales:
- Status debe figurar como EXITOSA / completada / aprobada. Otro estado → valid=false.

Devolvé SIEMPRE un objeto JSON válido con esta forma exacta, sin markdown:

{
  "source_type": "bank_app" | "wallet" | "notes_app" | "messaging" | "browser" | "edited" | "physical" | "other" | "unclear",
  "source_evidence": "string — DEBE citar elementos visuales específicos. Ej válidos: 'Logo amarillo Bancolombia en header, icono check verde, número de comprobante REF: 1234567'. Ej INVÁLIDOS: 'Se ve un texto de pago' / 'Parece un comprobante' / 'Hay información de transferencia'. Si no podés citar branding/logo nombrado, NO digas bank_app.",
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
    model: SONNET_MODEL,
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
    model: SONNET_MODEL,
  };
}

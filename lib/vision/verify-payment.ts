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
  /** Nombre completo como aparece en la cuenta destino. Ej: "Juan
   *  Pablo Pérez Gómez". Se compara con detectedRecipientName por
   *  token-overlap (aceptamos abreviaturas tipo "JUAN P. PEREZ"). */
  recipientName: string;
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
  /** Fecha detectada del screenshot en ISO (YYYY-MM-DD). null si no
   *  pudo extraerla. Se valida contra "hoy o más reciente" en hora
   *  Colombia (UTC-5). Si es más vieja, marcamos un warning pero NO
   *  bloqueamos la aprobación si los otros 3 datos matchean. */
  detectedDate: string | null;
  /** Resultado de cada chequeo individual — útil para que el admin
   *  vea qué pasó cuando hay rechazo o duda. */
  checks: {
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
}

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const PRICE_IN_PER_MTOK = 1.0;
const PRICE_OUT_PER_MTOK = 5.0;

const SYSTEM_PROMPT = `Sos un verificador de comprobantes de pago bancario en Colombia. Recibís una imagen de un screenshot y un objeto con la transferencia esperada (método, cuenta destino, nombre del beneficiario y monto exacto en pesos colombianos).

Tu trabajo es EXTRAER 5 cosas del screenshot y devolverlas. Quien decide si auto-aprobar es el código que corre después; vos extrae y reporta con honestidad.

Cosas a extraer:
1. monto en COP (number, sin centavos, sin separadores)
2. cuenta destino (string, exacto como aparece — masked OK, ej. "****1234")
3. método de transferencia (string: Nequi, Daviplata, Bancolombia, Transfiya, u otro nombre del banco)
4. nombre del beneficiario (string, exacto como aparece — abreviado o no)
5. fecha de la transacción en ISO YYYY-MM-DD. Si dice "Hoy" infieres la fecha de la zona horaria Colombia (UTC-5) que te indica el contexto. Si solo dice hora sin fecha y nada más, devolvé null.

Reglas:
- La transferencia debe figurar como EXITOSA / completada (no pendiente, no rechazada). Si está en otro estado, valid=false.
- Si la imagen no es claramente un screenshot bancario, no podés leer los datos, o el status es ambiguo: confidence="low", valid=false.
- Confidence "high" SOLO si pudiste leer claramente: monto, cuenta destino, nombre, status, y al menos parcialmente la fecha.
- En "valid" sé estricto: solo devolvé true si TODOS los 4 datos esperados (monto, cuenta, nombre, método) coinciden. Si el monto difiere por 500 pesos (ej. comisión), valid=false.

Devolvé SIEMPRE un objeto JSON válido con esta forma exacta, sin markdown, sin texto antes o después:

{
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

/** Normaliza un nombre: lowercase + sin tildes + sin puntos +
 *  trim + un solo espacio entre tokens. "Juan P. Pérez" → "juan p perez". */
function normalizeName(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Match de nombre tolerante a abreviaturas. La cuenta de un banco
 *  puede mostrar "JUAN P PEREZ G" cuando el user declara "Juan Pablo
 *  Pérez Gómez". Estrategia:
 *   - Tokenizamos ambos.
 *   - Para cada token full del expected (longitud >= 3), buscamos
 *     un token en detected que matchee como prefijo o iguales.
 *   - Si al menos 2 tokens >= 3 chars matchean (o todos los tokens
 *     >= 3 chars del expected si hay menos de 2), considerar match.
 *   - Iniciales sueltas (1 char + punto) no cuentan como match
 *     positivo pero tampoco como negativo. */
function namesMatch(expected: string, detected: string): boolean {
  const ex = normalizeName(expected).split(" ").filter((t) => t.length >= 3);
  const de = normalizeName(detected).split(" ").filter((t) => t.length >= 1);
  if (ex.length === 0 || de.length === 0) return false;
  let matched = 0;
  for (const tok of ex) {
    const found = de.some((d) => d === tok || d.startsWith(tok) || tok.startsWith(d));
    if (found) matched++;
  }
  // Requerimos al menos 2 matches (o todos si el expected tiene < 2).
  const required = Math.min(2, ex.length);
  return matched >= required;
}

/** Hoy en zona horaria Colombia (UTC-5, sin DST) como YYYY-MM-DD. */
function todayInColombia(): string {
  const now = new Date();
  // Sumamos -5h (Colombia es UTC-5) y devolvemos la fecha local.
  const cop = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  return cop.toISOString().slice(0, 10);
}

/** Compara dos fechas YYYY-MM-DD. Devuelve "today_or_newer" si la
 *  detected es >= hoy_COP; "older" si es estrictamente anterior;
 *  "missing" si no se pudo extraer. */
function checkDate(detectedISO: string | null): "today_or_newer" | "older" | "missing" {
  if (!detectedISO || !/^\d{4}-\d{2}-\d{2}$/.test(detectedISO)) return "missing";
  const today = todayInColombia();
  return detectedISO >= today ? "today_or_newer" : "older";
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
  - Beneficiario: ${args.expected.recipientName}

Hoy en Colombia es ${today}. Si el screenshot dice "Hoy" o similar, esa es la fecha.

valid debe ser true SOLO si los 4 datos (monto, cuenta, método, beneficiario) coinciden con lo esperado y la transacción figura como exitosa. Cualquier discrepancia → valid: false con rejection_reason específica.`;

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
    detected_date?: string | null;
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
      detectedDate: null,
      checks: { amount: false, account: false, name: false, date: "missing" },
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
  const nameMatches = namesMatch(
    args.expected.recipientName,
    parsed.detected_recipient_name ?? "",
  );
  const dateCheck = checkDate(parsed.detected_date ?? null);

  // Decisión final:
  //   - valid:true requiere amount, account, name, confidence high.
  //   - date "older" o "missing" NO bloquea — solo agrega un warning.
  const coreMatch =
    !!parsed.valid &&
    parsed.confidence === "high" &&
    accountMatches &&
    amountMatches &&
    nameMatches;
  const finallyValid = coreMatch;

  let rejectionReason = parsed.rejection_reason ?? null;
  if (!finallyValid && !rejectionReason) {
    if (!amountMatches) {
      rejectionReason = `Monto detectado (${parsed.detected_amount ?? "—"}) no coincide con el esperado ($${args.expected.amountCOP}).`;
    } else if (!accountMatches) {
      rejectionReason = `Cuenta detectada (${parsed.detected_account ?? "—"}) no coincide con la esperada (${args.expected.account}).`;
    } else if (!nameMatches) {
      rejectionReason = `Nombre detectado ("${parsed.detected_recipient_name ?? "—"}") no coincide con el esperado ("${args.expected.recipientName}").`;
    } else if (parsed.confidence === "low") {
      rejectionReason = "El verificador no pudo leer el screenshot con confianza alta.";
    }
  }

  // Si todo matchea pero la fecha es vieja, agregamos warning a notes.
  let notes = parsed.notes ?? "";
  if (finallyValid && dateCheck === "older") {
    const dateNote = `Fecha detectada (${parsed.detected_date}) es anterior a hoy en Colombia (${todayInColombia()}). Posible screenshot reusado — revisá manualmente.`;
    notes = notes ? `${notes} · ${dateNote}` : dateNote;
  } else if (finallyValid && dateCheck === "missing") {
    const dateNote = `No se pudo extraer la fecha del screenshot.`;
    notes = notes ? `${notes} · ${dateNote}` : dateNote;
  }

  return {
    valid: finallyValid,
    confidence: parsed.confidence === "high" ? "high" : "low",
    detectedAmount: typeof parsed.detected_amount === "number" ? parsed.detected_amount : null,
    detectedAccount: parsed.detected_account ?? null,
    detectedMethod: parsed.detected_method ?? null,
    detectedRecipientName: parsed.detected_recipient_name ?? null,
    detectedDate: parsed.detected_date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.detected_date) ? parsed.detected_date : null,
    checks: {
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
  };
}

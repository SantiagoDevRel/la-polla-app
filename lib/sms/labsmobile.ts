// lib/sms/labsmobile.ts
// Cliente mínimo de LabsMobile (proveedor de SMS, Barcelona) para el login por
// celular. Se eligió en los-del-sur-app tras medir precios reales el 2026-08-09
// y se porta acá porque Twilio Verify, el proveedor actual de Phone Auth, sale
// ~20x más caro:
//
//   LabsMobile  COP  8,28 / SMS   ← este
//   Onurix      COP 13,10 - 19,00 / SMS (y exige RUT + cédula + contrato firmado)
//   Twilio      COP   167 / SMS   (~20x)
//
// Colombia es de los mercados de SMS más baratos del mundo; Twilio cobra el
// precio "internacional". Entrega verificada a un Claro real el 2026-08-09
// (en la otra app del mismo dueño).
//
// Por qué LabsMobile y no Onurix, más allá del precio: Onurix filtra por IP y
// Vercel no da IP de salida fija, así que había que abrirle el API a TODO
// internet (su "modo inseguro" 000.000.000.000). LabsMobile deja el filtro de
// IP vacío por defecto → no hace falta el hack.
//
// ⛔ Siempre https://api.labsmobile.com/json/send (texto plano). JAMÁS el
// endpoint "2FA"/"OTP" del proveedor: ese genera su PROPIO código, al usuario
// le llega un número distinto al que Supabase espera, y verifyOtp muere con
// "Código inválido o vencido".
//
// Docs: https://www.labsmobile.com/es/api-sms/versiones-api/http-rest-post-json

const API_URL = "https://api.labsmobile.com/json/send";
const BALANCE_URL = "https://api.labsmobile.com/json/balance";

export interface SmsResult {
  ok: boolean;
  /** id del envío en LabsMobile, útil para cruzar con su histórico */
  subid?: string;
  /** code "0" es éxito; cualquier otro es error (35 = sin saldo) */
  code?: string;
  error?: string;
}

function creds(): { user: string; token: string } | null {
  const user = process.env.LABSMOBILE_USERNAME;
  const token = process.env.LABSMOBILE_TOKEN;
  if (!user || !token) return null;
  return { user, token };
}

/**
 * Manda un SMS de texto plano.
 *
 * OJO con el largo: LabsMobile cobra por SEGMENTO, y un segmento es 160
 * caracteres SOLO si el texto entra en el alfabeto GSM-7. Un acento o un emoji
 * fuerza codificación Unicode y el segmento baja a 70 caracteres → el mismo
 * mensaje pasa a costar el doble. Por eso el texto del OTP va sin tildes,
 * sin ñ y sin emoji.
 *
 * @param phone  en E.164 sin "+" (ej. "573001234567")
 */
export async function sendSms(
  phone: string,
  message: string,
  options: { subid?: string } = {},
): Promise<SmsResult> {
  const c = creds();
  if (!c) return { ok: false, error: "labsmobile_no_configurado" };

  // Igual que un dry-run de WhatsApp: permite probar la cadena completa
  // (Supabase → hook → proveedor) sin gastar créditos ni molestar a nadie.
  // LabsMobile valida y responde code 0, pero no entrega nada.
  const dryRun = process.env.LABSMOBILE_DRY_RUN === "1";

  const body: Record<string, unknown> = {
    message,
    recipient: [{ msisdn: phone }],
  };
  // Cuando lo generamos nosotros podemos registrar la fila ANTES del fetch y
  // cerrar la carrera con un DLR ultrarrápido. LabsMobile admite máximo 20.
  if (options.subid) {
    if (!/^[A-Za-z0-9_-]{1,20}$/.test(options.subid)) {
      return { ok: false, error: "subid_invalido" };
    }
    body.subid = options.subid;
  }
  // tpoa = remitente. Colombia NO admite remitente alfanumérico: los operadores
  // lo reemplazan por un código corto compartido. Se deja configurable por si
  // algún día se contrata un remitente propio, pero no se manda por defecto
  // para no depender de un comportamiento que el operador va a pisar igual.
  const tpoa = process.env.LABSMOBILE_TPOA;
  if (tpoa) body.tpoa = tpoa;
  if (dryRun) body.test = 1;

  // ackurl = adónde LabsMobile nos avisa QUÉ PASÓ con el mensaje después de
  // aceptarlo. Sin esto, `code 0` era todo lo que sabíamos: el 2026-08-10 dos
  // códigos se entregaron 2h35m tarde y nos enteramos porque el destinatario
  // lo contó (ver supabase/migrations/088). Nos pega un GET a /api/sms/ack
  // con el subid.
  //
  // Se arma acá y no se guarda entera en una env para tener UN solo secreto que
  // rotar. Si falta SMS_ACK_SECRET no se manda el parámetro: el SMS sale igual
  // y solo perdemos la telemetría — jamás al revés.
  const ackSecret = process.env.SMS_ACK_SECRET;
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  if (ackSecret && base) {
    body.ackurl = `${base}/api/sms/ack?k=${encodeURIComponent(ackSecret)}`;
  }

  const auth = Buffer.from(`${c.user}:${c.token}`).toString("base64");

  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      },
      body: JSON.stringify(body),
      // El hook de Supabase corre dentro del request de login del usuario:
      // si LabsMobile se cuelga, preferimos fallar rápido a dejar la pantalla
      // congelada. Supabase reintenta/reporta el error igual.
      //
      // ⚠️ 4,5s, no 10s, y el número NO es arbitrario: Supabase le da a un HTTP
      // Auth Hook un presupuesto de CINCO segundos. Con 10s el hook seguía
      // esperando después de que Supabase ya lo había abandonado — y el SMS
      // salía igual. Resultado para el usuario: "no pudimos mandarte el SMS",
      // pide otro, y quema un segundo mensaje pago mientras Supabase invalida
      // el código del primero. Fallar DENTRO del presupuesto deja los dos lados
      // contando la misma historia.
      //
      // Por qué 4,5 y no 4: bajar de más ABRE una banda nueva de fallo. Un envío
      // que tarda 4,2s antes entraba cómodo en los 5s y llegaba; con el corte en
      // 4s pasaba a abortarse, o sea el "arreglo" habría bajado la tasa de
      // entrega. 4,5s deja ~0,5s para el overhead del handler y solo mata lo que
      // de todas formas iba a llegar tarde.
      signal: AbortSignal.timeout(4_500),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch_fallo" };
  }

  let json: { code?: string | number; message?: string; subid?: string };
  try {
    json = await res.json();
  } catch {
    return { ok: false, error: `respuesta_no_json_${res.status}` };
  }

  // La API devuelve code "0" (string) en éxito. Se compara como string porque
  // /json/balance devuelve 0 numérico y /json/send lo devuelve como texto.
  const code = String(json.code ?? "");
  if (code !== "0") {
    return { ok: false, code, error: json.message || `code_${code}` };
  }
  return { ok: true, code, subid: json.subid ?? options.subid };
}

/**
 * Créditos disponibles. 1 SMS a Colombia = ~0,043 créditos (medido).
 * Útil para un panel de admin que avise antes de quedarse sin saldo: si los
 * créditos se agotan el login por celular muere en silencio.
 *
 * ⚠️ El precio por SMS NO es uniforme: La Polla acepta cualquier país.
 * `smsColombia` es una estimación SOLO para destino 57.
 */
export async function getBalance(): Promise<{
  ok: boolean;
  credits?: number;
  smsColombia?: number;
  error?: string;
}> {
  const c = creds();
  if (!c) return { ok: false, error: "labsmobile_no_configurado" };

  const auth = Buffer.from(`${c.user}:${c.token}`).toString("base64");
  try {
    const res = await fetch(BALANCE_URL, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    const json: { code?: number; credits?: string } = await res.json();
    const credits = Number(json.credits);
    if (!Number.isFinite(credits)) return { ok: false, error: "balance_ilegible" };
    // 0,043046 créditos por SMS estándar a Colombia (medido el 2026-08-09
    // restando el saldo antes/después de un envío real).
    return { ok: true, credits, smsColombia: Math.floor(credits / 0.043046) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch_fallo" };
  }
}

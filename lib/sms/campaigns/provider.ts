import { smsSize } from "./shared";

function headers() {
  const { LABSMOBILE_USERNAME: user, LABSMOBILE_TOKEN: token } = process.env;
  if (!user || !token) throw new Error("El proveedor SMS no está configurado.");
  return { Authorization: `Basic ${Buffer.from(`${user}:${token}`).toString("base64")}`, "Content-Type": "application/json" };
}

export async function quoteCampaign(countries: string[]) {
  const auth = headers();
  const [balanceResponse, priceResponse] = await Promise.all([
    fetch("https://api.labsmobile.com/json/balance", { headers: auth, cache: "no-store", signal: AbortSignal.timeout(8000) }),
    fetch("https://api.labsmobile.com/json/prices", { method: "POST", headers: auth, body: JSON.stringify({ format: "JSON", countries }), cache: "no-store", signal: AbortSignal.timeout(8000) }),
  ]);
  if (!balanceResponse.ok || !priceResponse.ok) throw new Error("No se pudo consultar el saldo y las tarifas.");
  const balance = await balanceResponse.json();
  const prices = await priceResponse.json();
  const rates: Record<string, number> = {};
  for (const country of countries) {
    const rate = Number(prices[country]?.credits);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error(`No hay tarifa disponible para ${country}.`);
    rates[country] = rate;
  }
  const credits = Number(balance.credits);
  if (balance.credits == null || !Number.isFinite(credits)) throw new Error("No se pudo verificar el saldo.");
  return { balance: credits, rates };
}

export function campaignPayload(input: { message: string; phones: string[]; subid: string; scheduledAt: string | null }, ackSecret: string) {
  return {
    message: input.message, recipient: input.phones.map(phone => ({ msisdn: phone.replace(/^\+/, "") })),
    subid: input.subid, label: "La Polla / Admin SMS", long: 1, shortlink: 0,
    ...(smsSize(input.message).unicode ? { ucs2: 1 } : {}),
    ...(input.scheduledAt ? { scheduled: new Date(input.scheduledAt).toISOString().slice(0, 19).replace("T", " ") } : {}),
    ackurl: `https://lapollacolombiana.com/api/sms/ack?k=${encodeURIComponent(ackSecret)}`,
  };
}

/** One POST, no retries. Unknown means reconcile at the provider, never resend. */
export async function dispatchCampaign(input: { message: string; phones: string[]; subid: string; scheduledAt: string | null }) {
  const auth = headers();
  const secret = process.env.SMS_ACK_SECRET;
  if (!secret || process.env.LABSMOBILE_DRY_RUN === "1") throw new Error("Envío real no habilitado.");
  try {
    const response = await fetch("https://api.labsmobile.com/json/send", {
      method: "POST", headers: auth, body: JSON.stringify(campaignPayload(input, secret)), signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json();
    const code = String(result.code ?? "");
    if (response.ok && code === "0") return { state: input.scheduledAt ? "scheduled" : "accepted", code };
    // A malformed/5xx response cannot prove that the provider did not accept it.
    if (response.status < 500 && /^\d+$/.test(code) && code !== "0") return { state: "rejected", code };
    return { state: "unknown", code: "ambiguous" };
  } catch {
    return { state: "unknown", code: "timeout_or_connection" };
  }
}

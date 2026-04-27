// app/api/whatsapp/webhook/route.ts — Inbound WhatsApp webhook.
//
// This is intentionally minimal — the bot is otherwise outbound-only
// (invites + notifications). The only inbound flow we care about is
// the SMS-OTP fallback: a user who can't receive SMS taps the
// "Probar con WhatsApp" button on /login, which opens
// `wa.me/<bot>?text=Quiero%20entrar%20a%20La%20Polla`. They press
// send, Meta delivers the text here, we generate a one-time magic
// token and reply with a CTA button that signs them in via
// `/api/auth/wa-magic?token=…`.
//
// Anything we don't recognize gets a polite "no entendí" reply so the
// bot never goes silent and users always have a path forward.

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTextMessage } from "@/lib/whatsapp/bot";
import { sendCTAButton } from "@/lib/whatsapp/interactive";
import { normalizePhone } from "@/lib/auth/phone";
import { checkAndRecordAttempt } from "@/lib/auth/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAGIC_TOKEN_TTL_MIN = 10;
const APP_URL =
  (process.env.NEXT_PUBLIC_APP_URL ?? "").trim() ||
  "https://lapollacolombiana.com";

// ─── Meta subscription verification (GET) ───

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");
  const expected = process.env.META_WA_WEBHOOK_VERIFY_TOKEN;

  if (mode === "subscribe" && expected && token === expected && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return new NextResponse("forbidden", { status: 403 });
}

// ─── Inbound message delivery (POST) ───

interface IncomingTextBody {
  text?: string;
  type: string;
  from: string;
  interactiveButtonId?: string | null;
  interactiveButtonTitle?: string | null;
}

export async function POST(request: NextRequest) {
  // Read raw body BEFORE parsing — HMAC must run over original bytes.
  const raw = await request.text();

  if (!verifySignature(request, raw)) {
    return new NextResponse("invalid signature", { status: 403 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse("bad json", { status: 400 });
  }

  // Top-level guard. Meta sends pings + unrelated events through the
  // same hook; only "whatsapp_business_account" carries messages.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = body as any;
  if (obj?.object !== "whatsapp_business_account") {
    return NextResponse.json({ status: "ok" });
  }

  // Drill into the first message in the payload (Meta only ever sends
  // one per webhook call for incoming messages, batches are status
  // updates which we ignore).
  const change = obj?.entry?.[0]?.changes?.[0]?.value;
  const message = change?.messages?.[0];

  if (!message) {
    // Status update / delivery receipt — acknowledge and move on so
    // Meta doesn't retry.
    return NextResponse.json({ status: "ok" });
  }

  const incoming: IncomingTextBody = {
    type: message.type,
    from: message.from,
    text: message.text?.body?.trim() ?? "",
    interactiveButtonId: message.interactive?.button_reply?.id ?? null,
    interactiveButtonTitle: message.interactive?.button_reply?.title ?? null,
  };

  try {
    await handleMessage(incoming, request);
  } catch (err) {
    console.error("[wa-webhook] handle failed:", err);
    // Still 200 — Meta retries on non-2xx, which would compound any
    // transient failure (and risk replaying a magic-link send).
  }

  return NextResponse.json({ status: "ok" });
}

// ─── Routing ───

const LOGIN_KEYWORDS = [
  "quiero entrar",
  "entrar a la polla",
  "login",
  "iniciar sesion",
  "iniciar sesión",
  "magic",
  "wa-login",
];

async function handleMessage(msg: IncomingTextBody, request: NextRequest) {
  const text = (msg.text ?? "").toLowerCase();
  const isLoginIntent =
    msg.type === "text" &&
    LOGIN_KEYWORDS.some((kw) => text.includes(kw));

  if (isLoginIntent) {
    await replyWithMagicLink(msg.from, request);
    return;
  }

  // Fallback: greet + tell them what we *can* do. Keeps the bot
  // friendly and discoverable for users who type "hola".
  await sendTextMessage(
    msg.from,
    "¡Hola! Soy el bot de La Polla 🐔\n\n" +
      "Por ahora solo te ayudo a entrar si no te llegó el SMS. " +
      'Mandame "*Quiero entrar a La Polla*" y te paso un link para ' +
      "loguearte directo, sin códigos.",
  );
}

// ─── Magic-link generation ───

async function replyWithMagicLink(fromRaw: string, request: NextRequest) {
  const phoneNormalized = normalizePhone(fromRaw);

  // Cap how often a single number can ask for a magic link. Reuses
  // the existing rate-limit infra (5 generates per hour) — this
  // covers both abuse and accidental retap loops.
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
  const limit = await checkAndRecordAttempt(phoneNormalized, "generate", ip);
  if (limit.blocked) {
    await sendTextMessage(
      fromRaw,
      "Muchos intentos. Esperá unos minutos y probá de nuevo. 🙏",
    );
    return;
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(
    Date.now() + MAGIC_TOKEN_TTL_MIN * 60 * 1000,
  ).toISOString();

  const admin = createAdminClient();
  const { error: insertErr } = await admin.from("wa_magic_tokens").insert({
    token,
    phone_number: phoneNormalized,
    expires_at: expiresAt,
    ip_address: ip ?? null,
  });
  if (insertErr) {
    console.error("[wa-webhook] insert magic token failed:", insertErr);
    await sendTextMessage(
      fromRaw,
      "Algo falló del lado nuestro. Probá de nuevo en un minuto.",
    );
    return;
  }

  const url = `${APP_URL}/api/auth/wa-magic?token=${token}`;

  await sendCTAButton(
    fromRaw,
    "¡Listo, parce! Tocá el botón de abajo y te logueás derechito en La Polla. " +
      "El link sirve por 10 minutos y solo lo podés usar una vez 🐔",
    "Entrar a La Polla",
    url,
    "La Polla Colombiana 🐥",
  );
}

// ─── Signature verification ───

function verifySignature(request: NextRequest, raw: string): boolean {
  const secret = process.env.META_WA_APP_SECRET;
  if (!secret) {
    // Dev affordance: allow unsigned in environments without the
    // secret. Same behavior the old webhook had — log loudly so we
    // don't ship to prod with this hole open.
    console.warn(
      "[wa-webhook] META_WA_APP_SECRET unset — skipping signature check",
    );
    return true;
  }
  const header = request.headers.get("x-hub-signature-256") ?? "";
  if (!header.startsWith("sha256=")) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(raw, "utf8")
    .digest("hex");
  const received = header.slice("sha256=".length);

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(received, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

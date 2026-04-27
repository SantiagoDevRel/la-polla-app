// app/api/whatsapp/webhook/route.ts — Inbound WhatsApp webhook.
//
// Two distinct paths share the same hook:
//   1. Magic-link (SMS-OTP fallback): the user came from /login by
//      tapping the WhatsApp button. The pre-text is a tight phrase
//      ("hola parce ... quiero entrar a la polla"); when we see it
//      we generate a one-time token and reply with a CTA that signs
//      them in via /api/auth/wa-magic?token=…
//   2. Conversational bot (everything else): a known user gets routed
//      through lib/whatsapp/router.ts (state-machine + flows.ts) so
//      the bot can show pollas, take predictions, render the table,
//      etc. Unknown users get an onboarding nudge inside the router.
//
// The split lives here (not inside the router) because the magic-link
// path needs to work for users who don't have a row in public.users yet
// — they're still onboarding. Asking the router to special-case that
// would couple two unrelated flows.

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTextMessage } from "@/lib/whatsapp/bot";
import { sendCTAButton } from "@/lib/whatsapp/interactive";
import { normalizePhone } from "@/lib/auth/phone";
import { checkAndRecordAttempt } from "@/lib/auth/rate-limit";
import {
  processIncomingMessage,
  type IncomingMessage,
} from "@/lib/whatsapp/router";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAGIC_TOKEN_TTL_MIN = 10;
const APP_URL =
  (process.env.NEXT_PUBLIC_APP_URL ?? "").trim() ||
  "https://lapollacolombiana.com";

// Tight match: the exact phrase /login pre-fills as the SMS-fallback
// button. Generic words like "login" or "entrar" don't qualify on
// purpose — those should reach the conversational bot, not generate a
// magic link.
const LOGIN_KEYWORDS = ["quiero entrar a la polla"];

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = body as any;
  if (obj?.object !== "whatsapp_business_account") {
    return NextResponse.json({ status: "ok" });
  }

  const change = obj?.entry?.[0]?.changes?.[0]?.value;
  const message = change?.messages?.[0];

  if (!message) {
    return NextResponse.json({ status: "ok" });
  }

  try {
    await dispatch(message, request);
  } catch (err) {
    console.error("[wa-webhook] handle failed:", err);
    // Still 200 — Meta retries on non-2xx, which would compound any
    // transient failure (and risk replaying a magic-link send).
  }

  return NextResponse.json({ status: "ok" });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function dispatch(message: any, request: NextRequest): Promise<void> {
  const from: string = message.from;
  const type: string = message.type;
  const textBody: string = (message.text?.body ?? "").trim();

  // 1. Magic-link path — tight phrase match on free text only. Keep it
  //    in front of the router so users without a public.users row (mid-
  //    onboarding) can still recover via SMS fallback.
  if (type === "text" && textBody) {
    const lower = textBody.toLowerCase();
    if (LOGIN_KEYWORDS.some((kw) => lower.includes(kw))) {
      await replyWithMagicLink(from, request);
      return;
    }
  }

  // 2. Conversational bot — hand off to the router.
  const incoming: IncomingMessage = {
    from,
    type,
    text: message.text,
    interactive: message.interactive,
  };
  await processIncomingMessage(incoming);
}

// ─── Magic-link generation ───

async function replyWithMagicLink(fromRaw: string, request: NextRequest) {
  const phoneNormalized = normalizePhone(fromRaw);

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
  const e164 = `+${phoneNormalized}`;
  await sendCTAButton(
    fromRaw,
    `¡Listo, parce! Te logueo a *La Polla* como *${e164}*.\n\n` +
      "El link de abajo sirve por 10 minutos y solo lo podés usar una vez 🐔",
    "Entrar a La Polla",
    url,
    "La Polla Colombiana 🐥",
  );
}

// ─── Signature verification ───

function verifySignature(request: NextRequest, raw: string): boolean {
  const secret = process.env.META_WA_APP_SECRET;
  if (!secret) {
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

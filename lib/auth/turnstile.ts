// lib/auth/turnstile.ts — Server-side Cloudflare Turnstile token validation.
// The widget on /login emits a token; this helper sends it to Cloudflare's
// siteverify endpoint with our secret. Frontend-only validation is bypass-
// able by anyone scripting the form, so check-phone (the only public
// pre-auth endpoint) must call this server-side.
//
// Docs: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

const VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

interface TurnstileVerifyResponse {
  success: boolean;
  "error-codes"?: string[];
  challenge_ts?: string;
  hostname?: string;
}

export async function verifyTurnstile(
  token: string,
  ip?: string,
): Promise<{ ok: boolean; reason?: string }> {
  const secret = (process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY ?? "").trim();

  if (!secret) {
    // Producción: fail-CLOSED. Si la env var no entra a Vercel prod por
    // un typo o por preview→prod mismatch, no podemos dejar que el
    // endpoint quede sin protección silenciosamente. Mejor login roto
    // (visible al instante) que bot army gastándonos Twilio.
    //
    // Dev: fail-open con warning para no bloquear desarrollo local.
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[turnstile] CLOUDFLARE_TURNSTILE_SECRET_KEY missing in production — failing closed",
      );
      return { ok: false, reason: "secret_missing_in_prod" };
    }
    console.warn(
      "[turnstile] CLOUDFLARE_TURNSTILE_SECRET_KEY not set — skipping verification (dev only)",
    );
    return { ok: true, reason: "no_secret_configured_dev" };
  }

  if (!token || token.length < 10) {
    return { ok: false, reason: "missing_token" };
  }

  const formData = new URLSearchParams();
  formData.append("secret", secret);
  formData.append("response", token);
  if (ip) formData.append("remoteip", ip);

  try {
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      console.error(
        `[turnstile] siteverify HTTP ${res.status}: ${res.statusText}`,
      );
      return { ok: false, reason: "verify_http_error" };
    }

    const data = (await res.json()) as TurnstileVerifyResponse;

    if (!data.success) {
      console.warn(
        "[turnstile] verification rejected:",
        data["error-codes"]?.join(", ") ?? "(no error-codes)",
      );
      return {
        ok: false,
        reason: data["error-codes"]?.[0] ?? "rejected",
      };
    }

    return { ok: true };
  } catch (err) {
    console.error("[turnstile] verification threw:", err);
    return { ok: false, reason: "verify_threw" };
  }
}

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
    // Dev / preview without Turnstile configured: allow but warn loud so
    // we never ship to prod with the env unset.
    console.warn(
      "[turnstile] CLOUDFLARE_TURNSTILE_SECRET_KEY not set — skipping verification (dev mode)",
    );
    return { ok: true, reason: "no_secret_configured" };
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

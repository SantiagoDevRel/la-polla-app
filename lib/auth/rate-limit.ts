// lib/auth/rate-limit.ts — OTP rate limiting using Supabase as backing store
// Limits: 5 generate attempts per phone per hour, 5 verify attempts per 15 minutes

import { createAdminClient } from "@/lib/supabase/admin";

const LIMITS = {
  generate: { maxAttempts: 5, windowMinutes: 60 },
  verify: { maxAttempts: 5, windowMinutes: 15 },
  // Join-by-code: 5 attempts per phone per 10 minutes. Tighter than verify
  // so brute-forcing the 32^6 code space is not feasible.
  join_code: { maxAttempts: 5, windowMinutes: 10 },
  // Phone+password login (matches /api/auth/login-password). Mismo presupuesto
  // que `verify`: 5 intentos por teléfono cada 15 minutos.
  password: { maxAttempts: 5, windowMinutes: 15 },
} as const;

type AttemptType = keyof typeof LIMITS;

interface RateLimitResult {
  blocked: boolean;
  remaining: number;
  retryAfter?: Date;
}

/**
 * Records an attempt and checks if the phone is rate limited.
 * Call BEFORE processing the OTP request.
 */
export async function checkAndRecordAttempt(
  phone: string,
  type: AttemptType,
  ip?: string
): Promise<RateLimitResult> {
  const admin = createAdminClient();
  const { maxAttempts, windowMinutes } = LIMITS[type];
  const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000);

  // Count recent attempts in window
  const { count } = await admin
    .from("otp_rate_limits")
    .select("*", { count: "exact", head: true })
    .eq("phone_number", phone)
    .eq("attempt_type", type)
    .gte("attempted_at", windowStart.toISOString());

  const currentCount = count ?? 0;

  if (currentCount >= maxAttempts) {
    // Calculate when the oldest attempt in window expires
    const { data: oldest } = await admin
      .from("otp_rate_limits")
      .select("attempted_at")
      .eq("phone_number", phone)
      .eq("attempt_type", type)
      .gte("attempted_at", windowStart.toISOString())
      .order("attempted_at", { ascending: true })
      .limit(1)
      .single();

    const retryAfter = oldest
      ? new Date(
          new Date(oldest.attempted_at).getTime() + windowMinutes * 60 * 1000
        )
      : new Date(Date.now() + windowMinutes * 60 * 1000);

    return { blocked: true, remaining: 0, retryAfter };
  }

  // Record this attempt
  await admin.from("otp_rate_limits").insert({
    phone_number: phone,
    attempt_type: type,
    ip_address: ip ?? null,
  });

  return { blocked: false, remaining: maxAttempts - currentCount - 1 };
}

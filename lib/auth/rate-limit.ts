// lib/auth/rate-limit.ts — OTP rate limiting using Supabase as backing store
// Limits: 5 generate attempts per phone per hour, 5 verify attempts per 15 minutes

import { createAdminClient } from "@/lib/supabase/admin";

const LIMITS = {
  generate: { maxAttempts: 5, windowMinutes: 60 },
  verify: { maxAttempts: 5, windowMinutes: 15 },
  // Join-by-code: 5 attempts per phone per 10 minutes. Tighter than verify
  // so brute-forcing the 32^6 code space is not feasible.
  join_code: { maxAttempts: 5, windowMinutes: 10 },
} as const;

// IP-based generate limit — defensa contra Twilio bill-bombing.
// El límite por phone (5/hora) NO frena el ataque real: un bot rota
// 1000 números colombianos random, cada uno es un phone distinto y
// ninguno pega el límite → 1000 SMS a ~$0.05 = $50. El gate por IP sí
// lo corta porque el atacante scriptea desde un set acotado de IPs.
//
// Doble ventana:
//   - Burst (8/min): mata floods scripteados (un bot hace cientos de
//     requests en segundos; a los 8 lo frenamos).
//   - Sostenido (40/hora): capa el costo aunque el bot vaya lento.
//
// 40/hora es generoso a propósito para no bloquear usuarios reales tras
// CGNAT de carriers móviles colombianos (Claro/Movistar/Tigo comparten
// IPs públicas). 40 logins reales/hora desde una misma IP es improbable
// salvo escala seria — y a un bot lo deja en ~$2/hora máx, acotado
// además por el cap de gasto a nivel cuenta Twilio.
const IP_GENERATE_WINDOWS = [
  { maxAttempts: 8, windowMinutes: 1 },
  { maxAttempts: 40, windowMinutes: 60 },
] as const;

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

/**
 * Checks whether an IP has exceeded the generate rate limit across the
 * burst + sustained windows. COUNT-only: no insert — la fila la inserta
 * checkAndRecordAttempt (que graba phone + ip juntos), así cada request
 * graba exactamente una fila y ambos checks leen de las mismas filas.
 *
 * Llamar ANTES de checkAndRecordAttempt en el flow de generate. Si no
 * hay IP (no se pudo resolver), el caller debe saltear este check —
 * el límite por phone sigue aplicando como fallback.
 */
export async function checkIpRateLimit(ip: string): Promise<RateLimitResult> {
  const admin = createAdminClient();

  for (const { maxAttempts, windowMinutes } of IP_GENERATE_WINDOWS) {
    const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000);
    const { count } = await admin
      .from("otp_rate_limits")
      .select("*", { count: "exact", head: true })
      .eq("ip_address", ip)
      .eq("attempt_type", "generate")
      .gte("attempted_at", windowStart.toISOString());

    if ((count ?? 0) >= maxAttempts) {
      return {
        blocked: true,
        remaining: 0,
        retryAfter: new Date(Date.now() + windowMinutes * 60 * 1000),
      };
    }
  }

  return { blocked: false, remaining: 0 };
}

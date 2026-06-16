// lib/auth/rate-limit.ts — OTP rate limiting using Supabase as backing store
// Limits: 5 generate attempts per phone per hour, 5 verify attempts per 15 minutes

import { createAdminClient } from "@/lib/supabase/admin";

const LIMITS = {
  generate: { maxAttempts: 5, windowMinutes: 60 },
  verify: { maxAttempts: 5, windowMinutes: 15 },
  // Join-by-code: 5 attempts per phone per 10 minutes. Tighter than verify
  // so brute-forcing the 32^6 code space is not feasible.
  join_code: { maxAttempts: 5, windowMinutes: 10 },
  // WhatsApp magic-link sends (lib/whatsapp webhook). Misma cadencia que
  // 'generate' para frenar abuso, pero con tipo PROPIO: el magic-link de
  // WhatsApp NO cuesta Twilio, así que NO debe contar en el tope diario de
  // SMS ni inflar las métricas de costo (que cuentan solo 'generate').
  wa_magic: { maxAttempts: 5, windowMinutes: 60 },
} as const;

// Tope DIARIO de SMS por teléfono. Más allá, el login empuja al usuario a
// WhatsApp (gratis) — no lo bloquea, porque el fallback de WhatsApp del
// /login ya existe y funciona. Acota el costo Twilio del re-login crónico
// (usuarios reales pidiendo varios SMS/día por el bug de persistencia de
// sesión) sin castigar a nadie. Bumpealo si hay quejas de gente sin WhatsApp.
export const DAILY_SMS_CAP = 2;

// IP-based generate limit — cap GENEROSO contra Twilio bill-bombing.
// El límite por phone (5/hora) NO frena el ataque real: un bot rota
// 1000 números colombianos random, cada uno es un phone distinto y
// ninguno pega el límite → 1000 SMS a ~$0.05 = $50.
//
// Decisión (2026-05-28): cap alto SIN ventana de burst. Las IPs NO son
// por persona — los carriers móviles colombianos (Claro/Movistar/Tigo)
// usan CGNAT y meten muchos usuarios reales detrás de una misma IP
// pública. Un burst bajo (ej. 2-8/min) bloquearía grupos legítimos que
// entran juntos antes de un partido. 60/hora es lo bastante alto para
// que un usuario real nunca lo toque, ni en CGNAT, pero le pone techo
// gratis a un bot de una sola IP (~60 SMS/hora = ~$3). El backstop real
// contra cualquier ataque (rote IPs o no) es el cap de gasto a nivel
// cuenta Twilio.
const IP_GENERATE_WINDOWS = [
  { maxAttempts: 60, windowMinutes: 60 },
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
 * Count-only: ¿el teléfono ya gastó su cupo de SMS de hoy (últimas 24h)?
 * Cuenta SOLO attempt_type='generate' (SMS reales por Twilio); el magic-link
 * de WhatsApp usa 'wa_magic' y NO cuenta. Llamar ANTES de checkAndRecordAttempt
 * en el flow de SMS. No inserta — la fila la graba checkAndRecordAttempt.
 */
export async function checkDailySmsCap(phone: string): Promise<RateLimitResult> {
  const admin = createAdminClient();
  const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const { count } = await admin
    .from("otp_rate_limits")
    .select("*", { count: "exact", head: true })
    .eq("phone_number", phone)
    .eq("attempt_type", "generate")
    .gte("attempted_at", windowStart.toISOString());
  const used = count ?? 0;
  if (used >= DAILY_SMS_CAP) {
    return {
      blocked: true,
      remaining: 0,
      retryAfter: new Date(Date.now() + 24 * 60 * 60 * 1000),
    };
  }
  return { blocked: false, remaining: DAILY_SMS_CAP - used };
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

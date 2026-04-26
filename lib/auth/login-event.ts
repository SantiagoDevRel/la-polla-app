// lib/auth/login-event.ts — Records every successful login as a
// notification of type 'login_event' so the user can see their own login
// history in /avisos. Useful for the user spotting unauthorized access.
//
// Geolocation comes from Vercel's edge headers (free, no extra service).
// Device label parsed from User-Agent in lib/auth/user-agent.ts.

import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseDeviceLabel } from "@/lib/auth/user-agent";

interface RecordLoginEventParams {
  userId: string;
  method: "password" | "otp";
  request: NextRequest;
}

export async function recordLoginEvent(
  params: RecordLoginEventParams,
): Promise<void> {
  const { userId, method, request } = params;

  const userAgent = request.headers.get("user-agent");
  const device = parseDeviceLabel(userAgent);

  // Vercel returns these as URL-encoded UTF-8 (Medellín → "Medell%C3%ADn").
  // Decode so the body reads naturally in /avisos.
  const cityRaw = request.headers.get("x-vercel-ip-city");
  const country = request.headers.get("x-vercel-ip-country") ?? null;
  let city: string | null = null;
  if (cityRaw) {
    try {
      city = decodeURIComponent(cityRaw);
    } catch {
      city = cityRaw;
    }
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  // Body examples:
  //   "Desde iPhone en Medellín, CO"
  //   "Desde Android en Bogotá, CO"
  //   "Desde Mac"  (when geolocation is unavailable, e.g. localhost)
  let location = "";
  if (city && country) location = ` en ${city}, ${country}`;
  else if (country) location = ` desde ${country}`;
  const body = `Desde ${device}${location}`;

  const title =
    method === "password"
      ? "Iniciaste sesión"
      : "Iniciaste sesión con código";

  const admin = createAdminClient();
  const { error } = await admin.from("notifications").insert({
    user_id: userId,
    type: "login_event",
    title,
    body,
    metadata: {
      method,
      device,
      city,
      country,
      ip,
      user_agent: userAgent ?? null,
    },
  });

  if (error) {
    console.error("[login-event] insert failed:", error);
  }
}

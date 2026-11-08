// lib/auth/cron-secret.ts — Autenticación de los endpoints /api/cron/*.
//
// Quien llama es GitHub Actions (ver .github/workflows/*.yml), no un browser:
// manda `Authorization: Bearer <CRON_SECRET>`. El middleware exime el prefijo
// `/api/cron/` del gate de sesión (lib/supabase/middleware.ts), así que esta
// verificación es la ÚNICA puerta de esas rutas. Todo route.ts bajo
// app/api/cron/ debe empezar con:
//
//   const denied = requireCronSecret(request);
//   if (denied) return denied;
//
// ANTES de crear el admin client o leer el body. tests/cron-auth.test.ts lo
// verifica estáticamente para cada ruta.
//
// Comparación: SHA-256 de ambos lados + timingSafeEqual. Los dos digests
// miden siempre 32 bytes, así que ni el largo del secreto ni el prefijo que
// coincide se filtran por tiempo de respuesta.
//
// No confundir con los endpoints que llama pg_cron (/api/matches/sync-live,
// /api/matches/discover, ...): esos usan el header `x-cron-secret` y
// responden 401; tienen su propio chequeo.
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { isPreviewDeployment } from "@/lib/preview-guard";

const BEARER_PREFIX = "Bearer ";

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Compara en tiempo constante un secreto recibido con CRON_SECRET.
 * Devuelve false si CRON_SECRET no está configurado.
 */
export function cronSecretMatches(provided: string | null | undefined): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected || typeof provided !== "string") return false;
  return timingSafeEqual(sha256(provided), sha256(expected));
}

/**
 * Exige `Authorization: Bearer <CRON_SECRET>`.
 *
 * - `null` → autorizado, el handler sigue.
 * - 500 `{ error: "CRON_SECRET not configured" }` si falta la variable.
 * - 403 `{ error: "forbidden" }` si el header falta, no usa `Bearer ` o no
 *   coincide.
 * - 404 `{ error: "disabled_in_preview" }` en un deploy de Vercel Preview: un
 *   cron nunca corre contra la base de previews (lib/preview-guard.ts).
 */
export function requireCronSecret(request: Request): NextResponse | null {
  if (isPreviewDeployment()) {
    return NextResponse.json(
      { error: "disabled_in_preview" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  const expected = process.env.CRON_SECRET;
  if (!expected || expected.trim() === "") {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith(BEARER_PREFIX)
    ? header.slice(BEARER_PREFIX.length)
    : null;

  // Se compara igual aunque falte el prefijo, para no responder más rápido
  // cuando el header viene mal formado.
  const matches = cronSecretMatches(provided ?? header);
  if (provided === null || !matches) {
    return NextResponse.json(
      { error: "forbidden" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  return null;
}

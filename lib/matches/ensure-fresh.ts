// lib/matches/ensure-fresh.ts — Lazy sync adaptativo para partidos recientes.
// Se dispara desde puntos calientes (detalle de polla, leaderboard/predicciones del bot, dashboard).
// La ventana la decide la DB en UNA query atomica:
//   - 5 min  si hay partidos live
//   - 15 min si hay scheduled dentro de las proximas 3h
//   - 120 min en reposo
// check_and_reserve_match_sync() ademas reserva el slot atomicamente, asi que
// solo el primer caller dentro de la ventana dispara el HTTP al sync-recent.
import { createAdminClient } from "@/lib/supabase/admin";

export async function ensureMatchesFresh(): Promise<void> {
  try {
    const admin = createAdminClient();

    const { data, error } = await admin.rpc("check_and_reserve_match_sync");
    if (error) {
      console.warn("[ensureMatchesFresh] rpc error:", error.message);
      return;
    }
    if (data !== true) return; // dentro de ventana, otro ya reservo o es reciente

    const secret = process.env.CRON_SECRET;
    if (!secret) {
      console.warn("[ensureMatchesFresh] CRON_SECRET ausente, skip fire-and-forget");
      return;
    }

    const base =
      (process.env.NEXT_PUBLIC_APP_URL ?? "").trim() || "https://la-polla.vercel.app";

    // Fire-and-forget: no await, no bloquea la respuesta.
    fetch(`${base}/api/matches/sync-recent`, {
      method: "POST",
      headers: { "x-cron-secret": secret },
      cache: "no-store",
    }).catch((err) => {
      console.warn("[ensureMatchesFresh] fire-and-forget fallo:", err);
    });
  } catch (err) {
    console.warn("[ensureMatchesFresh] error:", err);
  }
}

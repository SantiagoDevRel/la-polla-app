// lib/matches/ensure-fresh.ts — Lazy sync adaptativo para partidos recientes.
// Se dispara desde puntos calientes (detalle de polla, leaderboard/predicciones del bot, dashboard).
// La ventana la decide la DB en UNA query atomica:
//   - 3 min  si hay scheduled cuyo kickoff esta en [now-2h30m, now+15m]
//             (ventana de transicion scheduled → live).
//   - 5 min  si hay partidos live en nuestra DB.
//   - 15 min si hay scheduled dentro de las proximas 3h.
//   - 120 min en reposo.
// check_and_reserve_match_sync() ademas reserva el slot atomicamente, asi que
// solo el primer caller dentro de la ventana dispara el HTTP al sync-recent.
//
// Path throttled (caso comun): un solo await al RPC de reserva, return inmediato.
// Path no-throttled (caso raro): fire-and-forget del heal + del sync HTTP. Cero awaits adicionales.
// Todos los call sites son `void ensureMatchesFresh()` — nadie depende del side effect sincrono.
import { createAdminClient } from "@/lib/supabase/admin";

export async function ensureMatchesFresh(): Promise<void> {
  try {
    const admin = createAdminClient();

    // Reserva primero: si estamos throttled, salimos antes de gastar nada mas.
    const { data, error } = await admin.rpc("check_and_reserve_match_sync");
    if (error) {
      console.warn("[ensureMatchesFresh] rpc error:", error.message);
      return;
    }
    if (data !== true) return; // dentro de ventana, otro ya reservo o es reciente

    // Heal stale live matches en background — el trigger matches_prevent_status_regress
    // previene que un sync posterior lo deshaga.
    void admin.rpc("flip_stale_live_matches").then((res) => {
      if (res.error) {
        console.warn(
          "[ensureMatchesFresh] flip_stale_live_matches failed:",
          res.error.message,
        );
      }
    });

    const secret = process.env.CRON_SECRET;
    if (!secret) {
      console.warn("[ensureMatchesFresh] CRON_SECRET ausente, skip fire-and-forget");
      return;
    }

    const base =
      (process.env.NEXT_PUBLIC_APP_URL ?? "").trim() || "https://lapollacolombiana.com";

    // Fire-and-forget puro — no Promise.race, no await. El sync corre en background.
    void fetch(`${base}/api/matches/sync-recent`, {
      method: "POST",
      headers: { "x-cron-secret": secret },
      cache: "no-store",
    }).catch((err) => {
      console.warn("[ensureMatchesFresh] sync fetch failed:", err);
    });
  } catch (err) {
    console.warn("[ensureMatchesFresh] error:", err);
  }
}

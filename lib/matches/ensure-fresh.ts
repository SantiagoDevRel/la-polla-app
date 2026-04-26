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
// Ademas de flip_stale_live_matches, cuando el caller reservo el slot hacemos
// un Promise.race entre el sync remoto y un timeout de 700ms. Si
// football-data contesta rapido, la pagina que invoco ensureMatchesFresh ya
// lee datos frescos (home_score, elapsed, status). Si no contesta, dejamos
// el sync corriendo en background y la pagina se renderiza con lo que haya,
// igual que antes. Sin bloqueos largos y sin pagar latencia extra cuando
// football-data tiene un mal dia.
import { createAdminClient } from "@/lib/supabase/admin";

const SYNC_RACE_TIMEOUT_MS = 700;

export async function ensureMatchesFresh(): Promise<void> {
  try {
    const admin = createAdminClient();

    // Heal any "stale live" matches first. football-data.org sometimes
    // lags several hours before flipping a match to FINISHED; without
    // this, /inicio can keep claiming a match is live long after the
    // final whistle. Cheap UPDATE — no network cost, runs every call.
    // The matches_prevent_status_regress trigger ensures this cannot be
    // undone by a later sync that still reports IN_PLAY.
    const healed = await admin.rpc("flip_stale_live_matches");
    if (healed.error) {
      console.warn(
        "[ensureMatchesFresh] flip_stale_live_matches failed:",
        healed.error.message,
      );
    }

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
      (process.env.NEXT_PUBLIC_APP_URL ?? "").trim() || "https://lapollacolombiana.com";

    // Kick the sync. Errors are swallowed so a Promise.race never
    // rejects — we always either resolve on the sync's success or
    // time out after 700ms, whichever comes first.
    const syncPromise = fetch(`${base}/api/matches/sync-recent`, {
      method: "POST",
      headers: { "x-cron-secret": secret },
      cache: "no-store",
    }).catch((err) => {
      console.warn("[ensureMatchesFresh] sync fetch failed:", err);
    });

    await Promise.race([
      syncPromise,
      new Promise<void>((resolve) => setTimeout(resolve, SYNC_RACE_TIMEOUT_MS)),
    ]);
  } catch (err) {
    console.warn("[ensureMatchesFresh] error:", err);
  }
}

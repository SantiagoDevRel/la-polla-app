// scripts/seed-matches.ts — Script de seed para importar partidos reales desde API-Football
// Uso: npx ts-node -P scripts/tsconfig.scripts.json -r tsconfig-paths/register scripts/seed-matches.ts
// Requiere RAPIDAPI_KEY y SUPABASE_SERVICE_ROLE_KEY en .env

import { config } from "dotenv";
config({ path: ".env" });

import { syncLeague } from "@/lib/api-football/sync";

async function main() {
  console.log("Iniciando seed de partidos...\n");
  let totalSynced = 0;

  // Champions League 2024-2025 (league ID 2, season 2024)
  try {
    console.log("Sincronizando Champions League 2024-2025...");
    const championsResult = await syncLeague(2, 2024);
    console.log("Champions:", championsResult);
    totalSynced += championsResult.synced;
  } catch (err) {
    console.error("Error sincronizando Champions:", err instanceof Error ? err.message : err);
  }

  // Copa del Mundo 2026 (league ID 1, season 2026)
  // Nota: El plan gratuito de API-Football puede no soportar la temporada 2026.
  // En ese caso el error es esperado y no es bloqueante.
  try {
    console.log("\nSincronizando Copa del Mundo 2026...");
    const worldcupResult = await syncLeague(1, 2026);
    console.log("World Cup:", worldcupResult);
    totalSynced += worldcupResult.synced;
  } catch (err) {
    console.warn(
      "World Cup 2026 no disponible (esperado si el plan no soporta season 2026):",
      err instanceof Error ? err.message : err
    );
  }

  console.log(`\nSeed completado. Total insertados: ${totalSynced}`);
}

main().catch((err) => {
  console.error("Error en seed:", err);
  process.exit(1);
});

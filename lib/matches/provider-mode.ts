import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Fuente de datos de partidos (2026-09-13). El dueño decidió pasar calendario,
 * vivo y resultados a API-Football y dejar ESPN/football-data. El corte es un
 * cambio de `app_config.data_provider_mode`, no un deploy: con 'legacy' (o sin
 * fila) todo sigue como antes; con 'af' solo API-Football escribe partidos.
 *
 * Caché de 30 s por instancia: el cron de vivo corre cada minuto y no hace falta
 * leer la fila en cada request. Un error de lectura cae a 'legacy', que es el
 * comportamiento previo conocido.
 */
export type DataProviderMode = 'legacy' | 'af';

let cached: { mode: DataProviderMode; at: number } | null = null;
const TTL_MS = 30_000;

export async function getDataProviderMode(): Promise<DataProviderMode> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.mode;
  let mode: DataProviderMode = 'legacy';
  try {
    const { data, error } = await createAdminClient()
      .from('app_config')
      .select('value')
      .eq('key', 'data_provider_mode')
      .maybeSingle();
    if (!error && data?.value === 'af') mode = 'af';
  } catch {
    mode = 'legacy';
  }
  cached = { mode, at: Date.now() };
  return mode;
}

/** Solo para tests. */
export function resetDataProviderModeCache(): void {
  cached = null;
}

// scripts/sync-espn-ligas.ts — llena de partidos las ligas que football-data
// no cubre, usando ESPN.
//
//   npx tsx scripts/sync-espn-ligas.ts                      # las 8 creables
//   npx tsx scripts/sync-espn-ligas.ts champions_2025
//   npx tsx scripts/sync-espn-ligas.ts betplay_2026 libertadores_2026
//   npx tsx scripts/sync-espn-ligas.ts --dry                # solo imprime el plan
//
// Por que existe: `scripts/sync-ligas.ts` trae fixtures de football-data, cuyo
// plan free NO cubre Libertadores ni Liga BetPlay, y para Champions no siempre
// publica el calendario con anticipacion. Esas tres quedan sin partidos futuros
// en la DB, pero el formulario de crear polla las pinta igual que las demas: el
// administrador elige una liga vacia y ve "no hay partidos", que se lee como un
// error de la app y no como una liga sin calendario cargado.
//
// ESPN si las tiene y `lib/espn/client.ts` ya las mapea (uefa.champions,
// conmebol.libertadores, col.1), asi que no hace falta un proveedor nuevo ni
// una API key nueva: alcanza con correr el discover que ya existe.
//
// ⚠️ REGLA #1 del repo: toda insercion en `matches` pasa por el RPC
// `upsert_match_safe`. Este script NO escribe nada por su cuenta — delega en
// `discoverTournament`, que ya lo respeta. Si algun dia hace falta tocar como
// se guarda un partido, se toca el RPC o el discover, nunca aca.
//
// ⚠️ REGLA #2: cero filas "TBD vs TBD". El discover ya descarta los cruces de
// bracket sin equipos definidos (`hasPlaceholderTeam`), asi que una fase que
// todavia no tiene rivales simplemente no genera filas.
//
// Es idempotente: el RPC deduplica por external_id / espn_id / equipos+horario,
// asi que correlo las veces que quieras sin miedo a duplicar partidos.

import "dotenv/config";
import { discoverTournament, type DiscoverResult } from "@/lib/espn/discover";
import { ESPN_LEAGUE_BY_TOURNAMENT } from "@/lib/espn/client";
import { CREATABLE_TOURNAMENT_SLUGS, getTournamentName } from "@/lib/tournaments";

/** Los torneos que la casa puede usar Y que ESPN sabe responder. */
const POR_DEFECTO = CREATABLE_TOURNAMENT_SLUGS.filter(
  (slug) => !!ESPN_LEAGUE_BY_TOURNAMENT[slug],
);

/** Cuanto esperamos entre torneo y torneo. ESPN es publico y sin key: la unica
 *  forma de cuidarlo es no dispararle todo de golpe. */
const PAUSA_MS = 1500;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Opciones {
  slugs: string[];
  /** --dry imprime el plan y no toca ni ESPN ni la base. Sirve para revisar que
   *  la lista de torneos sea la correcta antes de escribir en produccion. */
  simulacion: boolean;
}

function leerArgumentos(): Opciones {
  const args = process.argv.slice(2);
  const simulacion = args.some((a) => a === "--dry" || a === "--dry-run");
  const slugs = args.filter((a) => a.charAt(0) !== "-");
  return { slugs, simulacion };
}

/** Un slug solo sirve si ESPN lo tiene mapeado; si no, el discover devuelve
 *  cero y el error pasa desapercibido. Mejor cortar antes con un mensaje claro. */
function validar(slugs: string[]): string[] {
  const desconocidos = slugs.filter((s) => !ESPN_LEAGUE_BY_TOURNAMENT[s]);
  if (desconocidos.length > 0) {
    console.error(`No tengo mapeo de ESPN para: ${desconocidos.join(", ")}`);
    console.error(`Opciones validas: ${Object.keys(ESPN_LEAGUE_BY_TOURNAMENT).join(", ")}`);
    process.exit(1);
  }
  return slugs;
}

function imprimirResultado(r: DiscoverResult) {
  const nombre = getTournamentName(r.tournament);
  console.log(
    `  ${nombre} (${r.league}): ${r.fetched} eventos en ESPN → ${r.inserted_or_updated} guardados, ${r.errors} fallos`,
  );

  // Los avisos suelen ser cruces de bracket sin equipos (REGLA #2) y son
  // esperados: se muestran los primeros para no tapar la salida.
  if (r.warnings.length > 0) {
    for (const w of r.warnings.slice(0, 3)) console.log(`      · ${w}`);
    if (r.warnings.length > 3) console.log(`      · (+${r.warnings.length - 3} avisos mas)`);
  }

  if (r.fetched > 0 && r.inserted_or_updated === 0) {
    console.log("      ! ESPN devolvio eventos pero no se guardo ninguno. Revisa el RPC.");
  }
  if (r.fetched === 0 && r.errors === 0) {
    console.log("      ! ESPN no devolvio partidos en la ventana. La liga puede estar en receso.");
  }
}

async function main() {
  const { slugs, simulacion } = leerArgumentos();
  const objetivo = slugs.length > 0 ? validar(slugs) : POR_DEFECTO.slice();

  console.log(
    `${simulacion ? "[simulacion] " : ""}Sincronizando ${objetivo.length} torneo(s) desde ESPN:`,
  );
  for (const slug of objetivo) {
    console.log(`  - ${getTournamentName(slug)} (${slug} → ${ESPN_LEAGUE_BY_TOURNAMENT[slug]})`);
  }
  console.log("");

  if (simulacion) {
    console.log("Simulacion: no se consulto ESPN ni se escribio en la base.");
    return;
  }

  // createAdminClient() usa `!` sobre estas dos variables, asi que sin ellas el
  // cliente se arma igual y falla mucho mas tarde con un error opaco.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el entorno");
  }

  let guardados = 0;
  let errores = 0;

  for (let i = 0; i < objetivo.length; i++) {
    const resultado = await discoverTournament(objetivo[i]);
    imprimirResultado(resultado);
    guardados += resultado.inserted_or_updated;
    errores += resultado.errors;
    if (i < objetivo.length - 1) await dormir(PAUSA_MS);
  }

  console.log(`\nListo: ${guardados} partidos guardados, ${errores} fallos.`);
  // Exit code distinto de cero para que un fallo se note al correrlo a mano.
  if (errores > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

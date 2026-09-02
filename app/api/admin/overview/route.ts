// app/api/admin/overview/route.ts — los tres numeros del panel de admin.
//
// Existe porque /api/admin/summary devuelve, ademas de los contadores, la
// lista COMPLETA de usuarios (con telefono) y de pollas del producto viejo.
// El panel nuevo solo necesita tres cifras, asi que pedirle todo eso al
// servidor era mandar PII al browser sin motivo. Este endpoint devuelve
// numeros y nada mas. `summary` se conserva: lo siguen usando otras
// pantallas de /admin.

import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// PostgREST corta en 1000 filas por request incluso con service_role, asi que
// las inscripciones se recorren por paginas. El tope de paginas es una red de
// seguridad: si algun dia hay mas de 20.000 inscripciones pagadas preferimos
// devolver un numero por lo bajo (y arreglarlo con un RPC) antes que dejar
// una request girando.
const PAGINA = 1000;
const MAX_PAGINAS = 20;

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user?.is_admin) {
    return NextResponse.json({ error: "Solo el administrador." }, { status: 403 });
  }

  const db = createAdminClient();

  const [usuarios, pollas] = await Promise.all([
    db.from("users").select("id", { count: "exact", head: true }),
    // Los borradores no son pollas creadas todavia: nadie las ve ni se puede
    // entrar a ellas mientras esten en ese estado.
    db
      .from("casa_pollas")
      .select("id", { count: "exact", head: true })
      .neq("status", "borrador"),
  ]);

  // "Pollas visitadas" no se puede medir: no hay analitica de paginas en el
  // proyecto (PostHog quedo fuera) y la base no guarda vistas. Lo que si
  // sabemos, y ademas es el dato que importa para una casa, es cuantas pollas
  // consiguieron por lo menos una inscripcion PAGADA. Se reporta eso, con ese
  // nombre, en vez de inventar una metrica que no podemos sostener.
  //
  // Se deduplica con un objeto y no con `[...new Set()]`: el target del
  // tsconfig es ES5 y `tsc` (el que corre en el build de produccion) rechaza
  // el spread de un Set aunque tsgo lo deje pasar.
  const vistos: Record<string, true> = {};
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const desde = pagina * PAGINA;
    const { data, error } = await db
      .from("casa_entries")
      .select("polla_id")
      .eq("status", "pagada")
      .order("polla_id", { ascending: true })
      // Desempate por `id`: `polla_id` NO es unico, y paginar con .range()
      // sobre una columna de orden repetida no garantiza el mismo orden
      // entre requests — filas que aparecen dos veces no molestan (se
      // deduplican), pero una que se SALTA subcuenta la metrica en silencio.
      .order("id", { ascending: true })
      .range(desde, desde + PAGINA - 1);

    if (error) {
      return NextResponse.json(
        { error: "No se pudieron leer las inscripciones." },
        { status: 500 },
      );
    }

    const filas = (data ?? []) as { polla_id: string }[];
    for (const fila of filas) vistos[fila.polla_id] = true;
    if (filas.length < PAGINA) break;
  }

  return NextResponse.json({
    usuarios: usuarios.count ?? 0,
    pollasCreadas: pollas.count ?? 0,
    pollasConInscritos: Object.keys(vistos).length,
  });
}

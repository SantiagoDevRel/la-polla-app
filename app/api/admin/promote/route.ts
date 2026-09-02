// app/api/admin/promote/route.ts — dar y quitar el acceso de administrador.
//
// Es escalada de privilegios, asi que se trata como tal: quien llama tiene que
// ser admin (columna `users.is_admin`, nunca el telefono), la validacion pasa
// ANTES de tocar la base, y las dos guardas que impiden dejar la aplicacion
// sin nadie adentro se aplican aca en el servidor. El boton que no se dibuja
// en la pantalla no es una defensa: cualquiera puede hacer el POST a mano.
//
// Guardas:
//   1. Nadie puede quitarse el acceso a si mismo (te quedas afuera del panel
//      con un clic y sin manera de volver).
//   2. No se puede quitar el ULTIMO administrador. Si se queda en cero, la
//      unica forma de recuperar el acceso es correr SQL contra produccion.
//
// Nunca se devuelve el telefono: este repositorio es publico y el numero es
// dato personal. Solo van id y nombre.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { redactId } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  userId: z.string().uuid(),
  isAdmin: z.boolean(),
});

/**
 * GET — los administradores actuales y, con `?q=`, la busqueda por nombre
 * para encontrar a quien se quiere promover.
 */
export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user?.is_admin) {
    return NextResponse.json({ error: "Solo el administrador." }, { status: 403 });
  }

  const db = createAdminClient();

  const { data: admins } = await db
    .from("users")
    .select("id, display_name")
    .eq("is_admin", true)
    .order("display_name", { ascending: true });

  const crudo = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 60);
  // Se limpian los caracteres que tienen significado en el filtro de PostgREST
  // (`%` y `_` son comodines de LIKE; la coma y los parentesis separan
  // condiciones). Sin esto una busqueda con coma arma un filtro invalido.
  const termino = crudo.replace(/[%_,()*]/g, "");

  let resultados: { id: string; display_name: string; is_admin: boolean }[] = [];
  if (termino.length >= 2) {
    const { data } = await db
      .from("users")
      .select("id, display_name, is_admin")
      .ilike("display_name", `%${termino}%`)
      .order("display_name", { ascending: true })
      .limit(10);
    resultados = (data ?? []) as typeof resultados;
  }

  return NextResponse.json({
    // El cliente lo necesita para no dibujar el boton de "quitar" sobre uno
    // mismo. La guarda de verdad es la del POST, esta es solo la pantalla.
    yoId: user.id,
    admins: admins ?? [],
    resultados,
  });
}

/** POST — { userId, isAdmin }. Da o quita el acceso. */
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user?.is_admin) {
    return NextResponse.json({ error: "Solo el administrador." }, { status: 403 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const { userId, isAdmin } = parsed.data;

  const db = createAdminClient();

  const { data: objetivo } = await db
    .from("users")
    .select("id, display_name, is_admin")
    .eq("id", userId)
    .maybeSingle();

  if (!objetivo) {
    return NextResponse.json({ error: "Ese usuario no existe." }, { status: 404 });
  }

  // Ya estaba como lo piden: no hay nada que escribir.
  if (objetivo.is_admin === isAdmin) {
    return NextResponse.json({ ok: true, sinCambios: true, usuario: objetivo });
  }

  if (!isAdmin) {
    if (userId === user.id) {
      return NextResponse.json(
        { error: "No puedes quitarte el acceso a ti mismo." },
        { status: 400 },
      );
    }

    const { count } = await db
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("is_admin", true);

    // La ventana de carrera (dos administradores quitandose el acceso en el
    // mismo instante) existe, pero requiere dos personas presionando a la vez
    // y el costo de cerrarla es un lock en base. Queda documentada, no tapada.
    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: "No puedes quitar el último administrador." },
        { status: 400 },
      );
    }
  }

  const { data: actualizado, error } = await db
    .from("users")
    .update({ is_admin: isAdmin })
    .eq("id", userId)
    .select("id, display_name, is_admin")
    .maybeSingle();

  if (error) {
    // 42501 = el trigger `users_block_privileged_update` de la migración 059.
    // Su salida temprana reconoce al service_role de dos maneras y las dos son
    // sospechosas hoy: `current_setting('request.jwt.claim.role')` quedó vacío
    // desde PostgREST 9 (los claims viven en el JSON `request.jwt.claims`), y
    // `session_user` es `authenticator`, que no está en la lista blanca de la
    // función. No se pudo comprobar contra producción, así que el caso se
    // maneja acá con un mensaje que dice exactamente qué pasó. La corrección
    // va en una migración nueva, no en este archivo: mientras tanto el cambio
    // se hace con SQL.
    if (error.code === "42501") {
      return NextResponse.json(
        {
          error:
            "La base de datos rechazó el cambio: la guarda de la migración 059 " +
            "no reconoce al service_role. Hay que corregirla en una migración " +
            "antes de que este botón funcione.",
          codigo: "42501",
        },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: "No se pudo guardar el cambio." },
      { status: 500 },
    );
  }

  // Queda rastro de quién movió el privilegio, sin identificadores completos
  // ni teléfonos: los logs de Vercel los ve cualquiera del equipo.
  console.log(
    `[admin/promote] ${redactId(user.id)} ${isAdmin ? "dio" : "quitó"} admin a ${redactId(userId)}`,
  );

  return NextResponse.json({ ok: true, usuario: actualizado });
}

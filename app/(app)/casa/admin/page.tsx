// app/(app)/casa/admin/page.tsx — ruta retirada, redirige al panel.
//
// (2026-09-03) El panel de la casa se mudó a /admin/pollas. El dueño pidió
// que nada de administración aparezca en la navegación del jugador, así que
// todo lo de admin quedó colgando de /admin.
//
// Este archivo NO se borra y la ruta NO se retira del middleware: el link
// puede estar guardado en el teléfono de alguien, y un 404 ahí se lee como
// "se rompió la app". Redirigir cuesta un archivo de diez líneas.
//
// Ojo con el gate: `/casa/admin` sigue siendo una ruta privada. El patrón de
// `isCasaPollaPublica` en lib/supabase/middleware.ts la excluye a propósito
// (`!path.startsWith("/casa/admin")`), así que quien no tenga sesión cae en
// /login antes de llegar hasta acá.

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function CasaAdminRedirect() {
  redirect("/admin/pollas");
}

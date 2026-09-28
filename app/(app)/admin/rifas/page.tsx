// /admin/rifas — creadores de rifas, rifas de terceros y embudo (migración 157).
//
// El layout de /admin ya exige administrador; se repite acá como en las demás
// rutas del panel. Con RIFAS_ENABLED apagado la página no existe.
import { notFound, redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth/admin";
import { rifasEnabled } from "@/lib/rifas/server";
import { RifasAdmin } from "@/components/admin/RifasAdmin";

export const dynamic = "force-dynamic";

export default async function AdminRifasPage() {
  if (!rifasEnabled()) notFound();
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login?returnTo=/admin/rifas");
  if (!user.is_admin) redirect("/inicio");
  return <RifasAdmin />;
}

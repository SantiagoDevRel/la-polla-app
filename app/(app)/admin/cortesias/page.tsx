// /admin/cortesias — dar cupos de cortesía a una persona para una polla.
//
// El layout de /admin ya exige administrador; se repite acá para que la ruta no
// dependa solo del layout (mismo criterio que /admin/usuarios/[id]).

import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth/admin";
import { listAllPollas } from "@/lib/casa/queries";
import { isPollaOpen } from "@/lib/casa/types";
import { CortesiasAdmin, type CortesiaPolla } from "@/components/admin/CortesiasAdmin";

export const dynamic = "force-dynamic";

export default async function AdminCortesiasPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login?returnTo=/admin/cortesias");
  if (!user.is_admin) redirect("/inicio");

  // Las mismas condiciones que exige casa_grant_courtesies_v1: publicada, con
  // inscripciones abiertas, con entrada en dinero y sin boletas numeradas.
  const pollas: CortesiaPolla[] = (await listAllPollas())
    .filter((polla) => isPollaOpen(polla) && polla.kind !== "rifa" && polla.entry_price_cop > 0)
    .map((polla) => ({
      id: polla.id,
      name: polla.name,
      entry_price_cop: polla.entry_price_cop,
      closes_at: polla.closes_at,
    }));

  return <CortesiasAdmin pollas={pollas} />;
}

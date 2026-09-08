// /admin/pollas administra las pollas existentes. La creación tiene su propia
// pantalla en /admin/pollas/crear; /casa/admin sigue redirigiendo aquí.

import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth/admin";
import { getPots, listAllPollas } from "@/lib/casa/queries";
import { pollaStatusLabel } from "@/lib/casa/types";
import { CasaAdminPanel } from "@/components/casa/CasaAdminPanel";

export const dynamic = "force-dynamic";

export default async function CasaAdminPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login?returnTo=/admin/pollas");
  if (!user.is_admin) redirect("/casa");

  const pollas = await listAllPollas();
  const pots = await getPots(pollas.map((polla) => polla.id));
  const totalCasa = pollas.reduce((total, polla) => total + (pots[polla.id]?.house_cop ?? 0), 0);

  return (
    <CasaAdminPanel
      pollas={pollas.map((polla) => ({
        id: polla.id,
        slug: polla.slug,
        name: polla.name,
        status: polla.status,
        closes_at: polla.closes_at,
        label: pollaStatusLabel(polla),
      }))}
      pots={pots}
      totalCasa={totalCasa}
    />
  );
}

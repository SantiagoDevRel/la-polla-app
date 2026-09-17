// /admin/pollas administra las pollas existentes. La creación tiene su propia
// pantalla en /admin/pollas/crear; /casa/admin sigue redirigiendo aquí.

import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth/admin";
import { getPots, getHouseTotal, listAllPollas } from "@/lib/casa/queries";
import { pollaStatusLabel } from "@/lib/casa/types";
import { canEditPolla } from "@/lib/casa/editor";
import { countOpenMatchIssues } from "@/lib/casa/match-issues";
import { CasaAdminPanel } from "@/components/casa/CasaAdminPanel";

export const dynamic = "force-dynamic";

export default async function CasaAdminPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login?returnTo=/admin/pollas");
  if (!user.is_admin) redirect("/casa");

  const pollas = await listAllPollas();
  const pots = await getPots(pollas.map((polla) => polla.id));
  const totalCasa = await getHouseTotal(pollas.map((polla) => polla.id));
  // Partidos suspendidos/aplazados/cancelados/abandonados sin decidir.
  const openIssues = await countOpenMatchIssues();

  return (
    <CasaAdminPanel
      pollas={pollas.map((polla) => ({
        id: polla.id,
        slug: polla.slug,
        name: polla.name,
        // `kind` decide si el panel muestra los controles para resolver
        // preguntas (manual) o registrar el número sorteado (rifa).
        kind: polla.kind,
        prize_kind: polla.prize_kind,
        prize_object: polla.prize_object,
        draw_pending: polla.draw_pending,
        // Con premio en dinero adjudicado, el panel muestra el pago a ganadores.
        settlement_outcome: polla.settlement_outcome ?? null,
        status: polla.status,
        closes_at: polla.closes_at,
        opens_at: polla.opens_at,
        publication_mode: polla.publication_mode,
        label: pollaStatusLabel(polla),
        // Tuerca de edición hasta el cierre; SQL (migración 122) decide al guardar.
        editable: canEditPolla(polla),
      }))}
      pots={pots}
      totalCasa={totalCasa}
      openIssues={openIssues}
    />
  );
}

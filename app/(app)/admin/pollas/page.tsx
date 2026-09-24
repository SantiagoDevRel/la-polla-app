// /admin/pollas administra las pollas existentes. La creación tiene su propia
// pantalla en /admin/pollas/crear; /casa/admin sigue redirigiendo aquí.

import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth/admin";
import { getPots, getHouseTotal, getSettlementReadiness, listAllPollas } from "@/lib/casa/queries";
import { pollaStatusLabel } from "@/lib/casa/types";
import { canEditPolla } from "@/lib/casa/editor";
import { countOpenMatchIssues } from "@/lib/casa/match-issues";
import { CasaAdminPanel } from "@/components/casa/CasaAdminPanel";

export const dynamic = "force-dynamic";

export default async function CasaAdminPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login?returnTo=/admin/pollas");
  if (!user.is_admin) redirect("/inicio");

  const pollas = await listAllPollas(user);
  const pots = await getPots(pollas.map((polla) => polla.id));
  const totalCasa = await getHouseTotal(pollas.map((polla) => polla.id));
  // Partidos suspendidos/aplazados/cancelados/abandonados sin decidir.
  const openIssues = await countOpenMatchIssues();
  // (2026-09-17) Pollas de pozo en juego: cuáles ya se pueden repartir (SQL, migración 134).
  // Si la lectura falla, el panel sigue igual sin el aviso.
  const readiness = await getSettlementReadiness(
    pollas.filter((polla) => polla.status === "abierta" || polla.status === "cerrada").map((polla) => polla.id),
  ).catch(() => ({}));

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
        // Invitaciones (migración 135): la lista de cupos de regalo solo donde aplica.
        entry_price_cop: polla.entry_price_cop,
        referral_every: polla.referral_every ?? null,
        draw_pending: polla.draw_pending,
        private_draft: polla.private_draft,
        // Con premio en dinero adjudicado, el panel muestra el pago a ganadores.
        settlement_outcome: polla.settlement_outcome ?? null,
        status: polla.status,
        closes_at: polla.closes_at,
        opens_at: polla.opens_at,
        publication_mode: polla.publication_mode,
        label: pollaStatusLabel(polla),
        // Tuerca de edición hasta el cierre; SQL (migración 122) decide al guardar.
        editable: !polla.private_draft && canEditPolla(polla),
      }))}
      pots={pots}
      totalCasa={totalCasa}
      openIssues={openIssues}
      readiness={readiness}
    />
  );
}

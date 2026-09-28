// components/rifas/RifasTab.tsx — pestaña RIFAS de /inicio (lado comprador).
//
// Muestra las rifas donde compré (también ventas por fuera a mi celular), las
// que creé y las que abrí por enlace. Decisión por defecto (docs/rifas.md):
// NO hay vitrina de rifas de terceros; solo con rifa_settings.listing_mode =
// 'publico' aparece «Rifas abiertas». Los datos vienen de rifa_my_list_v1.
import Link from "next/link";
import { ChevronRight, Ticket } from "lucide-react";
import { PollaSection } from "@/components/casa/PollaSection";
import { formatCop } from "@/lib/casa/format";
import { drawLabel, rifaNumber, type RifaMyList } from "@/lib/rifas/shared";

function Row({ href, name, detail, badge }: { href: string; name: string; detail: string; badge?: string }) {
  return (
    <li>
      <Link href={href} className="lp-card flex min-h-16 items-center gap-3 p-4">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-text-primary">{name}</span>
          <span className="block text-[13px] text-text-secondary [overflow-wrap:anywhere]">{detail}</span>
        </span>
        {badge && <span className="shrink-0 rounded-full bg-red-alert px-2 py-0.5 text-[13px] font-semibold text-text-primary">{badge}</span>}
        <ChevronRight aria-hidden="true" className="h-5 w-5 shrink-0 text-text-muted" />
      </Link>
    </li>
  );
}

function numbersLabel(numbers: RifaMyList["bought"][number]["numbers"]): string {
  const paid = numbers.filter((n) => n.state === "pagado").map((n) => rifaNumber(n.number));
  const pending = numbers.filter((n) => n.state !== "pagado").map((n) => rifaNumber(n.number));
  return [paid.length ? `Pagados ${paid.join(", ")}` : "", pending.length ? `Por confirmar ${pending.join(", ")}` : ""].filter(Boolean).join(" · ");
}

export function RifasTab({ data }: { data: RifaMyList }) {
  const empty = !data.bought.length && !data.created.length && !data.visited.length && !data.listed.length;
  if (empty) {
    return (
      <div className="px-4">
        <div className="lp-card flex flex-col items-center gap-3 p-6 text-center">
          <Ticket aria-hidden="true" className="h-8 w-8 text-text-muted" />
          <h2 className="lp-display-sm text-[22px]">Aún no tienes rifas</h2>
          <p className="text-[15px] text-text-secondary">Cuando abras el enlace de una rifa, aparece aquí.</p>
          {data.can_create
            ? <Link href="/rifas/crear" className="lp-btn lp-btn-primary w-full">Crear mi rifa</Link>
            : <Link href="/inicio" className="lp-btn lp-btn-ghost w-full">Ver pollas</Link>}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-6 px-4">
      {data.bought.length > 0 && (
        <PollaSection id="rifas-mias" title="Mis números" count={data.bought.length} kind="mine" flat>
          <ul className="space-y-2">
            {data.bought.map((r) => (
              <Row key={r.slug} href={`/rifa/${r.slug}`} name={r.name}
                detail={r.status === "abierta" ? `${drawLabel(r.draw_at)} · ${numbersLabel(r.numbers)}`
                  : `Salió el ${rifaNumber(r.winning_number ?? 0)} · ${numbersLabel(r.numbers)}`} />
            ))}
          </ul>
        </PollaSection>
      )}
      {data.created.length > 0 && (
        <PollaSection id="rifas-creadas" title="Creadas por ti" count={data.created.length} kind="mine" flat>
          <ul className="space-y-2">
            {data.created.map((r) => (
              <Row key={r.slug} href={`/rifa/${r.slug}/gestionar`} name={r.name}
                badge={r.pending_proofs > 0 ? String(r.pending_proofs) : undefined}
                detail={`${r.paid}/${r.number_count} pagados · ${r.visibility === "privada" ? "Privada" : "Pública"}`} />
            ))}
          </ul>
        </PollaSection>
      )}
      {data.visited.length > 0 && (
        <PollaSection id="rifas-enlace" title="Abiertas por enlace" count={data.visited.length} kind="open" flat>
          <ul className="space-y-2">
            {data.visited.map((r) => (
              <Row key={r.slug} href={`/rifa/${r.slug}`} name={r.name} detail={`${drawLabel(r.draw_at)} · ${formatCop(r.price_cop)} cada número`} />
            ))}
          </ul>
        </PollaSection>
      )}
      {data.listed.length > 0 && (
        <PollaSection id="rifas-abiertas" title="Rifas abiertas" count={data.listed.length} kind="open" flat>
          <ul className="space-y-2">
            {data.listed.map((r) => (
              <Row key={r.slug} href={`/rifa/${r.slug}`} name={r.name} detail={`${drawLabel(r.draw_at)} · ${formatCop(r.price_cop)} cada número`} />
            ))}
          </ul>
        </PollaSection>
      )}
    </div>
  );
}

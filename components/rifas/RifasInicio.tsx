// components/rifas/RifasInicio.tsx — las rifas dentro del inicio, sin pestaña aparte.
//
// (2026-11-06, pedido del dueño) Se quitaron las pestañas POLLAS | RIFAS: todo
// va en una sola pantalla y cada tarjeta lleva una etiqueta chiquita «RIFA» o
// «POLLA». Arriba de todo, las rifas sin ánimo de lucro (lib/rifas/benefit.ts)
// con el mismo molde de tarjeta de las pollas (PollaCard.tsx). Debajo, en filas,
// las demás rifas de la persona: donde compró, las que creó y las que abrió por
// enlace. Datos: rifa_public_view_v1 (destacadas) y rifa_my_list_v1 (las suyas).
import Link from "next/link";
import { ArrowRight, ChevronRight } from "lucide-react";
import { StreetCard } from "@/components/street";
import { PrizeMotion } from "@/components/casa/PrizeShowcase";
import { CardTypeTag, PollaCardBody } from "@/components/casa/PollaCard";
import { PollaSection } from "@/components/casa/PollaSection";
import { formatCop, timeLeft } from "@/lib/casa/format";
import { rifaBenefit } from "@/lib/rifas/benefit";
import { drawLabel, rifaNumber, type RifaMyList, type RifaPublicView } from "@/lib/rifas/shared";

type RifaRow = { slug: string; href: string; name: string; detail: string; badge?: string };

function numbersLabel(numbers: Array<{ number: number; state: string }>): string {
  // Con el comprobante enviado el número ya es pagado (2026-11-06): no se muestra «reservado».
  const paid = numbers.filter((n) => n.state !== "reservado").map((n) => rifaNumber(n.number));
  const pending = numbers.filter((n) => n.state === "reservado").map((n) => rifaNumber(n.number));
  return [paid.length ? `Pagados ${paid.join(", ")}` : "", pending.length ? `Falta el comprobante ${pending.join(", ")}` : ""].filter(Boolean).join(" · ");
}

/** Las rifas de la persona que no están destacadas, una fila por rifa (la compra manda sobre la visita). */
function myRows(mine: RifaMyList | null, skip: ReadonlySet<string>): RifaRow[] {
  if (!mine) return [];
  const rows = new Map<string, RifaRow>();
  const add = (row: RifaRow) => { if (!skip.has(row.slug) && !rows.has(row.slug)) rows.set(row.slug, row); };
  for (const r of mine.created) add({ slug: r.slug, href: `/rifa/${r.slug}/gestionar`, name: r.name,
    badge: r.pending_proofs > 0 ? String(r.pending_proofs) : undefined,
    detail: `Creada por ti · ${r.paid}/${r.number_count} pagados · ${r.visibility === "privada" ? "Privada" : "Pública"}` });
  for (const r of mine.bought) add({ slug: r.slug, href: `/rifa/${r.slug}`, name: r.name,
    detail: r.status === "abierta" ? `${drawLabel(r.draw_at)} · ${numbersLabel(r.numbers)}`
      : `Salió el ${rifaNumber(r.winning_number ?? 0)} · ${numbersLabel(r.numbers)}` });
  for (const r of [...mine.visited, ...mine.listed]) add({ slug: r.slug, href: `/rifa/${r.slug}`, name: r.name,
    detail: `${drawLabel(r.draw_at)} · ${formatCop(r.price_cop)} cada número` });
  return [...rows.values()];
}

function FeaturedRifa({ rifa, pendingProofs }: { rifa: RifaPublicView; pendingProofs: number }) {
  const benefit = rifaBenefit(rifa.id);
  const href = `/rifa/${rifa.slug}`;
  const taken = rifa.counts.pagado + rifa.counts.reservado;
  const tickets = rifa.viewer.tickets;
  return (
    <li className="relative min-w-0">
      <StreetCard className="relative bg-bg-elevated p-4 transition-colors hover:border-border-strong">
        {/* Toda la tarjeta abre la rifa; la camiseta queda por encima para poder girarla. */}
        <Link href={href} aria-label={`Elegir número en ${rifa.name}`}
          className="absolute inset-0 z-10 cursor-pointer rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold" />
        <PollaCardBody
          tag="rifa"
          name={rifa.name}
          tournaments={[]}
          kind="rifa"
          identity={benefit
            ? (
              <span className="min-w-0 text-[13px] leading-snug [overflow-wrap:anywhere]">
                <span className="block font-semibold text-turf">Sin ánimo de lucro</span>
                <span className="block text-text-secondary">Para {benefit.cause}</span>
              </span>
            )
            : undefined}
          prizeVisual={benefit?.jersey
            ? <PrizeMotion media={benefit.jersey.media} label={benefit.jersey.label} interactive className="relative z-20 h-16 w-14 shrink-0" />
            : undefined}
          topRight={pendingProofs > 0 && (
            <span className="shrink-0 rounded-full bg-red-alert px-2 py-0.5 text-[13px] font-semibold text-text-primary" aria-label={`${pendingProofs} pagos por confirmar`}>
              {pendingProofs}
            </span>
          )}
          premioLabel="Premio"
          premio={rifa.prize_kind === "dinero" ? formatCop(rifa.prize_cop ?? 0) : rifa.prize_text}
          objeto={rifa.prize_kind === "texto"}
          dato={{ label: "Cierra en", value: timeLeft(rifa.draw_at), tone: "gold" }}
        />
        <p className="mt-3 text-[13px] text-text-secondary [overflow-wrap:anywhere]">
          {tickets.length > 0 ? `Tus números: ${numbersLabel(tickets)}` : `${taken} de ${rifa.number_count} números tomados`}
        </p>
        <span aria-hidden="true" className="lp-btn lp-btn-ghost mt-3 w-full gap-2 !border-turf/50 !px-4 text-text-primary">
          {`Elegir número · ${formatCop(rifa.price_cop)}`}
          <ArrowRight className="h-4 w-4 max-w-none shrink-0 text-turf" />
        </span>
      </StreetCard>
    </li>
  );
}

export function RifasInicio({ featured, mine }: { featured: RifaPublicView[]; mine: RifaMyList | null }) {
  const pending = new Map((mine?.created ?? []).map((r) => [r.slug, r.pending_proofs]));
  const rows = myRows(mine, new Set(featured.map((r) => r.slug)));
  if (featured.length === 0 && rows.length === 0) return null;
  return (
    <PollaSection id="rifas" kind="open" flat title="Rifas" description="Rifas abiertas y tus rifas" count={featured.length + rows.length}>
      {featured.length > 0 && (
        <ul className="grid gap-3">
          {featured.map((r) => <FeaturedRifa key={r.id} rifa={r} pendingProofs={pending.get(r.slug) ?? 0} />)}
        </ul>
      )}
      {rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.slug}>
              <Link href={r.href} className="lp-card flex min-h-16 items-center gap-3 p-4">
                <CardTypeTag tag="rifa" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-text-primary">{r.name}</span>
                  <span className="block text-[13px] text-text-secondary [overflow-wrap:anywhere]">{r.detail}</span>
                </span>
                {r.badge && <span className="shrink-0 rounded-full bg-red-alert px-2 py-0.5 text-[13px] font-semibold text-text-primary">{r.badge}</span>}
                <ChevronRight aria-hidden="true" className="h-5 w-5 shrink-0 text-text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PollaSection>
  );
}

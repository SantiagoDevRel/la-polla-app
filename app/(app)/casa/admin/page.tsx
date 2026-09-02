// app/(app)/casa/admin/page.tsx — el panel web de Tama.
//
// Convive con el bot de Telegram, no compite: acá se CREAN las pollas (que
// pide pantalla grande y muchos campos) y por Telegram se APRUEBAN los pagos
// (que pasa en la calle, con una mano, en 2 segundos).

import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth/admin";
import { getPots, listAllPollas, listPendingProofs } from "@/lib/casa/queries";
import { pollaStatusLabel } from "@/lib/casa/types";
import { formatCop, timeLeft } from "@/lib/casa/format";
import { HeroFrame, Label, SectionHead, Tape } from "@/components/street";
import { CrearPollaForm } from "@/components/casa/CrearPollaForm";
import { ColaDePagos } from "@/components/casa/ColaDePagos";
import { AccionesPolla } from "@/components/casa/AccionesPolla";

export const dynamic = "force-dynamic";

export default async function CasaAdminPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login?returnTo=/casa/admin");
  if (!user.is_admin) redirect("/casa");

  const [pollas, pendientes] = await Promise.all([
    listAllPollas(),
    listPendingProofs(50),
  ]);
  const pots = await getPots(pollas.map((p) => p.id));

  const totalCasa = pollas.reduce((s, p) => s + (pots[p.id]?.house_cop ?? 0), 0);

  return (
    <div className="pb-28">
      <HeroFrame height="h-[186px]">
        <Label>Panel</Label>
        <h1 className="lp-display mt-1 text-[38px]">La casa</h1>
        <div className="mt-3 flex gap-6">
          <div>
            <Label>Acumulado casa</Label>
            <div className="lp-money text-[22px] leading-none text-gold">
              {formatCop(totalCasa)}
            </div>
          </div>
          <div>
            <Label>Pagos por revisar</Label>
            <div className="lp-money text-[22px] leading-none text-text-primary">
              {pendientes.length}
            </div>
          </div>
        </div>
      </HeroFrame>

      <div className="px-4 pt-5">
        {/* La cola de pagos, aca mismo. Antes esto solo decia "aprobalos desde
            Telegram" — util si el bot anda, inutil si se cayo o si el chat
            nunca se vinculo, y en ese caso la gente quedaba esperando sin que
            nadie pudiera hacer nada desde la web. */}
        <SectionHead
          title="Pagos por revisar"
          meta={pendientes.length > 0 ? `${pendientes.length}` : undefined}
        />
        <div className="mb-9">
          <ColaDePagos />
          <p className="mt-2 text-[11px] text-text-muted">
            También llegan al bot de Telegram cuando alguien sube el
            comprobante. Puedes resolverlo por cualquiera de las dos vías.
          </p>
        </div>

        {/* ── Las pollas que ya existen ────────────────────────────────── */}
        {pollas.length > 0 && (
          <>
            <SectionHead title="Tus pollas" meta={`${pollas.length}`} />
            <ul className="mb-9 space-y-px">
              {pollas.slice(0, 12).map((p) => {
                const estado = pollaStatusLabel(p);
                const pot = pots[p.id];
                // Un borrador NO es navegable: /casa/[slug] hace notFound
                // mientras el status sea 'borrador', asi que enlazarlo era
                // mandar al admin a un 404. Se pinta como bloque muerto y
                // debajo va el boton que lo publica.
                const esBorrador = p.status === "borrador";
                const contenido = (
                  <>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] text-text-primary">
                          {p.name}
                        </span>
                        <span className="lp-label mt-0.5 block">
                          {pot?.paid_entries ?? 0} inscritos ·{" "}
                          {p.status === "abierta"
                            ? `cierra en ${timeLeft(p.closes_at)}`
                            : estado.text}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="lp-money block text-[16px] text-text-primary">
                          {formatCop(pot?.prize_cop ?? 0)}
                        </span>
                        <Tape tone={estado.tone} className="mt-1">
                          {estado.text}
                        </Tape>
                      </span>
                  </>
                );
                return (
                  <li key={p.id}>
                    {esBorrador ? (
                      <div className="flex items-center gap-3 bg-bg-card p-3">
                        {contenido}
                      </div>
                    ) : (
                      <Link
                        href={`/casa/${p.slug}`}
                        className="flex items-center gap-3 bg-bg-card p-3"
                      >
                        {contenido}
                      </Link>
                    )}
                    {/* El ciclo completo — publicar, cerrar, repartir —
                        vive acá desde que se sacaron los bots de la UI. */}
                    <AccionesPolla id={p.id} status={p.status} nombre={p.name} />
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {/* ── Crear ────────────────────────────────────────────────────── */}
        <SectionHead title="Crear una polla nueva" />
        <CrearPollaForm />
      </div>
    </div>
  );
}

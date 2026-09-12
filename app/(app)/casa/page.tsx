// app/(app)/casa/page.tsx — el inicio de la polla centralizada.
//
// Lo primero que ve un barrista: cuánta plata hay en juego ahora mismo, y qué
// pollas están abiertas este fin de semana. El pozo es el gancho, así que es
// lo más grande de la pantalla y lo único en el acento.

import Link from "next/link";
import { MyPollas } from "@/components/casa/MyPollas";
import { listMyPollas } from "@/lib/casa/my-pollas";
import Image from "next/image";
import { PollaSection } from "@/components/casa/PollaSection";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  listPublicPollas,
  getPots,
  listPollasConPicksPendientes,
} from "@/lib/casa/queries";
import { isPollaOpen, pollaStatusLabel, type CasaPolla } from "@/lib/casa/types";
import { formatCop, timeLeft } from "@/lib/casa/format";
import { getPollaTournamentSlugs } from "@/lib/casa/tournaments";
import { TournamentIdentity } from "@/components/casa/TournamentIdentity";
import {
  HeroFrame,
  Label,
  StreetCard,
  Tape,
} from "@/components/street";

export const dynamic = "force-dynamic";

export default async function CasaPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?returnTo=/casa");

  const [pollas, myPollas] = await Promise.all([listPublicPollas(), listMyPollas(user.id)]);
  const [pots, pendientes, tournaments] = await Promise.all([
    getPots(pollas.map((p) => p.id)),
    listPollasConPicksPendientes(user.id),
    getPollaTournamentSlugs(pollas),
  ]);

  // isPollaOpen() y no `status === "abierta"`: una polla cuyo closes_at ya
  // paso sigue con status abierta hasta que alguien la cierre, y quedaba
  // listada como "del fin de semana" diciendo "cierra en cerrada".
  const abiertas = pollas.filter((p) => isPollaOpen(p));
  const cerradas = pollas.filter((p) => !isPollaOpen(p));
  const joinedIds = new Set(myPollas.map(p => p.id));
  const disponibles = abiertas.filter(p => !joinedIds.has(p.id));

  // El número grande de arriba: todo lo que hay repartible ahora mismo.
  const enJuego = abiertas.reduce((sum, p) => sum + (pots[p.id]?.prize_cop ?? 0), 0);
  const jugando = abiertas.reduce((sum, p) => sum + (pots[p.id]?.paid_entries ?? 0), 0);

  return (
    <div className="pb-28">
      {/* ── Hero: la plata en juego ───────────────────────────────────── */}
      <HeroFrame height="h-[228px]">
        <Label>En juego ahora mismo</Label>
        <div className="lp-money mt-1 text-[54px] leading-[0.9] text-gold">
          {formatCop(enJuego)}
        </div>
        <p className="mt-2 text-[13px] text-text-secondary">
          {abiertas.length === 0
            ? "Todavía no hay pollas disponibles. Las próximas aparecerán aquí."
            : `${abiertas.length} polla${abiertas.length === 1 ? "" : "s"} abierta${
                abiertas.length === 1 ? "" : "s"
              } · ${jugando} inscritos`}
        </p>
      </HeroFrame>

      <div className="space-y-4 px-4 pt-6">
        <PollaSection id="pollas-abiertas" kind="open" title="Pollas abiertas" description="Elige una polla e inscríbete." count={disponibles.length}>
        {disponibles.length === 0 ? (
          // `bg-bg-card` pisa a proposito el 80% de opacidad de .lp-card: es la
          // unica card de la app que lleva ilustracion adentro, y sobre el video
          // del fondo (que tiene su propio pollito) el translucido superponia las
          // dos y no se leia ninguna.
          <StreetCard className="bg-bg-card p-6 text-center">
            {/* (2026-09-02) El pollito vuelve al estado vacio. No es adorno:
                el design system lo reserva para los momentos en que la
                pantalla no tiene nada que mostrar, que es justo cuando una
                caja de texto sola se siente como un error de la app. */}
            <Image
              src="/pollitos/Pollito_esperando-256.webp"
              alt=""
              aria-hidden="true"
              width={112}
              height={112}
              className="mx-auto mb-3 h-28 w-28 max-w-none object-contain opacity-90"
            />
            <p className="lp-display-sm text-text-primary">Sin pollas disponibles</p>
            <p className="mt-2 text-[13px] text-text-muted">
              Las nuevas pollas aparecerán aquí cuando se publiquen.
            </p>
          </StreetCard>
        ) : (
          <ul className="grid auto-rows-fr gap-3">
            {disponibles.map((polla) => (
              <PollaRow key={polla.id} polla={polla} pot={pots[polla.id]} tournaments={tournaments[polla.id] ?? []} />
            ))}
          </ul>
        )}
        </PollaSection>

        <MyPollas initialPollas={myPollas} defaultOpen={false} pendingByPolla={Object.fromEntries(pendientes.map(p => [p.polla.id, p.faltan]))} />

        <PollaSection id="pollas-cerradas" kind="closed" title="Pollas cerradas" description="Consulta los resultados de pollas anteriores." count={cerradas.length}>
            {cerradas.length > 0 ? (
              <ul className="grid auto-rows-fr gap-3">
                {cerradas.map((polla) => (
                  <PollaRow key={polla.id} polla={polla} pot={pots[polla.id]} tournaments={tournaments[polla.id] ?? []} />
                ))}
              </ul>
            ) : (
              <StreetCard className="p-5 text-center">
                <p className="lp-display-sm text-text-primary">Todavía no hay pollas cerradas</p>
                <p className="mt-2 text-[13px] text-text-muted">Cuando una polla cierre, podrás consultarla aquí.</p>
              </StreetCard>
            )}
        </PollaSection>
      </div>
    </div>
  );
}

function PollaRow({
  polla,
  pot,
  tournaments,
}: {
  polla: CasaPolla;
  pot?: { prize_cop: number; paid_entries: number };
  tournaments: string[];
}) {
  const estado = pollaStatusLabel(polla);
  const abierta = isPollaOpen(polla);

  return (
    <li>
      <Link href={`/casa/${polla.slug}`} className="block h-full">
        <StreetCard className="flex h-full flex-col bg-bg-elevated p-4 transition-colors hover:border-border-strong">
          {/* Equal-height list rows let names wrap without shifting the
              logos and amounts in neighboring cards. */}
          <div className="flex items-start justify-between gap-3">
            <h3 className="min-w-0 flex-1 font-display text-[22px] leading-[1.2] tracking-[0.04em] text-text-primary [overflow-wrap:anywhere]">
              {polla.name}
            </h3>
            <Tape tone={estado.tone} className="shrink-0">{estado.text}</Tape>
          </div>

          <div className="mt-auto min-h-8 pt-3">
            <TournamentIdentity tournaments={tournaments} kind={polla.kind} showNames={false} />
          </div>

          {/* Equal columns, label baselines and number sizes for both amounts. */}
          <div className="mt-4 grid grid-cols-2">
            <div className="min-w-0 border-r border-border-subtle">
              <Label>Pozo</Label>
              <div className="lp-money mt-1 text-[28px] leading-none text-text-primary [overflow-wrap:anywhere]">
                {formatCop(pot?.prize_cop ?? 0)}
              </div>
            </div>
            <div className="min-w-0 text-right">
              <Label>Entrada</Label>
              <div className="lp-money mt-1 text-[28px] leading-none text-text-primary [overflow-wrap:anywhere]">
                {formatCop(polla.entry_price_cop)}
              </div>
            </div>
          </div>

          {/* Fila 3 — el apuro y la gente. Hairline arriba para separar sin peso. */}
          <div className="mt-4 grid grid-cols-2 items-start gap-3 border-t border-border-subtle pt-3 text-[12px] leading-normal">
            <span className="min-w-0 text-text-muted">
              {pot?.paid_entries ?? 0} inscritos
            </span>
            <span
              className={`min-w-0 text-right ${abierta ? "text-gold" : "text-text-muted"}`}
            >
              {abierta ? `Cierra en ${timeLeft(polla.closes_at)}` : estado.text}
            </span>
          </div>
        </StreetCard>
      </Link>
    </li>
  );
}

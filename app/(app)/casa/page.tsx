// app/(app)/casa/page.tsx — el inicio de la polla centralizada.
//
// Lo primero que ve un barrista: cuánta plata hay en juego ahora mismo, y qué
// pollas están abiertas este fin de semana. El pozo es el gancho, así que es
// lo más grande de la pantalla y lo único en el acento.

import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listPublicPollas, getPots } from "@/lib/casa/queries";
import { isPollaOpen, pollaStatusLabel, type CasaPolla } from "@/lib/casa/types";
import { formatCop, timeLeft } from "@/lib/casa/format";
import { getTournamentLogo, getTournamentName } from "@/lib/tournaments";
import {
  HeroFrame,
  Label,
  SectionHead,
  StreetCard,
  Tape,
} from "@/components/street";

export const dynamic = "force-dynamic";

export default async function CasaPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?returnTo=/casa");

  const pollas = await listPublicPollas();
  const pots = await getPots(pollas.map((p) => p.id));

  // isPollaOpen() y no `status === "abierta"`: una polla cuyo closes_at ya
  // paso sigue con status abierta hasta que alguien la cierre, y quedaba
  // listada como "del fin de semana" diciendo "cierra en cerrada".
  const abiertas = pollas.filter((p) => isPollaOpen(p));
  const cerradas = pollas.filter((p) => !isPollaOpen(p));

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
            ? "Todavía no hay pollas abiertas. Se publican para el fin de semana."
            : `${abiertas.length} polla${abiertas.length === 1 ? "" : "s"} abierta${
                abiertas.length === 1 ? "" : "s"
              } · ${jugando} inscritos`}
        </p>
      </HeroFrame>

      <div className="px-4 pt-6">
        {/* ── Pollas abiertas ─────────────────────────────────────────── */}
        <SectionHead
          title="Del fin de semana"
          meta={abiertas.length > 0 ? `${abiertas.length}` : undefined}
        />

        {abiertas.length === 0 ? (
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
              src="/pollitos/Pollito_esperando.webp"
              alt=""
              aria-hidden="true"
              width={112}
              height={112}
              className="mx-auto mb-3 h-28 w-28 max-w-none object-contain opacity-90"
            />
            <p className="lp-display-sm text-text-primary">Sin pollas abiertas</p>
            <p className="mt-2 text-[13px] text-text-muted">
              La del fin de semana aparecerá aquí.
            </p>
          </StreetCard>
        ) : (
          <ul className="space-y-3">
            {abiertas.map((polla) => (
              <PollaRow key={polla.id} polla={polla} pot={pots[polla.id]} />
            ))}
          </ul>
        )}

        {/* ── Ya cerradas ─────────────────────────────────────────────── */}
        {cerradas.length > 0 && (
          <>
            <SectionHead title="Anteriores" className="mt-9" />
            <ul className="space-y-3 opacity-70">
              {cerradas.slice(0, 8).map((polla) => (
                <PollaRow key={polla.id} polla={polla} pot={pots[polla.id]} />
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function PollaRow({
  polla,
  pot,
}: {
  polla: CasaPolla;
  pot?: { prize_cop: number; paid_entries: number };
}) {
  const estado = pollaStatusLabel(polla);
  const abierta = isPollaOpen(polla);

  return (
    <li>
      <Link href={`/casa/${polla.slug}`} className="block">
        <StreetCard className="p-4 transition-colors hover:border-border-strong">
          {/* Fila 1 — identidad. El torneo va con su escudo; la etiqueta de
              estado a la derecha para que no compita con el nombre. */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              {polla.tournament && (
                <Image
                  src={getTournamentLogo(polla.tournament)}
                  alt=""
                  width={20}
                  height={20}
                  className="h-5 w-5 max-w-none shrink-0 object-contain"
                />
              )}
              <span className="lp-label truncate">
                {polla.kind === "rifa"
                  ? "Rifa"
                  : polla.tournament
                    ? getTournamentName(polla.tournament)
                    : "Manual"}
              </span>
            </div>
            <Tape tone={estado.tone}>{estado.text}</Tape>
          </div>

          <h3 className="lp-display-sm mt-2 text-text-primary">{polla.name}</h3>

          {/* Fila 2 — la plata manda. El pozo es lo único grande. */}
          <div className="mt-4 flex items-end justify-between gap-4">
            <div className="min-w-0">
              <Label>Pozo</Label>
              <div className="lp-money mt-0.5 text-[30px] leading-none text-text-primary">
                {formatCop(pot?.prize_cop ?? 0)}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <Label>Entrada</Label>
              <div className="lp-money mt-0.5 text-[18px] leading-none text-text-secondary">
                {formatCop(polla.entry_price_cop)}
              </div>
            </div>
          </div>

          {/* Fila 3 — el apuro y la gente. Hairline arriba para separar sin peso. */}
          <div className="mt-4 flex items-center justify-between border-t border-border-subtle pt-3">
            <span className="text-[12px] text-text-muted">
              {pot?.paid_entries ?? 0} inscritos
            </span>
            <span
              className={`lp-money text-[12px] ${abierta ? "text-gold" : "text-text-muted"}`}
            >
              {abierta ? `cierra en ${timeLeft(polla.closes_at)}` : estado.text}
            </span>
          </div>
        </StreetCard>
      </Link>
    </li>
  );
}

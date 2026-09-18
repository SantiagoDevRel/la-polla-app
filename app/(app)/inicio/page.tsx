// app/(app)/casa/page.tsx — el inicio de la polla centralizada.
//
// Lo primero que ve un barrista: cuánta plata hay en juego ahora mismo, y qué
// pollas están abiertas este fin de semana. El pozo es el gancho, así que es
// lo más grande de la pantalla y lo único en el acento.

import Link from "next/link";
import { MyPollas } from "@/components/casa/MyPollas";
import { LiveNow } from "@/components/casa/LiveNow";
import { listMyPollas } from "@/lib/casa/my-pollas";
import { listMyLiveMatches } from "@/lib/casa/live";
import Image from "next/image";
import { PollaSection } from "@/components/casa/PollaSection";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/auth/admin";
import { canEditPolla, editorHref } from "@/lib/casa/editor";
import { CheckCircle2, Settings } from "lucide-react";
import { cookies } from "next/headers";
import { QuienTeInvito } from "@/components/casa/QuienTeInvito";
import { PromoInvitados } from "@/components/casa/PromoInvitados";
import { getReferralInvitee, getReferralPollaView } from "@/lib/casa/referrals";
import {
  REFERRAL_COOKIE,
  REFERRAL_DISMISS_COOKIE,
  pickPromoPolla,
  referralPromo,
  validReferralCode,
} from "@/lib/casa/referrals-shared";
import {
  listPublicPollas,
  getPots,
  getPayoutProgress,
  listPollasConPicksPendientes,
} from "@/lib/casa/queries";
import { isPollaOpen, isPublicClosedPolla, pollaStatusLabel, type CasaPolla } from "@/lib/casa/types";
import { entryPriceLabel, formatCop, timeLeft } from "@/lib/casa/format";
import { premioLabel, premioValor } from "@/lib/casa/premio";
import { getPollaTournamentSlugs } from "@/lib/casa/tournaments";
import { TournamentIdentity } from "@/components/casa/TournamentIdentity";
import { ScoringModeBadge } from "@/components/casa/ScoringModeBadge";
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
  if (!user) redirect("/login?returnTo=/inicio");

  const cookieStore = await cookies();
  const referralHint = validReferralCode(cookieStore.get(REFERRAL_COOKIE)?.value);
  const [pollas, myPollas, isAdmin, enVivo, invitee] = await Promise.all([
    listPublicPollas(),
    listMyPollas(user.id),
    isCurrentUserAdmin(),
    // Partidos en juego de MIS pollas, con mi pronóstico. Si falla, la
    // pantalla sale sin la franja en vez de caerse.
    listMyLiveMatches(user.id).catch(() => []),
    // Invitaciones (migración 135): personas nuevas que todavía pueden decir quién las invitó.
    getReferralInvitee(user.id, referralHint),
  ]);
  const verInvitacion = Boolean(invitee?.can_set_referrer && !invitee.referrer
    && (invitee.hint || cookieStore.get(REFERRAL_DISMISS_COOKIE)?.value !== "1"));
  // isPollaOpen() y no `status === "abierta"`: una polla cuyo closes_at ya
  // paso sigue con status abierta hasta que alguien la cierre, y quedaba
  // listada como "del fin de semana" diciendo "cierra en cerrada".
  const abiertas = pollas.filter((p) => isPollaOpen(p));
  // Mis pollas solo lleva las que siguen en juego: una finalizada pasa sola a
  // Pollas cerradas (marcada "Participaste"), y una en juego no se repite abajo.
  const joinedIds = new Set(myPollas.map(p => p.id));
  const enJuegoMias = myPollas.filter(p => p.status !== "resuelta" && p.status !== "anulada");
  const enJuegoIds = new Set(enJuegoMias.map(p => p.id));
  // Cerradas: las públicas (desde el 16-sep) para todos; las anteriores, solo
  // para quien participó.
  const cerradas = pollas.filter((p) => !isPollaOpen(p) && !enJuegoIds.has(p.id)
    && (isPublicClosedPolla(p) || joinedIds.has(p.id)));
  // Aviso de invitaciones (2026-09-17): la polla abierta con invitaciones que cierra
  // primero, con desempate estable por id si dos cierran a la misma hora.
  const promoPolla = pickPromoPolla(abiertas);
  const [pots, pendientes, tournaments, pagos, promoView] = await Promise.all([
    getPots(pollas.map((p) => p.id)),
    listPollasConPicksPendientes(user.id),
    getPollaTournamentSlugs(pollas),
    // Prueba de pago (migración 133): qué pollas cerradas ya pagaron su premio.
    getPayoutProgress(cerradas.filter((p) => p.status === "resuelta").map((p) => p.id))
      .catch((): Record<string, { total: number; paid: number }> => ({})),
    promoPolla ? getReferralPollaView(user.id, promoPolla.id) : Promise.resolve(null),
  ]);
  const promo = promoPolla ? referralPromo(promoPolla, promoView, pots[promoPolla.id]?.prize_cop ?? 0) : null;
  const disponibles = abiertas.filter(p => !joinedIds.has(p.id));

  // Siempre queda al menos una sección abierta (2026-09-14/17): Mis pollas si
  // la persona tiene pollas en juego; disponibles si hay alguna o si no tiene
  // nada en juego. Cerradas empieza cerrada.
  const misPollasOpen = enJuegoMias.length > 0;
  const disponiblesOpen = disponibles.length > 0 || !misPollasOpen;

  // El número grande de arriba: todo lo que hay repartible ahora mismo.
  const enJuego = abiertas.reduce((sum, p) => sum + (pots[p.id]?.prize_cop ?? 0), 0);
  const jugando = abiertas.reduce((sum, p) => sum + (pots[p.id]?.paid_entries ?? 0), 0);

  return (
    <div className="pb-28">
      {/* ── En vivo (2026-09-16 · reordenado el 18-09) ─────────────────────
            Con partidos en juego en MIS pollas, esto va ANTES que el pozo:
            quien abre la app en el minuto 70 viene por el partido, no por la
            suma de pozos. Los días sin fútbol la franja no se dibuja y el
            hero vuelve a ser lo primero. */}
      {/* Se monta siempre (aunque hoy no haya nada): se refresca solo cada 30 s
          y aparece cuando un partido arranca, sin recargar la página. Vacío no
          dibuja nada, ni su espacio. */}
      <LiveNow initialRows={enVivo} />

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
        {/* Punto 3 del dueño (2026-09-17): quien entró sin el enlace también puede decir quién lo invitó. */}
        {verInvitacion && invitee && <QuienTeInvito initial={invitee} variant="casa" />}

        {/* El respaldo se suma por polla: la tarjeta ya no habla de cupos. */}
        <MyPollas initialPollas={enJuegoMias} activeOnly defaultOpen={misPollasOpen} pendingByPolla={pendientes.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.polla.id]: Math.max(acc[p.polla.id] ?? 0, p.faltan) }), {})} />

        <PollaSection id="pollas-disponibles" kind="open" title="Pollas disponibles" description="Elige una polla e inscríbete." count={disponibles.length} defaultOpen={disponiblesOpen}>
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
              <PollaRow key={polla.id} polla={polla} pot={pots[polla.id]} tournaments={tournaments[polla.id] ?? []} editable={isAdmin && canEditPolla(polla)} />
            ))}
          </ul>
        )}
        </PollaSection>

        <PollaSection id="pollas-cerradas" kind="closed" title="Pollas cerradas" description="Consulta los resultados de pollas anteriores." count={cerradas.length}>
            {cerradas.length > 0 ? (
              <ul className="grid auto-rows-fr gap-3">
                {cerradas.map((polla) => (
                  <PollaRow key={polla.id} polla={polla} pot={pots[polla.id]} tournaments={tournaments[polla.id] ?? []} editable={isAdmin && canEditPolla(polla)} payout={pagos[polla.id]} participated={joinedIds.has(polla.id)} closed />
                ))}
              </ul>
            ) : (
              <StreetCard className="bg-transparent p-5 text-center">
                <p className="lp-display-sm text-text-primary">Todavía no hay pollas cerradas</p>
                <p className="mt-2 text-[13px] text-text-muted">Cuando una polla cierre, podrás consultarla aquí.</p>
              </StreetCard>
            )}
        </PollaSection>
      </div>
      {promo && <PromoInvitados promo={promo} verPolla />}
    </div>
  );
}

function PollaRow({
  polla,
  pot,
  tournaments,
  editable = false,
  payout,
  participated = false,
  closed = false,
}: {
  polla: CasaPolla;
  pot?: { prize_cop: number; paid_entries: number };
  tournaments: string[];
  /** Solo administradores y solo hasta el cierre (2026-09-14). */
  editable?: boolean;
  /** Premios en dinero pagados con comprobante / totales (migración 133). */
  payout?: { total: number; paid: number };
  /** La persona tuvo inscripción en esta polla ya terminada. */
  participated?: boolean;
  /** Sección Pollas cerradas: tono gris translúcido. */
  closed?: boolean;
}) {
  const estado = pollaStatusLabel(polla);
  const abierta = isPollaOpen(polla);
  const amountTone = closed ? "text-text-secondary" : "text-text-primary";
  const premioPagado = Boolean(payout && payout.total > 0 && payout.paid === payout.total);

  return (
    <li className="relative">
      {/* La tuerca va fuera del enlace de la tarjeta: un enlace dentro de otro no es válido. */}
      {editable && (
        <Link
          href={editorHref(polla.id)}
          aria-label={`Editar ${polla.name}`}
          title="Editar polla"
          className="absolute right-3 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-border-default bg-bg-card text-text-secondary transition-colors duration-200 hover:border-border-strong hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold active:scale-95"
        >
          <Settings className="h-5 w-5" aria-hidden="true" />
        </Link>
      )}
      <Link href={`/polla/${polla.slug}`} className="block h-full">
        {/* Cerrada = gris translúcido y logos desaturados: se lee como polla
            terminada sin perder contraste de lectura. */}
        <StreetCard className={`flex h-full flex-col p-4 transition-colors hover:border-border-strong ${closed ? "bg-text-primary/[0.04] [&_img]:grayscale [&_img]:opacity-70" : "bg-bg-elevated"}`}>
          {/* Equal-height list rows let names wrap without shifting the
              logos and amounts in neighboring cards. */}
          <div className={`flex items-start justify-between gap-3 ${editable ? "pr-12" : ""}`}>
            <h3 className={`min-w-0 flex-1 font-display text-[22px] leading-[1.2] tracking-[0.04em] ${closed ? "text-text-secondary" : "text-text-primary"} [overflow-wrap:anywhere]`}>
              {polla.name}
            </h3>
            <Tape tone={estado.tone} className="shrink-0">{estado.text}</Tape>
          </div>

          {/* (2026-09-13) Qué hay que acertar, antes de entrar: "no me queda
              claro cuándo una polla es de 1X2 o de marcadores" (dueño). */}
          {polla.kind === "partidos" && (
            <div className="mt-2">
              <ScoringModeBadge mode={polla.scoring_mode} />
            </div>
          )}

          <div className="mt-auto min-h-8 pt-3">
            <TournamentIdentity tournaments={tournaments} kind={polla.kind} />
          </div>

          {/* Equal columns, label baselines and number sizes for both amounts. */}
          <div className="mt-4 grid grid-cols-2">
            <div className="min-w-0 border-r border-border-subtle">
              <Label>{premioLabel()}</Label>
              {/* Un premio en objeto muestra el objeto: «POZO $0» hacía ver una
                  polla que regala entradas como una que no reparte nada. */}
              <div className={`${polla.prize_kind === "objeto" ? "font-semibold" : "lp-money"} mt-1 text-[28px] leading-tight ${amountTone} [overflow-wrap:anywhere]`}>
                {premioValor({ ...polla, prize_cop: pot?.prize_cop ?? 0 }) ?? formatCop(pot?.prize_cop ?? 0)}
              </div>
            </div>
            <div className="min-w-0 text-right">
              <Label>Entrada</Label>
              {/* «$0» se lee como un precio; una polla gratis dice «Gratis». */}
              <div className={`lp-money mt-1 text-[28px] leading-none ${amountTone} [overflow-wrap:anywhere]`}>
                {entryPriceLabel(polla.entry_price_cop)}
              </div>
            </div>
          </div>

          {/* Fila 3 — el apuro y la gente. Hairline arriba para separar sin peso. */}
          <div className="mt-4 grid grid-cols-2 items-start gap-3 border-t border-border-subtle pt-3 text-[12px] leading-normal">
            <span className="min-w-0 text-text-muted">
              {pot?.paid_entries ?? 0} inscritos
              {participated && <span className="block font-semibold text-text-secondary">Participaste</span>}
            </span>
            <span
              className={`min-w-0 text-right ${abierta ? "text-gold" : "text-text-muted"}`}
            >
              {abierta ? `Cierra en ${timeLeft(polla.closes_at)}` : estado.text}
            </span>
          </div>
          {/* Prueba de pago (2026-09-16): la polla cerrada muestra que el premio
              ya se pagó; el comprobante se ve adentro, en el resultado. */}
          {payout && payout.total > 0 && (
            <p className={`mt-2 flex items-center gap-1.5 text-[12px] font-semibold ${premioPagado ? "text-turf" : "text-text-secondary"}`}>
              <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              {premioPagado
                ? `${payout.total === 1 ? "Premio pagado" : "Premios pagados"} · comprobante en la polla`
                : `Pago del premio en curso · ${payout.paid} de ${payout.total}`}
            </p>
          )}
        </StreetCard>
      </Link>
    </li>
  );
}

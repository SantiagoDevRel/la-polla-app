// app/(app)/casa/page.tsx — el inicio de la polla centralizada.
//
// Lo primero que ve un barrista: cuánta plata hay en juego ahora mismo, y qué
// pollas están abiertas este fin de semana. El pozo es el gancho, así que es
// lo más grande de la pantalla y lo único en el acento.

import Link from "next/link";
import { PollaHighlights } from "@/components/highlights/PollaHighlights";
import { MyPollas } from "@/components/casa/MyPollas";
import { LiveNow } from "@/components/casa/LiveNow";
import { listMyPollas } from "@/lib/casa/my-pollas";
import { listMyLiveMatches } from "@/lib/casa/live";
import Image from "next/image";
import { PollaSection } from "@/components/casa/PollaSection";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/auth/admin";
import { listPrivateCampaignPollas } from "@/lib/casa/private-draft-query";
import { SantaHatTitle } from "@/components/casa/CampaignDecorations";
import { CampaignPrizeMedia } from "@/components/casa/CampaignPrizeMedia";
import { canEditPolla, editorHref } from "@/lib/casa/editor";
import { ArrowRight, CheckCircle2, Settings } from "lucide-react";
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
import { getPollaTournamentSlugs, resolveTournamentSlugs } from "@/lib/casa/tournaments";
import { PollaCardBody } from "@/components/casa/PollaCard";
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
  const privatePollas = await listPrivateCampaignPollas({ id: user.id, is_admin: isAdmin });
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
    getPots([...pollas, ...privatePollas].map((p) => p.id)),
    listPollasConPicksPendientes(user.id),
    getPollaTournamentSlugs(pollas),
    // Prueba de pago (migración 133): qué pollas cerradas ya pagaron su premio.
    getPayoutProgress(cerradas.filter((p) => p.status === "resuelta").map((p) => p.id))
      .catch((): Record<string, { total: number; paid: number }> => ({})),
    promoPolla ? getReferralPollaView(user.id, promoPolla.id) : Promise.resolve(null),
  ]);
  const promo = promoPolla ? referralPromo(promoPolla, promoView, pots[promoPolla.id]?.prize_cop ?? 0) : null;
  const disponibles = abiertas.filter(p => !joinedIds.has(p.id));

  // (2026-09-18) Mis pollas y Para entrar ya no son desplegables: salen de una.
  // Solo Terminadas se pliega, porque es historial.

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
      {/* (2026-09-18) El hero baja de 228 a 136 px: la cifra sigue siendo el
          gancho, pero no se come medio pantallazo antes de la primera polla. */}
      <HeroFrame height="h-[136px]">
        <Label>En juego</Label>
        <div className="lp-money mt-1 text-[44px] leading-[0.9] text-gold">
          {formatCop(enJuego)}
        </div>
        {abiertas.length > 0 && (
          <p className="mt-2 text-[13px] text-text-secondary">
            {`${abiertas.length} polla${abiertas.length === 1 ? "" : "s"} abierta${
              abiertas.length === 1 ? "" : "s"
            } · ${jugando} inscritos`}
          </p>
        )}
      </HeroFrame>

      <div className="space-y-6 px-4 pt-5">
        {/* Punto 3 del dueño (2026-09-17): quien entró sin el enlace también puede decir quién lo invitó. */}
        {verInvitacion && invitee && <QuienTeInvito initial={invitee} variant="casa" />}

        {/* El respaldo se suma por polla: la tarjeta ya no habla de cupos. */}
        <MyPollas initialPollas={enJuegoMias} activeOnly flat pendingByPolla={pendientes.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.polla.id]: Math.max(acc[p.polla.id] ?? 0, p.faltan) }), {})} />

        {privatePollas.length > 0 && (
          <PollaSection id="pollas-privadas" kind="open" flat title="Borradores privados" count={privatePollas.length}>
            <ul className="grid gap-3">
              {privatePollas.map(polla => <PollaRow key={polla.id} polla={polla} pot={pots[polla.id]} tournaments={resolveTournamentSlugs(polla, [])} />)}
            </ul>
          </PollaSection>
        )}

        {/* Para entrar: sin desplegable. Si no hay ninguna y la persona ya juega
            en otra, la sección no se dibuja; el aviso de «pronto» es solo para
            quien llega y no tiene nada que hacer. */}
        {(disponibles.length > 0 || enJuegoMias.length === 0) && (
        <PollaSection id="pollas-disponibles" kind="open" flat title="Para entrar" description="Pollas abiertas en las que todavía no estás" count={disponibles.length}>
        {disponibles.length === 0 ? (
          // `bg-bg-card` pisa a proposito el 80% de opacidad de .lp-card: es la
          // unica card de la app que lleva ilustracion adentro, y sobre el video
          // del fondo (que tiene su propio pollito) el translucido superponia las
          // dos y no se leia ninguna.
          <StreetCard className="bg-bg-card p-6 text-center">
            <Image
              src="/pollitos/Pollito_esperando-256.webp"
              alt=""
              aria-hidden="true"
              width={112}
              height={112}
              className="mx-auto mb-3 h-28 w-28 max-w-none object-contain opacity-90"
            />
            <p className="lp-display-sm text-text-primary">Pronto hay pollas nuevas</p>
          </StreetCard>
        ) : (
          <ul className="grid gap-3">
            {disponibles.map((polla) => (
              <PollaRow key={polla.id} polla={polla} pot={pots[polla.id]} tournaments={tournaments[polla.id] ?? []} editable={isAdmin && canEditPolla(polla)} />
            ))}
          </ul>
        )}
        </PollaSection>
        )}

        <PollaHighlights className="py-2" />

        {cerradas.length > 0 && (
        <PollaSection id="pollas-cerradas" kind="closed" title="Terminadas" description="Pollas que ya no reciben inscripciones" count={cerradas.length}>
              <ul className="grid gap-3">
                {cerradas.map((polla) => (
                  <PollaRow key={polla.id} polla={polla} pot={pots[polla.id]} tournaments={tournaments[polla.id] ?? []} editable={isAdmin && canEditPolla(polla)} payout={pagos[polla.id]} participated={joinedIds.has(polla.id)} closed />
                ))}
              </ul>
        </PollaSection>
        )}
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
  const premioPagado = Boolean(payout && payout.total > 0 && payout.paid === payout.total);

  return (
    <li className="relative min-w-0">
      {/* min-w-0: el nombre va en una línea con «…»; sin esto la celda de la
          grilla crece hasta el nombre entero y la página se desborda. */}
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
      <Link href={`/polla/${polla.slug}`} className="block">
        {/* Cerrada = gris translúcido y logos desaturados: se lee como polla
            terminada sin perder contraste de lectura. */}
        <StreetCard className={`p-4 transition-colors hover:border-border-strong ${closed ? "bg-text-primary/[0.04] [&_img]:grayscale [&_img]:opacity-70" : "bg-bg-elevated"}`}>
          {/* (2026-09-19) Mismo molde que Mis pollas (PollaCard.tsx): todas las
              tarjetas de una lista miden lo mismo, escriba lo que escriba el
              administrador. Lo que cambia va en un lugar fijo, no en filas nuevas:
              - Abierta no lleva cinta (el botón «Entrar» lo dice mejor); las demás
                dicen en qué van: «En juego» o «Terminó 17 sep».
              - El premio ya pagado se marca en la etiqueta del premio; el
                comprobante se ve adentro, en el resultado.
              - A la derecha, siempre: el cierre si está abierta; si no, los inscritos. */}
          <PollaCardBody
            name={polla.name}
            nameDecoration={polla.private_draft ? <SantaHatTitle compact>{polla.name}</SantaHatTitle> : undefined}
            prizeVisual={polla.private_draft ? (
              <CampaignPrizeMedia id={polla.id} label={`Premio: ${polla.prize_object}`} animated={polla.private_draft_motion} />
            ) : undefined}
            tournaments={tournaments}
            kind={polla.kind}
            muted={closed}
            topRight={(!abierta || editable) && <>
              {!abierta && <Tape tone={estado.tone} className="shrink-0">{estado.text}</Tape>}
              {/* Hueco de la tuerca del administrador: solo corre el nombre, no la fila del premio. */}
              {editable && <span aria-hidden="true" className="w-10 shrink-0" />}
            </>}
            premioLabel={payout && payout.total > 0
              ? <span className={`flex items-center gap-1 ${premioPagado ? "text-turf" : ""}`}>
                  <CheckCircle2 aria-hidden="true" className="h-3 w-3 max-w-none shrink-0" />
                  {premioPagado ? "Pagado" : `Pagado ${payout.paid} de ${payout.total}`}
                </span>
              : premioLabel()}
            premio={premioValor({ ...polla, prize_cop: pot?.prize_cop ?? 0 })}
            objeto={polla.prize_kind === "objeto"}
            dato={abierta
              ? { label: "Cierra en", value: timeLeft(polla.closes_at), tone: "gold" }
              : { label: participated ? "Participaste" : undefined, value: `${pot?.paid_entries ?? 0} inscritos` }}
          />

          {/* La puerta, en la tarjeta: «disponible» se entiende porque hay un
              botón con el precio. Toda la tarjeta es el enlace, así que esto es
              un adorno con forma de botón y no un segundo enlace anidado. La
              línea de arriba dice qué hay que acertar (2026-09-13: "no me queda
              claro cuándo una polla es de 1X2 o de marcadores"). */}
          {(abierta || polla.private_draft) && (
            <>
              <div className="mt-3 flex min-h-8 items-center">
                <ScoringModeBadge mode={polla.scoring_mode} kind={polla.kind} />
              </div>
              <span aria-hidden="true" className="lp-btn lp-btn-ghost mt-3 w-full gap-2 !border-turf/50 !px-4 text-text-primary">
                {polla.private_draft ? "Ver polla" : "Entrar"} · {entryPriceLabel(polla.entry_price_cop)}
                <ArrowRight className="h-4 w-4 max-w-none shrink-0 text-turf" />
              </span>
            </>
          )}
        </StreetCard>
      </Link>
    </li>
  );
}

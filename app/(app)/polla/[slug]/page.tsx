// app/(app)/casa/[slug]/page.tsx — el detalle de una polla.
//
// Tres estados que la pantalla tiene que resolver bien:
//   1. No estás inscrito  → el CTA es pagar.
//   2. Pagaste, falta que Tama confirme → podés ir marcando, pero se avisa
//      claro que todavía no contás para el pozo.
//   3. Estás dentro → marcás y ves la tabla.

import Link from "next/link";
import Image from "next/image";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/auth/admin";
import {
  getDistribution,
  getLeaderboard,
  getMyEntry,
  getMyEntries,
  getMyPicks,
  getPollaBySlug,
  getPollaMatches,
  getPollaQuestions,
  getPot,
  getPayouts,
  getActiveProofs,
  getFixedPrizeThreshold,
  getProvisionalPrizes,
} from "@/lib/casa/queries";
import { signPayoutProofs } from "@/lib/casa/payout-proofs";
import { PruebasDePago } from "@/components/casa/PruebasDePago";
import {
  DEFAULT_MAX_ENTRIES_PER_USER,
  isLiveEntry,
  isPollaOpen,
  isPublicClosedPolla,
  pollaStatusLabel,
  type CasaPayout,
  type CasaPolla,
  type Pick1x2,
} from "@/lib/casa/types";
import { entryPriceLabel, formatCop, formatShortDate, prizeImageUrl, timeLeft } from "@/lib/casa/format";
import { premioLabel } from "@/lib/casa/premio";
import { getPollitoBase } from "@/lib/pollitos";
import { getPollaTournamentSlugs, resolveTournamentSlugs } from "@/lib/casa/tournaments";
import { TournamentIdentity } from "@/components/casa/TournamentIdentity";
import { ScoringModeBadge } from "@/components/casa/ScoringModeBadge";
import { HeroFrame, Label, SectionHead, StreetCard, Tape } from "@/components/street";
import { PicksBoard } from "@/components/casa/PicksBoard";
import { QuestionsBoard } from "@/components/casa/QuestionsBoard";
import { PollaTabs } from "@/components/casa/PollaTabs";
import { PollaInfo } from "@/components/casa/PollaInfo";
import { EliminarPolla } from "@/components/casa/EliminarPolla";
import { MisBoletas } from "@/components/casa/Boletas";
import { PremioObjeto } from "@/components/casa/PremioObjeto";
import { CompartirPolla } from "@/components/casa/CompartirPolla";
import { Participaciones } from "@/components/casa/Participaciones";
// Server Component: el texto sale de un módulo sin "use client" (ver el archivo).
import { faltanTexto } from "@/lib/casa/participaciones-texto";
import { ParaParticipar } from "@/components/casa/ParaParticipar";
import { BarraPagar } from "@/components/casa/BarraPagar";
import { UsarCupoGratis } from "@/components/casa/UsarCupoGratis";
import { UnirmeGratis } from "@/components/casa/UnirmeGratis";
import { PagoConfirmado } from "@/components/casa/PagoConfirmado";
import { ActivarCortesia } from "@/components/casa/ActivarCortesia";
import { AvisoDesempate } from "@/components/casa/AvisoDesempate";
import { MisCortesias } from "@/components/casa/MisCortesias";
import { courtesyPreview, listMyCourtesies } from "@/lib/casa/courtesies";
import { COURTESY_COOKIE, COURTESY_FINE_PRINT, isCourtesyEntry, validCourtesyCode, type CourtesyPreview } from "@/lib/casa/courtesies-shared";
import { acceptsCasaMatchPicks, canEditCasaMatch } from "@/lib/casa/match-rules";
import { canEditPolla, editorHref } from "@/lib/casa/editor";
import { getReferralInvitee, getReferralPollaView } from "@/lib/casa/referrals";
import { REFERRAL_COOKIE, isGiftEntry, referralEvery, referralPromo, referralRule, validReferralCode } from "@/lib/casa/referrals-shared";
import { premioCompartir } from "@/lib/casa/share-text";
import { InvitaYGana } from "@/components/casa/InvitaYGana";
import { PromoInvitados } from "@/components/casa/PromoInvitados";
import { QuienTeInvito } from "@/components/casa/QuienTeInvito";
import { VerMasInfo } from "@/components/casa/VerMasInfo";
import { Plus, Settings, Ticket } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function PollaPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  /** `p`: número de la participación que se está viendo (migración 131). */
  searchParams: Promise<{ p?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const polla = await getPollaBySlug((await params).slug);
  if (!polla || polla.status === "borrador" || polla.status === "anulada") notFound();

  // ── Enlace de cortesía (migración 138) ──────────────────────────────────
  // El código lo guardó proxy.ts en una cookie httpOnly al abrir el enlace, así
  // que sigue acá después del login y del onboarding. Solo se lee: SQL decide
  // si esta persona lo puede usar (cuenta nueva, una vez, en esta polla).
  const courtesyCode = validCourtesyCode((await cookies()).get(COURTESY_COOKIE)?.value);
  const cortesia: CourtesyPreview | null = courtesyCode
    ? await courtesyPreview(courtesyCode, user?.id ?? null).catch(() => null)
    : null;
  const cortesiaDeEstaPolla = cortesia && cortesia.slug === polla.slug ? cortesia : null;

  // ── Visitante sin sesión ────────────────────────────────────────────────
  // (2026-09-02) Antes esto era un `redirect` a /login. Como el link de la
  // polla es justamente lo que se pega en el grupo de WhatsApp, el resultado
  // era que a quien todavía no tiene cuenta le llegaba un formulario de login
  // sin ninguna pista de qué le estaban compartiendo.
  //
  // Ahora ve una versión REDUCIDA. Lo que se muestra es exactamente lo que la
  // casa ya está publicitando — torneo, nombre, pozo, entrada y cierre — y
  // NADA más: cero tabla de posiciones, cero nombres, cero pronósticos. Esa
  // línea la sostiene también el middleware, que solo abre `/polla/<slug>` y
  // deja `/inicio`, `/casa/admin` y `/polla/<slug>/pagar` pidiendo sesión.
  if (!user) {
    const [potPublico, tournaments] = await Promise.all([
      getPot(polla.id),
      getPollaTournamentSlugs([polla]),
    ]);
    return (
      <PollaPublica polla={polla} pot={potPublico} slug={(await params).slug} tournaments={tournaments[polla.id] ?? []}
        cortesia={cortesiaDeEstaPolla} />
    );
  }

  // Invitaciones (migración 135): el código propio para Compartir y, si la
  // persona llegó por un enlace y todavía puede elegir, quién la invitó.
  const referralHint = validReferralCode((await cookies()).get(REFERRAL_COOKIE)?.value);
  const [pot, bestEntry, entries, matches, questions, distribution, tabla, payouts, isAdmin, threshold, prizes, referral, invitee] =
    await Promise.all([
      getPot(polla.id),
      // La inscripción "principal" (pagada > pendiente > …): rifas, premio y la tabla.
      getMyEntry(polla.id, user.id),
      // Migración 131: todas las participaciones de la persona en esta polla.
      polla.kind === "rifa" ? Promise.resolve([]) : getMyEntries(polla.id, user.id),
      polla.kind === "partidos" ? getPollaMatches(polla.id) : Promise.resolve([]),
      polla.kind === "manual" ? getPollaQuestions(polla.id) : Promise.resolve([]),
      getDistribution(polla.id),
      getLeaderboard(polla.id),
      // Solo tiene filas cuando la polla ya se repartio.
      getPayouts(polla.id),
      isCurrentUserAdmin(),
      // Punto de equilibrio del premio fijo para Info, calculado en SQL.
      getFixedPrizeThreshold(polla),
      // Lo que ganaría hoy cada líder si la polla terminara ahora (migración
      // 133). Si la lectura falla, la tabla sale sin esa línea.
      polla.kind === "rifa" ? Promise.resolve([]) : getProvisionalPrizes(polla.id).catch(() => []),
      getReferralPollaView(user.id, polla.id),
      referralHint ? getReferralInvitee(user.id, referralHint) : Promise.resolve(null),
    ]);
  const abierta = isPollaOpen(polla);
  const every = referralEvery(polla);
  // ── Qué participación se está viendo ─────────────────────────────────────
  // ?p=N si es suya; si no, la primera viva (pagada o en revisión); si no, la última.
  // En rifas no hay participaciones numeradas: manda la inscripción principal.
  const requested = Number((await searchParams).p);
  const entry = polla.kind === "rifa"
    ? bestEntry
    : entries.find((e) => e.entry_number === requested) ?? entries.find(isLiveEntry) ?? entries[entries.length - 1] ?? null;
  const multiple = entries.filter((e) => e.status !== "anulada").length > 1;
  const etiqueta = multiple && entry?.entry_number ? `Cupo ${entry.entry_number} · ` : "";
  // Todos los pronósticos de la persona: los del cupo elegido van al tablero y el
  // resto sirve para avisar qué cupos todavía tienen partidos sin pronóstico.
  const allPicks = polla.kind === "rifa" || !entry ? [] : await getMyPicks(polla.id, user.id);
  const picks = allPicks.filter((p) => p.entry_id === entry?.id);
  const nowMs = Date.now();
  const editables = polla.kind === "partidos" && acceptsCasaMatchPicks(polla.status, polla.draw_pending)
    ? (matches as Array<Parameters<typeof canEditCasaMatch>[0] & { id: string }>).filter((m) => canEditCasaMatch(m, nowMs)).map((m) => m.id)
    : [];
  // Con la polla cerrada ya no hay nada que completar: sin este gate, cada cupo
  // decía "Listo" en una polla terminada, como si quedara tarea hecha ayer.
  const pendingByNumber: Record<number, number> | null = polla.kind === "partidos" && acceptsCasaMatchPicks(polla.status, polla.draw_pending)
    ? Object.fromEntries(entries.filter((e) => e.entry_number != null).map((e) => [e.entry_number!,
      editables.filter((id) => !allPicks.some((p) => p.entry_id === e.id && p.match_id === id)).length]))
    : null;
  // Cortesías que esta persona tiene para regalar en esta polla (migración 138).
  // Casi nadie tiene: la lista vuelve vacía y no se dibuja nada.
  const misCortesias = (await listMyCourtesies(user.id).catch(() => []))
    .filter((cortesia) => cortesia.slug === polla.slug);
  const canResumeProof = !abierta && polla.kind !== "rifa" && entry?.status === "pendiente" && !entry.proof_path
    ? (await getActiveProofs(polla.id, user.id)).some((proof) => proof.entry_id === entry.id) : false;
  const estado = pollaStatusLabel(polla);
  // `anulada` cuenta igual que `rechazada`: NO estás inscrito. Es el estado que
  // deja el endpoint de join cuando se cae la subida del comprobante, y existe
  // justamente para que la persona pueda volver a intentar. Tratarla como
  // inscripción viva escondía el botón de entrar y /pagar la devolvía acá: un
  // pantallazo que no subió dejaba a esa persona sin forma de entrar a la polla.
  const inscrito = isLiveEntry(entry);
  // Cualquier participación viva deja ver los pronósticos de los demás.
  const participa = polla.kind === "rifa" ? isLiveEntry(bestEntry) : entries.some(isLiveEntry);
  // Prueba de pago (migración 133): el pantallazo de la transferencia puede
  // traer el número de cuenta del ganador, así que la imagen se firma (1 h)
  // solo para administradores, ganadores y quienes participaron en la polla.
  // El resto ve igual el hecho: «Pagado · fecha».
  const puedeVerComprobantes = isAdmin || participa || payouts.some((p) => p.user_id === user.id);
  const proofUrls = puedeVerComprobantes && payouts.length > 0 ? await signPayoutProofs(payouts) : {};
  const pagoPendiente = entry?.status === "pendiente" && Boolean(entry.proof_path);
  // (2026-09-18) La tarjeta "Tus cupos" es para ELEGIR entre varios. Con uno
  // solo —el caso de casi todos— no hay nada que elegir: la tarjeta sobraba,
  // decía "1 de 10" y ofrecía un menú de una sola opción. Con un cupo, el
  // estado vive en los cuadros de abajo y la tarea, en la franja de faltantes.
  const showCupos = polla.kind !== "rifa" && entries.filter((e) => e.status !== "anulada").length > 1;
  const tournaments = resolveTournamentSlugs(polla, matches as { tournament: string | null }[]);
  // (2026-09-17) Todos los partidos con resultado verificado (o anulados) y la casa
  // todavía no confirma el reparto: se avisa para que nadie piense que se olvidó.
  const partidosTerminados = polla.kind === "partidos" && matches.length > 0 && polla.status !== "resuelta"
    && (matches as Array<{ final_verified_at: string | null; voided_at?: string | null }>).every((m) => Boolean(m.final_verified_at || m.voided_at));

  const picksPorPartido: Record<
    string,
    { pick1x2: Pick1x2 | null; homeScore: number | null; awayScore: number | null; pointsEarned: number | null }
  > = {};
  const picksPorPregunta: Record<
    string,
    { optionId: string | null; freeText: string | null }
  > = {};
  for (const p of picks) {
    if (p.match_id) {
      picksPorPartido[p.match_id] = {
        pick1x2: p.pick_1x2,
        homeScore: p.home_score,
        awayScore: p.away_score,
        // Calculado en SQL; la tarjeta lo muestra solo con el partido verificado.
        pointsEarned: p.points_earned,
      };
    } else if (p.question_id) {
      picksPorPregunta[p.question_id] = {
        optionId: p.option_id,
        freeText: p.free_text,
      };
    }
  }

  const objeto = polla.prize_kind === "objeto";
  // Entrada gratis (migración 143): no hay nada que transferir ni comprobante
  // que subir, así que la puerta es un botón «Unirme», no la pantalla de pago.
  const gratis = polla.entry_price_cop === 0 && polla.kind !== "rifa";
  // Sin ninguna participación viva: el CTA es entrar (o retomar la que falta).
  const mostrarEntrar = !participa && (abierta || canResumeProof) && polla.kind !== "rifa";
  const retomar = !participa && entry && !isLiveEntry(entry) ? entry.entry_number : null;
  // Ya participa y quedan cupos: el CTA principal es comprar otro (migración 131).
  const maxCupos = polla.max_entries_per_user ?? DEFAULT_MAX_ENTRIES_PER_USER;
  // Llegó por un enlace de cortesía y todavía no está inscrito (migración 138).
  const activarCortesia = Boolean(cortesiaDeEstaPolla?.redeemable) && !participa;
  // Con entrada gratis, un cupo por persona: varios cupos regalados serían
  // varias oportunidades gratis de ganar el mismo premio.
  const comprarOtro = polla.kind !== "rifa" && participa && abierta && !gratis
    && entries.filter((e) => e.status !== "anulada").length < maxCupos;
  // Invitaciones: sin código (administradores) no hay regla que ofrecer ni avance.
  const codigo = referral?.code ?? null;
  const promo = abierta ? referralPromo(polla, referral, pot.prize_cop) : null;
  // Cupo gratis por invitar (migración 144): SQL ya dijo que aquí se puede usar.
  // Con una cortesía por activar manda la cortesía: un solo cupo gratis a la vez.
  const usarCupo = Boolean(referral?.can_redeem) && !activarCortesia;

  return (
    <div className="pb-32">
      {/* ── Hero ──────────────────────────────────────────────────────────
            (2026-09-13) Compacto para que las pestañas aparezcan sin bajar:
            solo logos, estado junto al nombre, qué hay que acertar, y pozo +
            entrada en un solo bloque. Antes la entrada y "se lleva el ganador"
            iban en otra tarjeta que repetía la cifra del pozo. */}
      {/* (2026-09-18) Quien ya está dentro viene a pronosticar, no a que le
            vuelvan a vender la polla: el hero se acorta, Compartir pasa a un
            ícono y el mínimo garantizado queda en Info. Las pestañas pasaron de
            y=779 a verse en el primer pantallazo. */}
      <HeroFrame height={participa ? "min-h-[150px]" : "min-h-[200px]"} className="flex flex-col justify-end">
        {/* (2026-09-14) Tuerca de edición: solo administradores y solo hasta
            el cierre. SQL (migración 122) vuelve a validar al guardar. */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1"><TournamentIdentity tournaments={tournaments} kind={polla.kind} size={participa ? undefined : "lg"} /></div>
          {/* Compartir solo mientras esté abierta: pasar el link de una polla
              cerrada no le sirve a nadie. */}
          {abierta && (
            <CompartirPolla
              variant="icon"
              slug={polla.slug}
              nombre={polla.name}
              entradaCop={polla.entry_price_cop}
              premio={premioCompartir(polla, pot.prize_cop)}
              codigo={codigo}
              ayuda={every && codigo ? referralRule(every) : undefined}
            />
          )}
          {isAdmin && canEditPolla(polla) && (
            <Link
              href={editorHref(polla.id)}
              aria-label="Editar polla"
              title="Editar polla"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border-default bg-bg-card/80 text-text-secondary backdrop-blur-sm transition-colors duration-200 hover:border-border-strong hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold active:scale-95"
            >
              <Settings className="h-5 w-5" aria-hidden="true" />
            </Link>
          )}
        </div>
        <div className="mt-3 flex items-start justify-between gap-3">
          <h1 className={`lp-display min-w-0 flex-1 ${participa ? "text-[28px]" : "text-[34px]"} [overflow-wrap:anywhere]`}>{polla.name}</h1>
          <Tape tone={estado.tone} className="mt-1 shrink-0">
            {estado.text}
          </Tape>
        </div>
        {polla.kind === "partidos" && <ScoringModeBadge mode={polla.scoring_mode} className={`${participa ? "mt-2" : "mt-3"} self-start`} />}
        <div className={`${participa ? "mt-3" : "mt-4"} grid grid-cols-2 gap-x-3 gap-y-4`}>
          <div className={objeto ? "col-span-2 flex min-w-0 items-center gap-3" : "min-w-0"}>
            {objeto && polla.prize_image_path && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={prizeImageUrl(polla.prize_image_path)}
                alt=""
                aria-hidden="true"
                className="h-14 w-14 max-w-none shrink-0 rounded-md object-cover"
              />
            )}
            <div className="min-w-0">
              <Label>{polla.settlement_outcome === "house_retained_zero_points" ? "Premio no adjudicado" : premioLabel()}</Label>
              <div className="lp-money mt-1 text-[32px] leading-none text-gold [overflow-wrap:anywhere]">
                {objeto ? polla.prize_object : formatCop(pot.prize_cop)}
              </div>
            </div>
          </div>
          <div className={objeto ? "min-w-0" : "min-w-0 border-l border-border-subtle pl-3"}>
            <Label>Entrada</Label>
            {/* «$0» se lee como una transferencia de cero pesos (migración 143). */}
            <div className="lp-money mt-1 text-[32px] leading-none text-text-primary [overflow-wrap:anywhere]">
              {entryPriceLabel(polla.entry_price_cop)}
            </div>
          </div>
        </div>
        {/* Una línea por dato: seguidos en la misma fila se leían como una sola frase. */}
        <p className="mt-3 grid gap-1 text-[13px] leading-snug text-text-secondary">
          {/* Pozo fijo = mínimo garantizado (migración 109): la cifra del pozo puede crecer. */}
          {/* Es un argumento para ENTRAR: quien ya está dentro lo tiene en Info. */}
          {!participa && !objeto && polla.pot_mode === "fijo" && typeof polla.fixed_prize_cop === "number" && (
            <span>Mínimo garantizado: {formatCop(polla.fixed_prize_cop)}</span>
          )}
          {/* El estado ya va en la etiqueta junto al nombre: aquí no se repite. */}
          <span>
            {pot.paid_entries} inscritos{abierta ? ` · cierra en ${timeLeft(polla.closes_at)}` : ""}
          </span>
        </p>
      </HeroFrame>

      <div className="px-4 pt-4">
        {/* ── El resultado, cuando ya se repartió ──────────────────────────
              (2026-09-02) Esto no existía. `casa_settle_polla` escribía
              casa_payouts desde el día uno y NINGÚN archivo de la app la
              leía: la plata se repartía y el jugador no se enteraba nunca.
              Va primero a propósito — cuando una polla ya terminó, el
              resultado es lo único que importa de esa pantalla. */}
        {payouts.length > 0 && (
          <ResultadoPolla payouts={payouts} miUserId={user.id} totalCop={pot.prize_cop} proofUrls={proofUrls} />
        )}

        {polla.settlement_outcome === "house_retained_zero_points" && <StreetCard className="mb-4 p-4">
          <h2 className="lp-display-sm">Polla finalizada</h2>
          <p className="mt-2 text-[15px] text-text-secondary">Todos los participantes terminaron con cero puntos. No se adjudicaron premios.</p>
        </StreetCard>}
        {polla.prize_kind === "objeto" && (polla.draw_pending || payouts.length > 0) && (isAdmin || bestEntry?.status === "pagada") && <PremioObjeto slug={polla.slug} />}

        {polla.kind === "rifa" && <div className="mt-4 first:mt-0"><MisBoletas slug={polla.slug} open={abierta} /></div>}

        {/* La regla que decide la polla cuando el premio no se puede partir
            (migración 142). Va aquí, con el peso de un aviso, porque el empate
            arriba es el caso normal en modo marcador, no el borde. */}
        {/* Quien ya está inscrito ve el titular y abre el ejemplo con un toque:
            su hora de registro ya quedó, y el aviso entero tapaba los partidos. */}
        {polla.prize_kind === "objeto" && polla.kind !== "rifa" && (
          <AvisoDesempate compact={participa} />
        )}

        {/* Llegó por un enlace de cortesía y todavía no está inscrito: activar el
            cupo gratis es LO que tiene que hacer, así que va antes del CTA de
            pagar. SQL ya dijo que esta persona sí lo puede usar. */}
        {activarCortesia && (
          <ActivarCortesia polla={polla.name} holder={cortesiaDeEstaPolla!.holder} />
        )}

        {/* Llegó por el enlace de alguien y todavía puede elegir (migración 135). */}
        {invitee?.hint && invitee.can_set_referrer && abierta && (
          <div className="mt-4 first:mt-0"><QuienTeInvito initial={invitee} variant="casa" /></div>
        )}

        {/* ── Entrar y compartir, en una fila ───────────────────────────────
              (2026-09-13) Antes eran dos filas más la tarjeta de entrada, y las
              pestañas quedaban debajo del primer pantallazo. Compartir solo
              mientras esté abierta: pasar el link de una polla cerrada no le
              sirve a nadie. Si la fila no cabe (320 px o texto ampliado), se
              parte en dos y cada botón ocupa todo el ancho. */}
        {/* (2026-09-18) La puerta de entrada: quien no está inscrito ve los tres
              pasos y la cuenta a la que se transfiere, acá mismo. Antes el
              botón decía «Entrar por $20.000», compartía fila y peso con
              «Compartir», y la cuenta solo existía en /pagar: de ahí salía el
              «no sé dónde pagar». Con una cortesía por activar esto no se
              dibuja — el cupo gratis manda y pagar no viene al caso. */}
        {/* Tiene un cupo gratis por invitar y esta polla lo recibe: usarlo es LO
            primero, esté o no inscrito (si ya juega, es un cupo más). */}
        {usarCupo && (
          <UsarCupoGratis slug={polla.slug} disponibles={referral!.available} className="mt-4 first:mt-0" />
        )}

        {mostrarEntrar && !activarCortesia && !usarCupo && (gratis ? (
          <UnirmeGratis slug={polla.slug} nombre={polla.name} premio={objeto ? polla.prize_object : null} />
        ) : (
          <ParaParticipar
            polla={polla}
            retomar={Boolean(entry)}
            href={`/polla/${polla.slug}/pagar${retomar ? `?participacion=${retomar}` : ""}`}
          />
        ))}

        {mostrarEntrar && (activarCortesia || usarCupo) && (
          // Con un cupo gratis por usar (cortesía o invitaciones), pagar es la
          // opción secundaria: el dorado se queda en el cupo gratis, no en dos CTA.
          <Link href={`/polla/${polla.slug}/pagar${retomar ? `?participacion=${retomar}` : ""}`}
            className="lp-btn lp-btn-ghost mt-4 w-full !px-4 first:mt-0">
            {entry ? "Retomar comprobante" : `Pagar la entrada · ${formatCop(polla.entry_price_cop)}`}
          </Link>
        )}
        {/* (2026-09-18) «Comprar otro cupo», «Compartir» y la tarjeta de
              invitaciones eran TRES bloques a todo el ancho encima de los
              partidos. Compartir es ahora el ícono del encabezado; los otros
              dos comparten una fila corta y el detalle se abre si lo tocan.
              Comprar otro cupo vive en «Tus cupos» cuando ya hay varios. El
              precio no se repite en el botón: está arriba, en Entrada. */}
        <InvitaYGana
          view={abierta && every && codigo && referral && (participa || referral.counted > 0 || referral.in_review > 0) ? referral : null}
          every={every}
          leading={comprarOtro && !showCupos ? (
            <Link href={`/polla/${polla.slug}/pagar?participacion=nueva`} className="lp-btn lp-btn-ghost min-w-0 flex-[1_1_150px] gap-2 !px-3">
              <Plus aria-hidden="true" className="h-5 w-5 max-w-none shrink-0" />
              <span className="min-w-0 [overflow-wrap:anywhere]">Otro cupo</span>
            </Link>
          ) : null}
        />

        {/* (2026-09-18) Esto era un recuadro verde permanente. La aprobación es
            una NOTICIA, no un estado: se avisa la primera vez que la persona
            vuelve después de que el administrador aprobó, y no otra vez. Un
            «Estás dentro» que nunca se va se vuelve paisaje y le quita
            atención al rojo, que sí pide algo. */}
        {entry?.status === "pagada" && polla.kind !== "rifa" && (
          <PagoConfirmado
            entryId={entry.id}
            cortesia={isCourtesyEntry(entry)}
            gratis={isGiftEntry(entry)}
            cupo={multiple ? entry.entry_number : null}
            abierta={abierta}
          />
        )}

        {pagoPendiente && polla.kind !== "rifa" && !showCupos && (
          <div className="mt-4 border border-amber/40 bg-amber/10 p-3">
            <p className="lp-label text-amber">{etiqueta}Pago en revisión</p>
            <div className="flex flex-wrap items-center justify-between gap-x-3">
              <p className="text-[15px] font-semibold text-text-primary">Ya puedes pronosticar.</p>
              <VerMasInfo section="entrada" />
            </div>
          </div>
        )}

        {entry?.status === "rechazada" && polla.kind !== "rifa" && !showCupos && (
          <div className="mt-4 border border-red-alert/40 bg-red-alert/10 p-3">
            <p className="lp-label text-red-alert">{etiqueta}Pago rechazado</p>
            <p className="mt-1 text-[13px] text-text-secondary">
              {entry.reject_reason ?? "Comunícate con el administrador."}
            </p>
            {abierta && participa && entry.entry_number && (
              <Link href={`/polla/${polla.slug}/pagar?participacion=${entry.entry_number}`} className="lp-btn lp-btn-ghost mt-3 w-full">
                Enviar otro comprobante para este cupo
              </Link>
            )}
          </div>
        )}

        {/* El comprobante no llegó a guardarse (se cayó la subida). Sin este
            aviso la persona solo veía el botón de entrar otra vez, sin saber
            por qué su intento anterior no quedó. */}
        {(entry?.status === "anulada" || (entry?.status === "pendiente" && !entry.proof_path)) && abierta && polla.kind !== "rifa" && !showCupos && (
          <div className="mt-4 border border-amber/40 bg-amber/10 p-3">
            <p className="lp-label text-amber">{etiqueta}Tu comprobante no se guardó</p>
            <p className="mt-1 text-[15px] text-text-primary">Súbelo otra vez.</p>
            {participa && entry?.entry_number && (
              <Link href={`/polla/${polla.slug}/pagar?participacion=${entry.entry_number}`} className="lp-btn lp-btn-ghost mt-3 w-full">
                Subir el comprobante de este cupo
              </Link>
            )}
          </div>
        )}

        {partidosTerminados && payouts.length === 0 && (
          <StreetCard className="mt-4 border-turf/40 p-4 first:mt-0">
            <p className="lp-label !text-turf">Todos los partidos terminaron</p>
            <p className="mt-1 text-[15px] leading-relaxed text-text-secondary">Confirmando ganadores y pago.</p>
          </StreetCard>
        )}

        {misCortesias.length > 0 && (
          <MisCortesias initial={misCortesias} mostrarPolla={false} />
        )}

        <PollaTabs
          slug={polla.slug}
          finished={partidosTerminados}
          info={<PollaInfo polla={polla} threshold={threshold} />}
          firstLabel={polla.kind === "manual" ? "Preguntas" : polla.kind === "rifa" ? "Sorteo" : "Partidos"}
          initialRows={tabla}
          initialPrizes={prizes}
          entryStatus={bestEntry?.status ?? null}
          pollaStatus={polla.status}
          drawPending={polla.draw_pending}
          userId={user.id}
          tiebreakByRegistration={polla.prize_kind === "objeto" && polla.kind !== "rifa"}
        >
        {/* ── Tus cupos (migración 131) ─────────────────────────────────────────
              (2026-09-16) Pedido del dueño: las pestañas Partidos / Tabla / Info
              van ARRIBA de «Tus cupos». La tarjeta vive dentro de la pestaña
              donde manda: elige qué cupo se pronostica justo encima de los
              partidos, y ahí se ve cada uno con su estado y se suma otro. */}
        {showCupos && (
          <div className="pt-4">
            <Participaciones
              pendingByNumber={pendingByNumber}
              slug={polla.slug}
              entries={entries}
              selectedNumber={entry?.entry_number ?? null}
              maxEntries={polla.max_entries_per_user ?? DEFAULT_MAX_ENTRIES_PER_USER}
              entryPriceCop={polla.entry_price_cop}
              open={abierta}
            />
          </div>
        )}

        {/* ── Tu tarea, con un solo cupo ────────────────────────────────────
              Sin la tarjeta «Tus cupos» (que es para elegir entre varios), lo
              que falta se dice acá, en una línea, pegado al tablero. El estado
              del pago NO se repite: si está aprobado, no se dice nada. */}
        {polla.kind === "partidos" && !showCupos && inscrito && pendingByNumber && entry?.entry_number != null && (
          (pendingByNumber[entry.entry_number] ?? 0) > 0 ? (
            <p className="mt-4 flex items-center gap-2 border border-red-alert/40 bg-red-alert/10 p-3 text-[15px] font-semibold text-red-alert first:mt-0">
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-red-alert" />
              {faltanTexto(pendingByNumber[entry.entry_number] ?? 0)}
            </p>
          ) : null
        )}

        {/* ── Los partidos ─────────────────────────────────────────────── */}
        {polla.kind === "partidos" && matches.length > 0 && (
          <div className="pt-4">
            <PicksBoard
              key={entry?.id ?? "sin-participacion"}
              slug={polla.slug}
              joinPrompt={!inscrito && abierta ? { href: `/polla/${polla.slug}/pagar${retomar ? `?participacion=${retomar}` : ""}`, entryPriceCop: polla.entry_price_cop } : undefined}
              entryNumber={entry?.entry_number ?? null}
              scoringMode={polla.scoring_mode ?? "1x2"}
              matches={matches as never}
              initialPicks={picksPorPartido}
              distribution={distribution}
              canEdit={inscrito && acceptsCasaMatchPicks(polla.status, polla.draw_pending)}
              canViewOthers={participa || isAdmin || isPublicClosedPolla(polla)}
              showMine={participa}
              lockedReason={
                !acceptsCasaMatchPicks(polla.status, polla.draw_pending) ? "Esta polla ya no recibe pronósticos." : !inscrito
                  ? "Inscríbete para pronosticar."
                  : "Esta polla ya cerró."
              }
            />
          </div>
        )}

        {/* ── Las preguntas manuales ───────────────────────────────────── */}
        {polla.kind === "manual" && questions.length > 0 && (
          <>
            <SectionHead
              title="Las preguntas"
              meta={`${questions.length}`}
              className="mt-8"
            />
            <div className="-mx-4">
              <QuestionsBoard
                key={entry?.id ?? "sin-participacion"}
                slug={polla.slug}
                entryNumber={entry?.entry_number ?? null}
                questions={questions}
                initialPicks={picksPorPregunta}
                distribution={distribution}
                canEdit={inscrito && abierta}
                lockedReason={
                  !abierta ? "Esta polla ya cerró." : !inscrito
                    ? "Inscríbete para responder."
                    : "Esta polla ya cerró."
                }
              />
            </div>
          </>
        )}

          {polla.kind === "partidos" && matches.length === 0 && (
            <StreetCard className="mt-4 p-5 text-center">
              <h2 className="lp-display-sm">Partidos por confirmar</h2>
              <p className="mt-2 text-sm text-text-secondary">El administrador publicará los partidos de esta polla aquí.</p>
            </StreetCard>
          )}
          {polla.kind === "rifa" && (
            <StreetCard className="mt-4 p-5">
              <h2 className="lp-display-sm">Sorteo</h2>
              <p className="mt-2 text-sm text-text-secondary">{polla.draw_method ?? "El administrador publicará el resultado del sorteo aquí."}</p>
              {polla.drawn_number != null && <p className="lp-money mt-3">Número sorteado: {polla.drawn_number}</p>}
            </StreetCard>
          )}
        </PollaTabs>

        {/* (2026-09-18) El botón de pagar te sigue mientras bajas por los
            partidos, la tabla y la info. La puerta ya no se queda arriba. Se
            deja de dibujar en cuanto hay una inscripción viva. */}
        {/* Con entrada gratis la barra no se dibuja: el botón «Unirme» ya está
            arriba y no hay nada que pagar ni comprobante que subir. */}
        {mostrarEntrar && !activarCortesia && !usarCupo && !gratis && (
          <BarraPagar
            href={`/polla/${polla.slug}/pagar${retomar ? `?participacion=${retomar}` : ""}`}
            entryPriceCop={polla.entry_price_cop}
            texto={entry ? "Subir el comprobante" : undefined}
          />
        )}

        {isAdmin && !polla.draw_pending && <EliminarPolla id={polla.id} nombre={polla.name} redirectTo="/inicio" />}
      </div>
      {/* Aviso de invitaciones (2026-09-17): solo en la polla del aviso. */}
      {promo && <PromoInvitados promo={promo} />}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   PollaPublica — lo que ve alguien SIN sesión que abrió el link compartido.

   Su único trabajo es que la persona entienda en 5 segundos qué le
   compartieron y por qué le conviene entrar. Deliberadamente NO muestra
   ningún dato de otras personas: ni tabla, ni nombres, ni pronósticos, ni
   cuántos van. Solo lo que la casa ya publicita.
   ──────────────────────────────────────────────────────────────────────── */
function PollaPublica({
  polla,
  pot,
  slug,
  tournaments,
  cortesia = null,
}: {
  polla: CasaPolla;
  pot: { prize_cop: number };
  slug: string;
  tournaments: string[];
  /** Cortesía del enlace que abrió (migración 138), si es de esta polla. */
  cortesia?: CourtesyPreview | null;
}) {
  const abierta = isPollaOpen(polla);
  const entrar = `/login?returnTo=${encodeURIComponent(`/polla/${slug}`)}`;
  // Le regalaron un cupo: eso manda sobre el precio de la entrada. El cupo se
  // activa DESPUÉS de crear la cuenta, porque solo es para personas nuevas.
  const regalo = cortesia?.usable ? cortesia : null;

  return (
    <div className="pb-32">
      <HeroFrame height="min-h-[236px]" className="flex flex-col justify-end">
        <TournamentIdentity tournaments={tournaments} kind={polla.kind} size="lg" />
        <h1 className="lp-display-sm mt-3 text-[28px] text-text-primary [overflow-wrap:anywhere]">
          {polla.name}
        </h1>
        {polla.kind === "partidos" && <ScoringModeBadge mode={polla.scoring_mode} className="mt-3 self-start" />}
        <div className="mt-3">
          <Label>{polla.settlement_outcome === "house_retained_zero_points" ? "Premio no adjudicado" : premioLabel()}</Label>
          <div className="lp-money mt-0.5 text-[40px] leading-none text-gold">
            {polla.prize_kind === "objeto" ? polla.prize_object : formatCop(pot.prize_cop)}
          </div>
          {polla.prize_kind !== "objeto" && polla.pot_mode === "fijo" && typeof polla.fixed_prize_cop === "number" && (
            <p className="mt-1 text-[13px] text-text-secondary">Mínimo garantizado: {formatCop(polla.fixed_prize_cop)}</p>
          )}
        </div>
      </HeroFrame>

      <div className="px-4 pt-6">
        {/* Quien abre el enlace compartido ve la regla del desempate ANTES de
            registrarse: es la que decide la polla cuando el premio no se parte. */}
        {polla.prize_kind === "objeto" && polla.kind !== "rifa" && (
          <div className="mb-4"><AvisoDesempate /></div>
        )}
        {regalo && (
          <StreetCard hero className="mb-4 bg-bg-card p-5">
            <p className="flex items-start gap-2 text-[17px] font-semibold leading-snug text-text-primary">
              <Ticket className="mt-1 h-5 w-5 shrink-0 text-gold" aria-hidden="true" />
              <span>{regalo.holder ? `${regalo.holder} te regaló un cupo gratis` : "Tienes un cupo gratis"}</span>
            </p>
            <p className="mt-2 text-[15px] leading-relaxed text-text-secondary">
              Crea tu cuenta y activas el cupo en esta polla. No pagas nada.
            </p>
            <Link href={entrar} className="lp-btn lp-btn-primary mt-4 w-full">Crear mi cuenta</Link>
            <p className="mt-3 text-[12px] leading-snug text-text-muted">{COURTESY_FINE_PRINT}</p>
          </StreetCard>
        )}
        <StreetCard className="bg-bg-card p-5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <Label>Entrada</Label>
              <div className="lp-money mt-0.5 text-[26px] leading-none text-text-primary">
                {entryPriceLabel(polla.entry_price_cop)}
              </div>
            </div>
            <div className="text-right">
              {/* Una polla repartida responde «cuándo terminó», no «en qué estado está». */}
              <Label>{abierta ? "Cierra en" : polla.status === "resuelta" ? "Terminó" : "Estado"}</Label>
              <div className="lp-money mt-0.5 text-[18px] leading-none text-text-secondary">
                {abierta
                  ? timeLeft(polla.closes_at)
                  : polla.status === "resuelta"
                    ? formatShortDate(polla.settled_at ?? polla.closes_at, { year: true })
                    : pollaStatusLabel(polla).text}
              </div>
            </div>
          </div>

          <p className="mt-4 border-t border-border-subtle pt-4 text-[13px] leading-relaxed text-text-secondary">
            {polla.prize_kind === "objeto" ? `Participas por ${polla.prize_object}. El premio no se divide ni se convierte en dinero.` : polla.kind === "rifa" ? "Participas con tu boleta en el sorteo anunciado." : "El pozo se reparte entre quienes obtienen el mayor puntaje."}
          </p>

          <Link href={entrar} className={`lp-btn mt-5 w-full ${regalo ? "lp-btn-ghost" : "lp-btn-primary"}`}>
            {regalo ? "Ver la app" : abierta ? "Entrar a esta polla" : "Ver la app"}
          </Link>
          <p className="mt-3 text-center text-[11px] text-text-muted">
            Necesitas tu número de celular. No pedimos datos bancarios.
          </p>
        </StreetCard>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   ResultadoPolla — el cierre emocional que a este producto le faltaba.

   `casa_settle_polla` (migración 082) escribe casa_payouts desde el día uno,
   pero hasta el 2026-09-02 NINGÚN archivo de la app leía esa tabla. O sea:
   alguien pagaba, acertaba, ganaba... y la pantalla seguía mostrando la tabla
   de puntos como si nada. El único que sabía el resultado era el admin,
   porque el bot de Telegram se lo respondía en el chat.

   Si el que mira es uno de los ganadores, su fila se destaca y se le dice
   qué sigue (que la casa le transfiere). Si no ganó, ve quién ganó — que
   también es información que la gente quiere.
   ──────────────────────────────────────────────────────────────────────── */
function ResultadoPolla({
  payouts,
  miUserId, totalCop, proofUrls,
}: {
  payouts: CasaPayout[];
  miUserId: string;
  totalCop: number;
  /** id del premio → URL firmada del comprobante de pago (migración 133). */
  proofUrls: Record<string, string>;
}) {
  const miPremio = payouts.find((p) => p.user_id === miUserId);
  const objeto = payouts[0]?.prize_kind === "objeto";
  // Cómo se distribuye la plata (2026-09-16): el pozo, entre cuántos y cuánto
  // le toca a cada uno. Las cifras salen del reparto en SQL (casa_payouts); si
  // el sobrante del redondeo dejó montos distintos por $1, no se dice «cada uno».
  const parejo = payouts.every((p) => p.amount_cop === payouts[0].amount_cop);
  const reparto = !objeto && payouts.length > 1
    ? `Pozo ${formatCop(totalCop)} · ${payouts.length} ganadores${parejo ? ` · ${formatCop(payouts[0].amount_cop)} cada uno` : ""}`
    : !objeto ? `Pozo ${formatCop(totalCop)} · un solo ganador` : null;
  const pruebas = !objeto && <PruebasDePago payouts={payouts} proofUrls={proofUrls} miUserId={miUserId} />;

  return (
    <div className="mb-5">
      {miPremio ? (
        // Ganaste. Es EL momento de la app: se usa la card hero (borde dorado
        // + glow), que el design system reserva para un único momento por
        // pantalla, y acá está claramente justificado.
        <StreetCard hero className="bg-bg-card p-5 text-center">
          <Image
            src="/pollitos/pollito_pibe_lider-128.webp"
            alt=""
            aria-hidden="true"
            width={96}
            height={96}
            className="mx-auto mb-2 h-24 w-24 max-w-none object-contain"
          />
          <Label>
            {miPremio.place === 1 ? "Ganaste" : `Puesto ${miPremio.place}`}
          </Label>
          <div className={`lp-money mt-1 leading-tight text-gold [overflow-wrap:anywhere] ${objeto ? "text-[24px]" : "text-[46px]"}`}>
            {objeto ? miPremio.prize_object : formatCop(miPremio.amount_cop)}
          </div>
          {miPremio.points != null && (
            <p className="mt-2 text-[13px] text-text-secondary">
              {miPremio.points} puntos
              {payouts.length > 1 && ` · empataste con ${payouts.length - 1} más`}
            </p>
          )}
          {reparto && <p className="mt-1 text-[13px] text-text-secondary">{reparto}</p>}
          <p className="mt-4 border-t border-border-subtle pt-4 text-[12px] leading-relaxed text-text-muted">
            {objeto ? (miPremio.delivered_at ? "La entrega de tu premio ya está registrada." : "La casa coordinará contigo la entrega de tu premio.") : miPremio.paid_at
              ? "Ya te transferimos: el comprobante está abajo, en Prueba de pago. Si no te llegó, escríbenos."
              : "La casa te transfiere a la cuenta que tengas registrada en tu perfil. Revísala para que el pago no se demore."}
          </p>
          {!objeto && !miPremio.paid_at && (
            <Link href="/perfil" className="lp-btn lp-btn-ghost mt-3 w-full">
              Revisar mi cuenta de pago
            </Link>
          )}
          <div className="text-left">{pruebas}</div>
        </StreetCard>
      ) : (
        <StreetCard className="bg-bg-card p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="lp-display-sm text-text-primary">
              {payouts.length === 1 ? "Ganador" : "Ganadores"}
            </h2>
            <span className="lp-money text-[16px] text-gold">
              {objeto ? payouts[0]?.prize_object : formatCop(totalCop)}
            </span>
          </div>
          {reparto && <p className="mt-1 text-[13px] text-text-secondary">{reparto}</p>}
          {/* (2026-09-18) Con premio en dinero, «Prueba de pago» ya lista a cada
              ganador con su monto: repetirlos aquí duplicaba la tarjeta y dejaba
              las pestañas a más de un pantallazo. Esta lista queda para premios
              en objeto, donde no hay prueba de pago que los nombre. */}
          {objeto && <ul className="mt-3 space-y-2">
            {payouts.map((p) => (
              <li key={p.user_id} className="flex items-center gap-3">
                {/* `users.avatar_url` NO es una URL: guarda la clave del
                    pollito ("millos", "junior"). Pasársela a next/image tiraba
                    `Failed to parse src` y con eso se caía la pantalla ENTERA
                    de la polla — para todos menos el ganador, y solo después
                    de repartir. getPollitoBase es el traductor de siempre. */}
                <Image
                  src={getPollitoBase(p.avatar_url)}
                  alt=""
                  aria-hidden="true"
                  width={28}
                  height={28}
                  className="h-7 w-7 max-w-none shrink-0 rounded-full object-contain"
                />
                <span className="min-w-0 flex-1 text-[15px] text-text-primary [overflow-wrap:anywhere]">
                  {p.display_name ?? "Sin nombre"}
                </span>
                <span className="lp-money shrink-0 text-[15px] text-text-secondary">
                  {p.prize_kind === "objeto" ? "Premio adjudicado" : formatCop(p.amount_cop)}
                </span>
              </li>
            ))}
          </ul>}
          {pruebas}
        </StreetCard>
      )}
    </div>
  );
}

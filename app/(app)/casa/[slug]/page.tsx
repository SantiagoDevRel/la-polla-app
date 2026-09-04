// app/(app)/casa/[slug]/page.tsx — el detalle de una polla.
//
// Tres estados que la pantalla tiene que resolver bien:
//   1. No estás inscrito  → el CTA es pagar.
//   2. Pagaste, falta que Tama confirme → podés ir marcando, pero se avisa
//      claro que todavía no contás para el pozo.
//   3. Estás dentro → marcás y ves la tabla.

import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getDistribution,
  getLeaderboard,
  getMyEntry,
  getMyPicks,
  getPollaBySlug,
  getPollaMatches,
  getPollaQuestions,
  getPot,
  getPayouts,
} from "@/lib/casa/queries";
import {
  isPollaOpen,
  pollaStatusLabel,
  type CasaPayout,
  type CasaPolla,
  type Pick1x2,
} from "@/lib/casa/types";
import { formatCop, prizeImageUrl, timeLeft } from "@/lib/casa/format";
import { getTournamentLogo, getTournamentName } from "@/lib/tournaments";
import { HeroFrame, Label, SectionHead, StreetCard, Tape } from "@/components/street";
import { PicksBoard } from "@/components/casa/PicksBoard";
import { QuestionsBoard } from "@/components/casa/QuestionsBoard";
import { CompartirPolla } from "@/components/casa/CompartirPolla";

export const dynamic = "force-dynamic";

export default async function PollaPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const polla = await getPollaBySlug((await params).slug);
  if (!polla || polla.status === "borrador") notFound();

  // ── Visitante sin sesión ────────────────────────────────────────────────
  // (2026-09-02) Antes esto era un `redirect` a /login. Como el link de la
  // polla es justamente lo que se pega en el grupo de WhatsApp, el resultado
  // era que a quien todavía no tiene cuenta le llegaba un formulario de login
  // sin ninguna pista de qué le estaban compartiendo.
  //
  // Ahora ve una versión REDUCIDA. Lo que se muestra es exactamente lo que la
  // casa ya está publicitando — torneo, nombre, pozo, entrada y cierre — y
  // NADA más: cero tabla de posiciones, cero nombres, cero pronósticos. Esa
  // línea la sostiene también el middleware, que solo abre `/casa/<slug>` y
  // deja `/casa`, `/casa/admin` y `/casa/<slug>/pagar` pidiendo sesión.
  if (!user) {
    const potPublico = await getPot(polla.id);
    return (
      <PollaPublica polla={polla} pot={potPublico} slug={(await params).slug} />
    );
  }

  const [pot, entry, matches, questions, picks, distribution, tabla, payouts] =
    await Promise.all([
      getPot(polla.id),
      getMyEntry(polla.id, user.id),
      polla.kind === "partidos" ? getPollaMatches(polla.id) : Promise.resolve([]),
      polla.kind === "manual" ? getPollaQuestions(polla.id) : Promise.resolve([]),
      getMyPicks(polla.id, user.id),
      getDistribution(polla.id),
      getLeaderboard(polla.id),
      // Solo tiene filas cuando la polla ya se repartio.
      getPayouts(polla.id),
    ]);

  const abierta = isPollaOpen(polla);
  const estado = pollaStatusLabel(polla);
  const inscrito = entry != null && entry.status !== "rechazada";
  const pagoPendiente = entry?.status === "pendiente";

  const picksPorPartido: Record<
    string,
    { pick1x2: Pick1x2 | null; homeScore: number | null; awayScore: number | null }
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
      };
    } else if (p.question_id) {
      picksPorPregunta[p.question_id] = {
        optionId: p.option_id,
        freeText: p.free_text,
      };
    }
  }

  return (
    <div className="pb-32">
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <HeroFrame height="h-[214px]">
        <div className="flex items-center gap-2">
          {polla.tournament && (
            <Image
              src={getTournamentLogo(polla.tournament)}
              alt=""
              width={18}
              height={18}
              className="h-[18px] w-[18px] max-w-none shrink-0 object-contain"
            />
          )}
          <Label>
            {polla.tournament ? getTournamentName(polla.tournament) : "Polla manual"}
          </Label>
          <Tape tone={estado.tone} className="ml-auto">
            {estado.text}
          </Tape>
        </div>
        <h1 className="lp-display mt-2 text-[34px]">{polla.name}</h1>
        <div className="mt-3 flex items-end justify-between gap-4">
          <div>
            <Label>Pozo</Label>
            <div className="lp-money text-[32px] leading-none text-gold">
              {formatCop(pot.prize_cop)}
            </div>
          </div>
          <span className="text-[12px] text-text-secondary">
            {pot.paid_entries} inscritos ·{" "}
            {abierta ? `cierra en ${timeLeft(polla.closes_at)}` : estado.text}
          </span>
        </div>
      </HeroFrame>

      <div className="px-4 pt-5">
        {/* ── El resultado, cuando ya se repartió ──────────────────────────
              (2026-09-02) Esto no existía. `casa_settle_polla` escribía
              casa_payouts desde el día uno y NINGÚN archivo de la app la
              leía: la plata se repartía y el jugador no se enteraba nunca.
              Va primero a propósito — cuando una polla ya terminó, el
              resultado es lo único que importa de esa pantalla. */}
        {payouts.length > 0 && (
          <ResultadoPolla payouts={payouts} miUserId={user.id} />
        )}

        {/* (2026-09-03) Antes esto desglosaba "A los ganadores 70% / A la
              casa 30%". El dueño pidió sacar el porcentaje, así que queda lo
              que de verdad le sirve a quien va a pagar: cuánto cuesta entrar y
              cuánto hay para el ganador, en pesos. La cifra del pozo es viva
              — sale de casa_polla_pot — así que sigue siendo verdad sin tener
              que explicar la aritmética. */}
        <StreetCard className="p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Entrada</Label>
              <div className="lp-money mt-1 text-[17px] text-text-primary">
                {formatCop(polla.entry_price_cop)}
              </div>
            </div>
            <div>
              <Label>Se lleva el ganador</Label>
              <div className="lp-money mt-1 text-[17px] text-gold">
                {formatCop(pot.prize_cop)}
              </div>
            </div>
          </div>
          {/* El premio en objeto (migración 089). Cuando `prize_kind` es
              "pozo" no se dibuja nada acá: la cifra del pozo ya está arriba en
              el hero y repetirla en palabras la haría envejecer mal — el pozo
              crece con cada inscripción y un texto no. */}
          {polla.prize_kind === "objeto" && polla.prize_object && (
            <div className="mt-3 flex items-center gap-3 border-t border-border-subtle pt-3">
              {polla.prize_image_path && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={prizeImageUrl(polla.prize_image_path)}
                  alt=""
                  aria-hidden="true"
                  className="h-16 w-16 max-w-none shrink-0 rounded-md object-cover"
                />
              )}
              <p className="min-w-0 text-[13px] text-text-secondary">
                <span className="lp-label mb-0.5 block">El premio</span>
                {polla.prize_object}
              </p>
            </div>
          )}
          {polla.kind === "rifa" && polla.draw_method && (
            <p className="mt-3 border-t border-border-subtle pt-3 text-[13px] text-text-secondary">
              <span className="lp-label mb-1 block">Cómo se define el ganador</span>
              {polla.draw_method}
            </p>
          )}
          {polla.scoring_mode && (
            <p className="mt-3 border-t border-border-subtle pt-3 text-[12px] text-text-muted">
              {polla.scoring_mode === "1x2"
                ? `Acertar local, empate o visitante vale ${polla.points_result} puntos. No hay más opciones.`
                : `Marcador exacto: ${polla.points_exact} puntos. Acertarle a los goles de un solo equipo: ${polla.points_one_team}.`}
            </p>
          )}
        </StreetCard>

        {/* Compartir. Solo mientras esté abierta: pasar el link de una polla
            ya cerrada no le sirve a nadie y ensucia la pantalla. La casa vive
            de que la gente entre, así que esto va arriba, no escondido. */}
        {abierta && (
          <div className="mt-4">
            <CompartirPolla
              slug={polla.slug}
              nombre={polla.name}
              entradaCop={polla.entry_price_cop}
              pozoCop={pot.prize_cop}
            />
          </div>
        )}

        {/* ── Estado de tu inscripción ─────────────────────────────────── */}
        {!inscrito && abierta && (
          <Link href={`/casa/${polla.slug}/pagar`} className="mt-4 block">
            <span className="lp-btn lp-btn-primary w-full">
              Entrar por {formatCop(polla.entry_price_cop)}
            </span>
          </Link>
        )}

        {/* Estás dentro. Antes, cuando Tama aprobaba, simplemente DESAPARECÍA
            el aviso ámbar y no aparecía nada — la única señal de que el pago
            se confirmó era una ausencia, que nadie nota. */}
        {entry?.status === "pagada" && (
          <div className="mt-4 border border-turf/40 bg-turf/10 p-3">
            <p className="lp-label text-turf">Estás dentro</p>
            <p className="mt-1 text-[13px] text-text-secondary">
              Confirmamos tu pago y ya cuentas para el pozo.
              {abierta ? " Haz tus pronósticos antes del cierre." : ""}
            </p>
          </div>
        )}

        {pagoPendiente && (
          <div className="mt-4 border border-amber/40 bg-amber/10 p-3">
            <p className="lp-label text-amber">Pago en revisión</p>
            <p className="mt-1 text-[13px] text-text-secondary">
              Recibimos tu comprobante. Puedes pronosticar mientras tanto, pero
              no cuentas para el pozo hasta que lo confirmemos.
            </p>
          </div>
        )}

        {entry?.status === "rechazada" && (
          <div className="mt-4 border border-red-alert/40 bg-red-alert/10 p-3">
            <p className="lp-label text-red-alert">Pago rechazado</p>
            <p className="mt-1 text-[13px] text-text-secondary">
              {entry.reject_reason ?? "Comunícate con el administrador."}
            </p>
          </div>
        )}

        {/* ── Los partidos ─────────────────────────────────────────────── */}
        {polla.kind === "partidos" && matches.length > 0 && (
          <>
            <SectionHead
              title="Tus pronósticos"
              meta={`${matches.length} partidos`}
              className="mt-8"
            />
            <div className="-mx-4">
              <PicksBoard
                slug={polla.slug}
                scoringMode={polla.scoring_mode ?? "1x2"}
                matches={matches as never}
                initialPicks={picksPorPartido}
                distribution={distribution}
                canEdit={inscrito && abierta}
                lockedReason={
                  !inscrito
                    ? "Inscríbete para pronosticar."
                    : "Esta polla ya cerró."
                }
              />
            </div>
          </>
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
                slug={polla.slug}
                questions={questions}
                initialPicks={picksPorPregunta}
                distribution={distribution}
                canEdit={inscrito && abierta}
                lockedReason={
                  !inscrito
                    ? "Inscríbete para responder."
                    : "Esta polla ya cerró."
                }
              />
            </div>
          </>
        )}

        {/* ── Tabla ────────────────────────────────────────────────────── */}
        {tabla.length > 0 && (
          <>
            <SectionHead title="Tabla" meta={`${tabla.length}`} className="mt-9" />
            <ul className="space-y-px">
              {tabla.slice(0, 20).map((row) => {
                const yo = row.user_id === user.id;
                return (
                  <li
                    key={row.entry_id}
                    className={`flex items-center gap-3 p-3 ${
                      yo ? "bg-gold/10" : "bg-bg-card"
                    }`}
                  >
                    <span
                      className={`lp-money w-7 shrink-0 text-[18px] ${
                        row.puesto === 1 ? "text-gold" : "text-text-muted"
                      }`}
                    >
                      {row.puesto}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[14px] text-text-primary">
                      {row.display_name ?? "Sin nombre"}
                      {yo && <span className="lp-label ml-2 inline">tú</span>}
                    </span>
                    <span className="lp-money shrink-0 text-[18px] text-text-primary">
                      {row.points}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
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
}: {
  polla: CasaPolla;
  pot: { prize_cop: number };
  slug: string;
}) {
  const abierta = isPollaOpen(polla);
  const entrar = `/login?returnTo=${encodeURIComponent(`/casa/${slug}`)}`;

  return (
    <div className="pb-32">
      <HeroFrame height="h-[236px]">
        <div className="flex items-center gap-2">
          {polla.tournament && (
            <Image
              src={getTournamentLogo(polla.tournament)}
              alt=""
              width={22}
              height={22}
              className="h-[22px] w-[22px] max-w-none shrink-0 object-contain"
            />
          )}
          <Label>
            {polla.kind === "rifa"
              ? "Rifa"
              : polla.tournament
                ? getTournamentName(polla.tournament)
                : "Polla"}
          </Label>
        </div>
        <h1 className="lp-display-sm mt-1 text-[28px] text-text-primary">
          {polla.name}
        </h1>
        <div className="mt-3">
          <Label>Pozo</Label>
          <div className="lp-money mt-0.5 text-[40px] leading-none text-gold">
            {formatCop(pot.prize_cop)}
          </div>
        </div>
      </HeroFrame>

      <div className="px-4 pt-6">
        <StreetCard className="bg-bg-card p-5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <Label>Entrada</Label>
              <div className="lp-money mt-0.5 text-[26px] leading-none text-text-primary">
                {formatCop(polla.entry_price_cop)}
              </div>
            </div>
            <div className="text-right">
              <Label>{abierta ? "Cierra en" : "Estado"}</Label>
              <div className="lp-money mt-0.5 text-[18px] leading-none text-text-secondary">
                {abierta ? timeLeft(polla.closes_at) : pollaStatusLabel(polla).text}
              </div>
            </div>
          </div>

          <p className="mt-4 border-t border-border-subtle pt-4 text-[13px] leading-relaxed text-text-secondary">
            Entras, pronosticas y el pozo se reparte entre quienes más
            acierten.
          </p>

          <Link href={entrar} className="lp-btn lp-btn-primary mt-5 w-full">
            {abierta ? "Entrar a esta polla" : "Ver la app"}
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
  miUserId,
}: {
  payouts: CasaPayout[];
  miUserId: string;
}) {
  const miPremio = payouts.find((p) => p.user_id === miUserId);
  const total = payouts.reduce((s, p) => s + p.amount_cop, 0);

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
          <div className="lp-money mt-1 text-[46px] leading-none text-gold">
            {formatCop(miPremio.amount_cop)}
          </div>
          {miPremio.points != null && (
            <p className="mt-2 text-[13px] text-text-secondary">
              {miPremio.points} puntos
              {payouts.length > 1 && ` · empataste con ${payouts.length - 1} más`}
            </p>
          )}
          <p className="mt-4 border-t border-border-subtle pt-4 text-[12px] leading-relaxed text-text-muted">
            {miPremio.paid_at
              ? "Ya te transferimos. Si no te llegó, escríbenos."
              : "La casa te transfiere a la cuenta que tengas registrada en tu perfil. Revísala para que el pago no se demore."}
          </p>
          {!miPremio.paid_at && (
            <Link href="/perfil" className="lp-btn lp-btn-ghost mt-3 w-full">
              Revisar mi cuenta de pago
            </Link>
          )}
        </StreetCard>
      ) : (
        <StreetCard className="bg-bg-card p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="lp-display-sm text-text-primary">
              {payouts.length === 1 ? "Ganador" : "Ganadores"}
            </h2>
            <span className="lp-money text-[16px] text-gold">
              {formatCop(total)}
            </span>
          </div>
          <ul className="mt-3 space-y-2">
            {payouts.map((p) => (
              <li key={p.user_id} className="flex items-center gap-3">
                {p.avatar_url && (
                  <Image
                    src={p.avatar_url}
                    alt=""
                    aria-hidden="true"
                    width={28}
                    height={28}
                    className="h-7 w-7 max-w-none shrink-0 rounded-full object-contain"
                  />
                )}
                <span className="min-w-0 flex-1 truncate text-[14px] text-text-primary">
                  {p.display_name ?? "Sin nombre"}
                </span>
                <span className="lp-money shrink-0 text-[15px] text-text-secondary">
                  {formatCop(p.amount_cop)}
                </span>
              </li>
            ))}
          </ul>
        </StreetCard>
      )}
    </div>
  );
}

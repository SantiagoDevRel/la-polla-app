// app/(app)/casa/[slug]/page.tsx — el detalle de una polla.
//
// Tres estados que la pantalla tiene que resolver bien:
//   1. No estás inscrito  → el CTA es pagar.
//   2. Pagaste, falta que Tama confirme → podés ir marcando, pero se avisa
//      claro que todavía no contás para el pozo.
//   3. Estás dentro → marcás y ves la tabla.

import Link from "next/link";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
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
} from "@/lib/casa/queries";
import { isPollaOpen, pollaStatusLabel, type Pick1x2 } from "@/lib/casa/types";
import { formatCop, timeLeft } from "@/lib/casa/format";
import { getTournamentLogo, getTournamentName } from "@/lib/tournaments";
import { HeroFrame, Label, SectionHead, StreetCard, Tape } from "@/components/street";
import { PicksBoard } from "@/components/casa/PicksBoard";
import { QuestionsBoard } from "@/components/casa/QuestionsBoard";

export const dynamic = "force-dynamic";

export default async function PollaPage({
  params,
}: {
  params: { slug: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?returnTo=/casa/${params.slug}`);

  const polla = await getPollaBySlug(params.slug);
  if (!polla || polla.status === "borrador") notFound();

  const [pot, entry, matches, questions, picks, distribution, tabla] =
    await Promise.all([
      getPot(polla.id),
      getMyEntry(polla.id, user.id),
      polla.kind === "partidos" ? getPollaMatches(polla.id) : Promise.resolve([]),
      polla.kind === "manual" ? getPollaQuestions(polla.id) : Promise.resolve([]),
      getMyPicks(polla.id, user.id),
      getDistribution(polla.id),
      getLeaderboard(polla.id),
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
        {/* ── Cómo se reparte. Que la casa se quede el 30% tiene que estar
              escrito, no escondido: es plata de la gente. ─────────────── */}
        <StreetCard className="p-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Entrada</Label>
              <div className="lp-money mt-1 text-[17px] text-text-primary">
                {formatCop(polla.entry_price_cop)}
              </div>
            </div>
            <div>
              <Label>A los ganadores</Label>
              <div className="lp-money mt-1 text-[17px] text-text-primary">
                {100 - polla.house_cut_pct}%
              </div>
            </div>
            <div>
              <Label>A la casa</Label>
              <div className="lp-money mt-1 text-[17px] text-text-secondary">
                {polla.house_cut_pct}%
              </div>
            </div>
          </div>
          {polla.prize_object && (
            <p className="mt-3 border-t border-border-subtle pt-3 text-[13px] text-text-secondary">
              <span className="lp-label mr-2 inline">Además</span>
              {polla.prize_object}
            </p>
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

import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPollaById, getPollaMatches, getPollaQuestions } from "@/lib/casa/queries";
import { acceptsCasaMatchPicks } from "@/lib/casa/match-rules";
import { isPollaOpen } from "@/lib/casa/types";
import type { PickSaveState } from "@/lib/casa/picks-protocol";
import { getPollitoBase } from "@/lib/pollitos";
import { PicksBoard, type BoardPick } from "@/components/casa/PicksBoard";
import { QuestionsBoard } from "@/components/casa/QuestionsBoard";
import { AdminPlayerSelector } from "@/components/casa/AdminPlayerSelector";

export const dynamic = "force-dynamic";
interface Player { id: string; name: string; avatar: string | null; selected: boolean; conflict: boolean }

export default async function AdminPlayerView({ params }: { params: Promise<{ id: string; userId: string }> }) {
  const actor = await getAuthenticatedUser();
  if (!actor?.is_admin) notFound();
  const { id, userId } = await params;
  if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(userId).success) notFound();
  const db = createAdminClient();
  const [polla, roster] = await Promise.all([
    getPollaById(id), db.rpc("casa_get_admin_players", { p_polla_id: id, p_actor_id: actor.id }),
  ]);
  if (roster.error) throw new Error("No se pudo cargar la vista del jugador.");
  const player = (roster.data?.players as Player[] | undefined)?.find(p => p.id === userId);
  if (!polla || !player) notFound();
  const canView = player.selected && !player.conflict && polla.kind !== "rifa";
  const [stateResult, matches, questions] = canView ? await Promise.all([
    db.rpc("casa_admin_player_pick_state", { p_polla_id: id, p_user_id: userId, p_actor_id: actor.id }),
    polla.kind === "partidos" ? getPollaMatches(id) : Promise.resolve([]),
    polla.kind === "manual" ? getPollaQuestions(id) : Promise.resolve([]),
  ]) : [null, [], []];
  if (stateResult?.error) throw new Error("No se pudo confirmar la inscripción y los pronósticos del jugador. Vuelve a abrir esta vista.");
  const state = stateResult?.data as (PickSaveState & { entryNumber: number }) | null;
  const matchPicks: Record<string, BoardPick> = {};
  const questionPicks: Record<string, { optionId: string | null; freeText: string | null }> = {};
  for (const [target, pick] of Object.entries(state?.picks ?? {})) {
    matchPicks[target] = { pick1x2: pick.pick1x2 ?? null, homeScore: pick.homeScore ?? null, awayScore: pick.awayScore ?? null, pointsEarned: pick.pointsEarned };
    questionPicks[target] = { optionId: pick.optionId ?? null, freeText: pick.freeText ?? null };
  }
  const endpoint = `/api/casa/admin/pollas/${id}/jugadores/${userId}/picks`;
  const canEdit = polla.kind === "partidos" ? acceptsCasaMatchPicks(polla.status, polla.draw_pending) : isPollaOpen(polla);
  return (
    <div className="pb-32">
      <header className="mx-4 mb-4 space-y-3 rounded-lg border border-border-subtle bg-bg-card/80 p-4 backdrop-blur-sm">
        <Link href={`/polla/${polla.slug}`} className="inline-flex min-h-11 items-center rounded-full px-3 text-[15px] text-text-secondary transition-colors duration-200 hover:bg-bg-elevated hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-turf">Volver a {polla.name}</Link>
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={getPollitoBase(player.avatar)} alt="" width={48} height={48} className="h-12 w-12 max-w-none shrink-0 object-contain" />
          <div className="min-w-0 [overflow-wrap:anywhere]">
            <h1 className="font-display text-[32px] leading-tight tracking-wide text-text-primary">Vista de {player.name}</h1>
            <p className="text-[13px] text-text-secondary">Solo administradores · {polla.name}</p>
          </div>
        </div>
        <p className="text-[15px] leading-relaxed text-text-secondary">Los pronósticos que guardes en esta vista pertenecen a {player.name}. Tu sesión de administrador sigue activa.</p>
      </header>
      <AdminPlayerSelector key={`${id}:${userId}`} pollaId={id} viewedPlayerId={userId} />
      {!state ? <p className="mx-4 rounded-lg border border-border-subtle bg-bg-card/80 p-4 text-[15px] leading-relaxed text-text-secondary">
        {polla.kind === "rifa" ? "Esta rifa no requiere pronósticos." : player.conflict ? "Esta inscripción se gestiona fuera del selector. No puedes modificarla desde esta vista." : "Primero inscribe al jugador en Jugadores de la casa. Después vuelve a abrir su vista para pronosticar."}
      </p> : <div className="mx-4">
        {polla.kind === "partidos" ? <PicksBoard key={state.entryId} slug={polla.slug} saveEndpoint={endpoint}
          ownerId={userId} entryId={state.entryId} entryNumber={state.entryNumber} initialRevision={state.revision}
          scoringMode={polla.scoring_mode ?? "marcador"} matches={matches} initialPicks={matchPicks}
          distribution={{ resultado: {}, marcador: {}, preguntas: {} }} canEdit={canEdit} canViewOthers={false}
          lockedReason="Los pronósticos están cerrados. Puedes consultar los guardados." />
          : <QuestionsBoard key={state.entryId} slug={polla.slug} saveEndpoint={endpoint}
            ownerId={userId} entryId={state.entryId} entryNumber={state.entryNumber} initialRevision={state.revision}
            questions={questions} initialPicks={questionPicks} distribution={{ resultado: {}, marcador: {}, preguntas: {} }} canEdit={canEdit}
            lockedReason="Los pronósticos están cerrados. Puedes consultar los guardados." />}
      </div>}
    </div>
  );
}

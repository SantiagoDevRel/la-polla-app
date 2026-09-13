import { Clock3, Eye, Trophy, Target, Ban, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import type { CasaPolla } from "@/lib/casa/types";
import { PayoutAccountButton } from "./PayoutAccountButton";

type Rules = Pick<CasaPolla, "kind" | "scoring_mode" | "points_exact" | "points_one_team" | "points_result" | "prize_kind" | "prize_object" | "description" | "draw_method" | "pot_mode">;

function Rule({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return <section className="lp-card p-4">
    <div className="mb-2 flex items-center gap-2 text-text-primary">
      <span className="shrink-0" aria-hidden>{icon}</span>
      <h3 className="font-display text-[20px] leading-tight tracking-[0.04em]">{title}</h3>
    </div>
    <div className="space-y-2 text-[15px] font-normal leading-relaxed text-text-secondary [overflow-wrap:anywhere]">{children}</div>
  </section>;
}

function points(value: number) { return `${value} ${value === 1 ? "punto" : "puntos"}`; }

/** Only the rules and scoring values configured for this polla are described. */
export function PollaInfo({ polla }: { polla: Rules }) {
  const money = polla.prize_kind !== "objeto";
  return <div className="space-y-4 pt-5">
    <h2 className="font-display text-[24px] leading-tight tracking-[0.04em]">Info de esta polla</h2>
    {polla.description && <p className="whitespace-pre-line text-[15px] leading-relaxed text-text-secondary [overflow-wrap:anywhere]">{polla.description}</p>}
    {polla.kind === "partidos" && <Rule icon={<Target size={20} />} title="Cómo sumas puntos">
      {polla.scoring_mode === "marcador" ? <>
        <p><strong className="font-semibold text-text-primary">Marcador exacto: {points(polla.points_exact)}.</strong> Debes acertar los goles de ambos equipos.</p>
        <p><strong className="font-semibold text-text-primary">Goles de un solo equipo: {points(polla.points_one_team)}.</strong> Si aciertas los goles de uno de los equipos, pero no el marcador completo.</p>
        <p>Estos puntajes no se suman entre sí. Sin aciertos, recibes 0 puntos.</p>
      </> : <>
        <p><strong className="font-semibold text-text-primary">Acertar el resultado: {points(polla.points_result)}.</strong> Elige si gana el local, hay empate o gana el visitante.</p>
        <p>Si no aciertas, recibes 0 puntos.</p>
      </>}
    </Rule>}
    {polla.kind === "manual" && <Rule icon={<Target size={20} />} title="Cómo sumas puntos"><p>Cada pregunta indica cuántos puntos ganas si aciertas. Una respuesta incorrecta suma 0 puntos.</p></Rule>}
    <Rule icon={<Trophy size={20} />} title="Premio y ganadores">
      {money && polla.pot_mode === "fijo" && <p>El pozo es fijo: el premio anunciado se mantiene sin importar cuántas personas participen.</p>}
      {polla.kind !== "rifa" && <p>Debes sumar al menos un punto para ganar. Si todos terminan con 0 puntos, no se adjudica el premio.</p>}
      {polla.kind === "rifa" ? <><p>Gana la boleta que coincida con el número del sorteo anunciado.</p>{polla.draw_method && <p>{polla.draw_method}</p>}</> : money ? <p>Gana quien obtenga el mayor puntaje. Si varias personas empatan en el primer puesto, el pozo completo se divide en partes iguales entre ellas. Los pesos sobrantes del redondeo también se entregan a los ganadores.</p> : <p>El premio es {polla.prize_object}. Gana quien obtenga el mayor puntaje. Si hay empate en el primer puesto, realizaremos un sorteo entre los empatados. El objeto no se divide ni se convierte en dinero.</p>}
    </Rule>
    {polla.kind === "partidos" && <>
      <Rule icon={<Ban size={20} />} title="Si se suspende un partido"><p>Si el partido se suspende después de haber empezado, se anula para esta polla y todos reciben 0 puntos, aunque se reanude después.</p><p>Un aplazamiento antes de empezar conserva el partido y sus pronósticos para la nueva fecha.</p></Rule>
      <Rule icon={<Clock3 size={20} />} title="Marcador válido"><p>Solo cuenta el marcador de los 90 minutos más el tiempo de adición. Los goles del alargue y la tanda de penales no cuentan.</p></Rule>
      <Rule icon={<Clock3 size={20} />} title="Hasta cuándo puedes pronosticar"><p>Cada partido se cierra 5 minutos antes de su hora de inicio. Desde ese momento no puedes agregar ni cambiar su pronóstico.</p><p>El cierre de inscripciones no cambia ese plazo para quienes ya están inscritos.</p></Rule>
      <Rule icon={<Eye size={20} />} title="Pronósticos de otros jugadores"><p>Puedes verlos en «Ver pronósticos de otros» dentro de cada partido, solo cuando el partido ya haya empezado. Antes del inicio permanecen privados.</p></Rule>
    </>}
    {money && <Rule icon={<Wallet size={20} />} title="¿Cómo me pagan?"><p>Llena tu cuenta de pago para enviarte el dinero allí si ganas. Puedes registrar tu Nequi o tu cuenta de Bancolombia.</p><PayoutAccountButton /></Rule>}
    {!money && <Rule icon={<Wallet size={20} />} title="Cómo recibes tu premio"><p>Si ganas, el administrador coordinará contigo la entrega del objeto.</p></Rule>}
  </div>;
}

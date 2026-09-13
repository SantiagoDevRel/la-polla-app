import { Ban, ChevronDown, Clock3, Eye, Target, Timer, Trophy, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { LOCK_MINUTES, type CasaPolla } from "@/lib/casa/types";
import { formatCop } from "@/lib/casa/format";
import { PayoutAccountButton } from "./PayoutAccountButton";

type Rules = Pick<CasaPolla, "kind" | "scoring_mode" | "points_exact" | "points_one_team" | "points_result" | "prize_kind" | "prize_object" | "description" | "draw_method" | "pot_mode" | "fixed_prize_cop" | "house_cut_pct">;

/** Punto de equilibrio del premio fijo, calculado en SQL por getFixedPrizeThreshold. */
export interface FixedPrizeThreshold { entriesToCover: number | null; entryPrizeCop: number }

/**
 * Una regla = un desplegable cerrado con viñetas cortas.
 *
 * (2026-09-13) Antes eran siete tarjetas abiertas con párrafos largos y había
 * que bajar mucho para encontrar lo que interesaba. El dueño pidió viñetas
 * cortas y abrir solo la que uno quiere ver. `<details>` funciona sin
 * JavaScript, con teclado y con lector de pantalla.
 */
function Rule({ icon, title, children, extra }: { icon: ReactNode; title: string; children: ReactNode; extra?: ReactNode }) {
  return <details className="lp-card overflow-hidden">
    <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 text-text-primary transition-colors hover:bg-bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold [&::-webkit-details-marker]:hidden">
      <span className="shrink-0 text-text-secondary" aria-hidden>{icon}</span>
      <h3 className="min-w-0 flex-1 font-display text-[20px] leading-tight tracking-[0.04em] [overflow-wrap:anywhere]">{title}</h3>
      {/* `group-open:` no se genera con el Tailwind/postcss fijado en el lock; la variante arbitraria sí. */}
      <ChevronDown aria-hidden="true" className="h-5 w-5 shrink-0 text-text-secondary transition-transform duration-200 [[open]>summary>&]:rotate-180" />
    </summary>
    <div className="border-t border-border-subtle px-4 pb-4 pt-3">
      <ul className="list-disc space-y-2 pl-5 text-[15px] font-normal leading-relaxed text-text-secondary marker:text-text-muted [overflow-wrap:anywhere]">{children}</ul>
      {extra}
    </div>
  </details>;
}

function points(value: number) { return `${value} ${value === 1 ? "punto" : "puntos"}`; }

function Strong({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-text-primary">{children}</strong>;
}

/** Only the rules and scoring values configured for this polla are described. */
export function PollaInfo({ polla, threshold = null }: { polla: Rules; threshold?: FixedPrizeThreshold | null }) {
  const money = polla.prize_kind !== "objeto";
  const minimo = money && polla.pot_mode === "fijo" && typeof polla.fixed_prize_cop === "number" ? polla.fixed_prize_cop : null;
  // Pedido del dueño (2026-09-13): decir cuántas personas cubren el mínimo y
  // cuánto crece el pozo por cada una de ahí en adelante, en vez de explicar
  // el porcentaje. Ambas cifras vienen de SQL; si faltan, la línea no sale.
  const crece = minimo !== null && threshold?.entriesToCover != null && threshold.entryPrizeCop > 0 ? threshold : null;

  return <div className="space-y-3 pt-5">
    <h2 className="font-display text-[24px] leading-tight tracking-[0.04em]">Info de esta polla</h2>
    {polla.description && <p className="whitespace-pre-line text-[15px] leading-relaxed text-text-secondary [overflow-wrap:anywhere]">{polla.description}</p>}

    {polla.kind === "partidos" && <Rule icon={<Target size={20} />} title="Cómo sumas puntos">
      {polla.scoring_mode === "marcador" ? <>
        <li><Strong>Marcador exacto:</Strong> {points(polla.points_exact)}.</li>
        <li><Strong>Goles de un solo equipo:</Strong> {points(polla.points_one_team)}.</li>
        <li>No se suman entre sí. Sin aciertos, 0 puntos.</li>
      </> : <>
        <li>Eliges si gana el local, hay empate o gana el visitante.</li>
        <li><Strong>Si aciertas:</Strong> {points(polla.points_result)}. Si no, 0 puntos.</li>
      </>}
    </Rule>}
    {polla.kind === "manual" && <Rule icon={<Target size={20} />} title="Cómo sumas puntos">
      <li>Cada pregunta indica cuántos puntos vale.</li>
      <li>Una respuesta incorrecta suma 0 puntos.</li>
    </Rule>}

    <Rule icon={<Trophy size={20} />} title="Premio y ganadores">
      {minimo !== null && <li><Strong>Premio mínimo garantizado:</Strong> {formatCop(minimo)}.</li>}
      {crece && <li>
        Si más de {crece.entriesToCover} {crece.entriesToCover === 1 ? "persona se inscribe" : "personas se inscriben"}, el pozo crece <Strong>{formatCop(crece.entryPrizeCop)}</Strong> por cada persona adicional.
      </li>}
      {polla.kind === "rifa" ? <>
        <li>Gana la boleta que coincida con el número del sorteo anunciado.</li>
        {polla.draw_method && <li>{polla.draw_method}</li>}
      </> : money ? <>
        <li>Gana quien sume más puntos.</li>
        <li>Si hay empate en el primer puesto, el pozo se divide en partes iguales, incluidos los pesos del redondeo.</li>
      </> : <>
        <li>El premio es {polla.prize_object}. Gana quien sume más puntos.</li>
        <li>Si hay empate en el primer puesto, se sortea entre los empatados.</li>
        <li>El premio no se divide ni se cambia por dinero.</li>
      </>}
      {polla.kind !== "rifa" && <li>Necesitas al menos 1 punto para ganar. Si todos terminan con 0, no se entrega el premio.</li>}
    </Rule>

    {polla.kind === "partidos" && <>
      <Rule icon={<Clock3 size={20} />} title="Hasta cuándo puedes pronosticar">
        <li>Cada partido se cierra {LOCK_MINUTES} minutos antes de empezar.</li>
        <li>Desde ese momento no puedes agregar ni cambiar su pronóstico.</li>
        <li>El cierre de inscripciones no cambia ese plazo.</li>
      </Rule>
      <Rule icon={<Timer size={20} />} title="Qué marcador cuenta">
        <li>Los 90 minutos más el tiempo de adición.</li>
        <li>No cuentan el alargue ni los penales.</li>
      </Rule>
      <Rule icon={<Ban size={20} />} title="Si se suspende un partido">
        <li>Si se suspende, aplaza, cancela o abandona, lo revisa la administración.</li>
        <li>Puede anularlo (0 puntos para todos en ese partido) o mantenerlo si se juega.</li>
      </Rule>
      <Rule icon={<Eye size={20} />} title="Pronósticos de otros jugadores">
        <li>Los ves en «Ver pronósticos de otros» cuando empieza cada partido.</li>
        <li>Antes del inicio son privados.</li>
      </Rule>
    </>}

    {money
      ? <Rule icon={<Wallet size={20} />} title="¿Cómo me pagan?" extra={<PayoutAccountButton />}>
        <li>Si ganas, te enviamos el dinero a tu Nequi o a tu cuenta de Bancolombia.</li>
        <li>Registra tu cuenta de pago para que el pago no se demore.</li>
      </Rule>
      : <Rule icon={<Wallet size={20} />} title="Cómo recibes tu premio">
        <li>Si ganas, el administrador coordina contigo la entrega.</li>
      </Rule>}
  </div>;
}

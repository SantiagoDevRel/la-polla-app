import { Ban, ChevronDown, Clock3, CreditCard, Eye, Gift, Target, Timer, Trophy, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { LOCK_MINUTES, type CasaPolla } from "@/lib/casa/types";
import { formatCop } from "@/lib/casa/format";
import { REFERRAL_FINE_PRINT, referralEvery } from "@/lib/casa/referrals-shared";
import { PayoutAccountButton } from "./PayoutAccountButton";
import { FixedPrizeGrowth, fixedPrizeGrows, type FixedPrizeThreshold } from "./FixedPrizeGrowth";

export type { FixedPrizeThreshold };

type Rules = Pick<CasaPolla, "kind" | "scoring_mode" | "points_exact" | "points_one_team" | "points_result" | "prize_kind" | "prize_object" | "description" | "draw_method" | "pot_mode" | "fixed_prize_cop" | "house_cut_pct">
  & Partial<Pick<CasaPolla, "entry_price_cop" | "referral_every">>;

/**
 * Una regla = un desplegable cerrado con viñetas cortas.
 *
 * (2026-09-13) Antes eran siete tarjetas abiertas con párrafos largos y había
 * que bajar mucho para encontrar lo que interesaba. El dueño pidió viñetas
 * cortas y abrir solo la que uno quiere ver. `<details>` funciona sin
 * JavaScript, con teclado y con lector de pantalla.
 */
function Rule({ icon, title, children, extra, plain = false }: { icon: ReactNode; title: string; children: ReactNode; extra?: ReactNode; plain?: boolean }) {
  return <details className="lp-card overflow-hidden">
    <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 text-text-primary transition-colors hover:bg-bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold [&::-webkit-details-marker]:hidden">
      <span className="shrink-0 text-text-secondary" aria-hidden>{icon}</span>
      <h3 className="min-w-0 flex-1 font-display text-[20px] leading-tight tracking-[0.04em] [overflow-wrap:anywhere]">{title}</h3>
      {/* `group-open:` no se genera con el Tailwind/postcss fijado en el lock; la variante arbitraria sí. */}
      <ChevronDown aria-hidden="true" className="h-5 w-5 shrink-0 text-text-secondary transition-transform duration-200 [[open]>summary>&]:rotate-180" />
    </summary>
    <div className="border-t border-border-subtle px-4 pb-4 pt-3">
      {/* `plain`: una frase sin viñetas (invitaciones, pedido del dueño 2026-09-17). */}
      {plain
        ? <div className="space-y-2 text-[15px] font-normal leading-relaxed text-text-secondary [overflow-wrap:anywhere]">{children}</div>
        : <ul className="list-disc space-y-2 pl-5 text-[15px] font-normal leading-relaxed text-text-secondary marker:text-text-muted [overflow-wrap:anywhere]">{children}</ul>}
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
  // Invitaciones (migración 135): la regla sale del número guardado en la polla.
  const cadaInvitados = referralEvery({ kind: polla.kind, entry_price_cop: polla.entry_price_cop ?? 0, referral_every: polla.referral_every });

  return <div className="space-y-3 pt-5">
    <h2 className="font-display text-[24px] leading-tight tracking-[0.04em]">Info de esta polla</h2>
    {polla.description && <p className="whitespace-pre-line text-[15px] leading-relaxed text-text-secondary [overflow-wrap:anywhere]">{polla.description}</p>}

    {polla.kind === "partidos" && <Rule icon={<Target size={20} />} title="Cómo sumas puntos">
      {polla.scoring_mode === "marcador" ? (polla.points_one_team > 0 ? <>
        {/* Pollas creadas antes de la migración 132: conservan su punto por un solo equipo. */}
        <li><Strong>Marcador exacto:</Strong> {points(polla.points_exact)}.</li>
        <li><Strong>Goles de un solo equipo:</Strong> {points(polla.points_one_team)}.</li>
        <li>No se suman entre sí. Sin aciertos, 0 puntos.</li>
      </> : <>
        {/* Regla desde el 2026-09-16: solo el marcador exacto. */}
        <li><Strong>Solo el marcador exacto suma:</Strong> {points(polla.points_exact)}.</li>
        <li><Strong>Cualquier otro resultado:</Strong> 0 puntos, aunque aciertes los goles de un equipo o quién gana.</li>
      </>) : <>
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
      {minimo !== null && fixedPrizeGrows(threshold) && <li><FixedPrizeGrowth threshold={threshold} /></li>}
      {polla.kind === "rifa" ? <>
        <li>Gana la boleta que coincida con el número del sorteo anunciado.</li>
        {polla.draw_method && <li>{polla.draw_method}</li>}
      </> : money ? <>
        <li>Gana quien sume más puntos.</li>
        <li>Si hay empate en el primer puesto, el pozo se divide en partes iguales, incluidos los pesos del redondeo.</li>
      </> : <>
        <li>El premio es {polla.prize_object}. Gana quien sume más puntos.</li>
        {/* (2026-09-18, migración 142) Antes decía «se sortea entre los empatados».
            El dueño cambió el desempate por uno determinista: el premio es un
            objeto que no se parte, y el orden de registro ya está guardado y
            visible en la tabla, así que cualquiera puede verificar quién ganó. */}
        <li><Strong>Si hay empate en el primer puesto, gana la persona que se haya registrado primero en la polla.</Strong> La fecha y la hora de registro de cada participante están en la tabla de posiciones.</li>
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

    {cadaInvitados !== null && <Rule icon={<Gift size={20} />} title="Invita y gana cupos" plain>
      <p><Strong>{cadaInvitados === 1 ? "Por cada invitado" : `Por cada ${cadaInvitados} invitados`}, te damos un cupo en esta polla.</Strong></p>
      <p className="text-[13px] italic text-text-muted">{REFERRAL_FINE_PRINT}</p>
    </Rule>}

    {/* (2026-09-18) Cómo se PAGA la entrada y cómo se COBRA el premio son dos
        cosas distintas, y hasta hoy solo estaba la segunda — con el título
        «¿Cómo me pagan?». Quien abría Info buscando dónde pagar terminaba
        viendo su propia cuenta para recibir dinero. */}
    {/* (2026-09-18, migración 143) Con entrada gratis no hay nada que pagar:
        pedir el comprobante de una transferencia de $0 no tenía sentido. */}
    {polla.kind !== "rifa" && (polla.entry_price_cop === 0 ? <Rule icon={<CreditCard size={20} />} title="Cómo entras">
      <li><Strong>Entrar es gratis.</Strong> No transfieres nada ni subes comprobante.</li>
      <li>Tocas «Unirme» y quedas registrado de una vez, con un cupo.</li>
      <li>Desde ese momento puedes pronosticar y tus puntos cuentan en la tabla.</li>
    </Rule> : <Rule icon={<CreditCard size={20} />} title="Cómo se paga la entrada">
      {typeof polla.entry_price_cop === "number" && <li>Transfieres <Strong>{formatCop(polla.entry_price_cop)}</Strong> a la cuenta que aparece en el botón de pagar, por Nequi o transferencia.</li>}
      <li>Subes la foto del comprobante en la app. No se cobra nada automáticamente ni pedimos datos bancarios.</li>
      <li>Puedes pronosticar desde que lo subes; tus puntos entran a la tabla cuando confirmamos el pago.</li>
      <li>Cada cupo es una transferencia aparte, con su propio comprobante.</li>
    </Rule>)}

    {money
      ? <Rule icon={<Wallet size={20} />} title="Cómo recibes tu premio si ganas" extra={<PayoutAccountButton />}>
        <li>Si ganas, te enviamos el dinero a tu Nequi o a tu cuenta de Bancolombia.</li>
        <li>Registra tu cuenta de pago para que el pago no se demore.</li>
      </Rule>
      : <Rule icon={<Wallet size={20} />} title="Cómo recibes tu premio">
        <li>Si ganas, el administrador coordina contigo la entrega.</li>
      </Rule>}
  </div>;
}

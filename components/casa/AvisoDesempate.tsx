// components/casa/AvisoDesempate.tsx — la regla que decide la polla, a la vista.
//
// (2026-09-18) Pedido del dueño: un aviso resaltado en amarillo, en la mitad de
// la pantalla, con el mismo peso que «Ya estás dentro». La razón es de fondo:
// con `scoring_mode='marcador'` y solo el marcador exacto sumando, el puntaje
// ganador es 1 o 2 aciertos y el empate arriba es el caso NORMAL — OFIGOLAZO,
// con 43 inscritos, terminó con tres personas empatadas en el primer puesto.
// Un premio que no se parte se decide entonces por el orden de registro, así
// que esa regla no puede vivir en la letra menuda de la Info.
//
// Solo aparece donde manda: premio en objeto, que es cuando no se puede
// dividir. En una polla de dinero el pozo se reparte y esto sería mentira.

import { Trophy } from "lucide-react";

export function AvisoDesempate() {
  return (
    <div
      role="note"
      className="mt-4 border border-gold/45 bg-gold/10 p-4 shadow-[0_0_20px_rgba(255,215,0,0.10)] first:mt-0"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-gold/45 text-gold">
          <Trophy aria-hidden="true" className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-[19px] uppercase leading-tight tracking-[0.04em] text-gold [overflow-wrap:anywhere]">
            En caso de empate, el premio se le dará a la persona que se haya registrado antes en esta polla
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-text-secondary [overflow-wrap:anywhere]">
            {/* El ejemplo con horas es del dueño: es lo que hace entendible la regla
                sin leer nada más. El nombre del premio NO se mete en la frase —
                escrito en mayúsculas y con paréntesis queda ilegible aquí. */}
            Si alguien se registró a las 9:00 a. m. y otra persona a las 10:00 a. m., y quedan empatados, el premio
            es para quien se registró a las 9:00 a. m. Solo en caso de empate. La fecha y la hora de registro de
            cada participante están en la tabla de posiciones.
          </p>
        </div>
      </div>
    </div>
  );
}

export default AvisoDesempate;

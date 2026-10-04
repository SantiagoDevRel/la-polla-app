// Solo para premios en objeto: el desempate no aplica al pozo de dinero.
// Todas las variantes empiezan cerradas, también antes de inscribirse y en
// el enlace compartido. La regla completa y su ejemplo se abren con un toque.

import { ChevronDown, Trophy } from "lucide-react";

const REGLA = "En caso de empate, el premio se le dará a la persona que se haya registrado primero en esta polla";

function Ejemplo() {
  return (
    <p className="mt-2 text-[13px] leading-relaxed text-text-secondary [overflow-wrap:anywhere]">
      {/* El ejemplo con horas es del dueño: es lo que hace entendible la regla
          sin leer nada más. El nombre del premio NO se mete en la frase —
          escrito en mayúsculas y con paréntesis queda ilegible aquí. */}
      Si alguien se registró a las 9:00 a. m. y otra persona a las 10:00 a. m., y quedan empatados, el premio
      es para quien se registró a las 9:00 a. m. Solo en caso de empate. La fecha y la hora de registro de
      cada participante están en la tabla de posiciones.
    </p>
  );
}

export function AvisoDesempate({ compact = false }: { compact?: boolean }) {
  return (
    <details data-tiebreak-notice={compact ? "compact" : "default"} className="mt-4 overflow-hidden rounded-md border border-border-subtle bg-bg-base/30 first:mt-0">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2.5 px-3 py-2.5 text-text-primary transition-colors hover:bg-bg-elevated active:bg-bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold [&::-webkit-details-marker]:hidden">
        <Trophy aria-hidden="true" className="h-5 w-5 max-w-none shrink-0 text-text-secondary" />
        <span className="min-w-0 flex-1 text-[15px] font-semibold leading-snug [overflow-wrap:anywhere]">
          Si hay empate, gana quien se registró primero en esta polla
        </span>
        <ChevronDown aria-hidden="true" className="h-5 w-5 max-w-none shrink-0 text-text-secondary transition-transform duration-200 [[open]>summary>&]:rotate-180" />
      </summary>
      <div className="border-t border-border-subtle px-3 pb-3 pt-2">
        <p className="text-[15px] font-semibold leading-snug text-text-primary [overflow-wrap:anywhere]">{REGLA}.</p>
        <Ejemplo />
      </div>
    </details>
  );
}

export default AvisoDesempate;

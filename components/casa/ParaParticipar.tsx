// components/casa/ParaParticipar.tsx — la puerta de entrada a una polla.
//
// (2026-09-18) Pedido del dueño: «he escuchado comentarios que dicen no sé
// dónde pagar». Y tenía razón: hasta hoy el único lugar donde aparecía la
// cuenta a la que hay que transferir era /casa/<slug>/pagar, otra pantalla, a
// la que se llegaba por un botón que decía «Entrar por $20.000» y que compartía
// fila y peso con «Compartir». Quien no había pagado nunca no tenía forma de
// saber qué iba a pasar al tocarlo.
//
// Esto NO es un modal: el dueño pidió expresamente que los partidos, la tabla y
// la info se sigan viendo sin pagar. Es una tarjeta fija entre el hero y las
// pestañas, con los tres pasos, la cuenta a la vista y un solo botón dorado.
//
// (2026-09-18, más tarde) «La gente no lee»: el párrafo de entrada decía lo
// mismo que los tres pasos, y los pasos eran tres renglones. Ahora los pasos son
// una fila de tres números con dos palabras cada uno, la cuenta sigue a la vista
// y el detalle completo está a un toque en Info → «Cómo se paga la entrada».

import Link from "next/link";
import { StreetCard } from "@/components/street";
import { formatCop } from "@/lib/casa/format";
import type { CasaPolla } from "@/lib/casa/types";
import { CopiarDato } from "./CopiarDato";
import { VerMasInfo } from "./VerMasInfo";

export function ParaParticipar({ polla, href, retomar = false }: {
  polla: Pick<CasaPolla, "slug" | "entry_price_cop" | "payout_account" | "payout_account_name" | "payout_method">;
  href: string;
  /** Ya empezó y se le cayó el comprobante: el paso 1 puede estar hecho. */
  retomar?: boolean;
}) {
  const entrada = formatCop(polla.entry_price_cop);
  return (
    <StreetCard className="mt-4 border-gold/30 p-4 first:mt-0">
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <h2 className="lp-display-sm text-text-primary">{retomar ? "Te falta el comprobante" : "Para participar"}</h2>
        <VerMasInfo section="entrada" />
      </div>
      {/* Los tres pasos, de un vistazo. Con texto ampliado cada paso baja de línea
          dentro de su columna en vez de salirse. */}
      <ol className="mt-2 grid grid-cols-3 gap-2 text-center text-[13px] font-semibold leading-tight text-text-primary">
        {[`Transfiere ${entrada}`, "Sube el comprobante", "Pronostica"].map((paso, i) => (
          <li key={paso} className={`flex min-w-0 flex-col items-center gap-1 [overflow-wrap:anywhere] ${retomar && i === 0 ? "opacity-50" : ""}`}>
            <span aria-hidden="true" className="lp-money grid h-[28px] w-[28px] shrink-0 place-items-center rounded-full border border-border-strong bg-bg-elevated text-[15px] text-text-primary">{i + 1}</span>
            <span className="w-full">{paso}</span>
          </li>
        ))}
      </ol>

      {/* La cuenta, acá mismo. Antes había que cruzar a otra pantalla para
          saber a quién transferirle: ese era el «no sé dónde pagar». */}
      {polla.payout_account ? (
        <div className="mt-3 rounded-lg border border-border-default bg-bg-elevated p-3">
          <span className="lp-label">Transfiere a {(polla.payout_method ?? "").toUpperCase()}</span>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <span id="copiar-cuenta-polla" className="lp-money min-w-0 select-all text-[24px] leading-none text-text-primary [overflow-wrap:anywhere]">
              {polla.payout_account}
            </span>
            <CopiarDato valor={polla.payout_account} etiqueta="cuenta-polla" nombre="la cuenta" />
          </div>
          {polla.payout_account_name && (
            <p className="mt-2 text-[13px] text-text-secondary">
              A nombre de <span className="text-text-primary">{polla.payout_account_name}</span>
            </p>
          )}
        </div>
      ) : (
        <div className="mt-3 border border-red-alert/40 bg-red-alert/10 p-3">
          <p className="lp-label text-red-alert">Falta la cuenta de cobro</p>
          <p className="mt-1 text-[13px] text-text-secondary">
            Esta polla todavía no tiene cuenta de cobro. Avisa al administrador antes de transferir dinero.
          </p>
        </div>
      )}

      <Link href={href} className="lp-btn lp-btn-primary mt-4 w-full !px-4">
        {retomar ? "Subir el comprobante" : `Pagar la entrada · ${entrada}`}
      </Link>
    </StreetCard>
  );
}

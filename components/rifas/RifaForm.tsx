"use client";
// components/rifas/RifaForm.tsx — formulario de «Crear mi rifa».
//
// Campos del spec: visibilidad (Privada por defecto), nombre, premio en dinero
// o texto, cantidad de números (hasta 100), valor por número, lotería con
// sugerencias y qué cifras cuentan, fecha y hora del sorteo en Colombia (que
// es también el cierre) y la cuenta donde el creador recibe los pagos.
// Las validaciones de verdad las repite SQL (rifa_create_v1).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ColombiaDateTimeField } from "@/components/casa/ColombiaDateTimeField";
import { StreetCard } from "@/components/street";
import { LOTTERY_SUGGESTIONS, PAYMENT_METHOD_LABEL, RIFA_NUMBER_COUNT_MAX, RIFA_NUMBER_COUNT_MIN, rifaNumber, type RifaPaymentMethod } from "@/lib/rifas/shared";

const digits = (v: string) => v.replace(/\D/g, "");

function Choice<T extends string>({ name, value, options, onChange, legend }: {
  name: string; value: T; options: Array<{ value: T; label: string; hint?: string }>; onChange: (v: T) => void; legend: string;
}) {
  return (
    <fieldset>
      <legend className="text-[13px] text-text-secondary">{legend}</legend>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {options.map((o) => (
          <label key={o.value} className={`flex min-h-12 cursor-pointer flex-col justify-center rounded-xl border px-3 py-2 text-[15px] transition-colors ${value === o.value ? "border-text-primary bg-bg-elevated text-text-primary" : "border-border-default text-text-secondary hover:border-gold/30"}`}>
            <span className="flex items-center gap-2">
              <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="sr-only" />
              {o.label}
            </span>
            {o.hint && <span className="text-[12px] text-text-muted">{o.hint}</span>}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function RifaForm({ defaultDrawAt, prefill }: {
  defaultDrawAt: string;
  prefill: { method: RifaPaymentMethod; account: string; holder: string };
}) {
  const router = useRouter();
  const [visibility, setVisibility] = useState<"privada" | "publica">("privada");
  const [name, setName] = useState("");
  const [prizeKind, setPrizeKind] = useState<"dinero" | "texto">("texto");
  const [prizeCop, setPrizeCop] = useState("");
  const [prizeText, setPrizeText] = useState("");
  const [count, setCount] = useState("100");
  const [price, setPrice] = useState("");
  const [lottery, setLottery] = useState("");
  const [digitsRule, setDigitsRule] = useState<"ultimas_dos" | "primeras_dos">("ultimas_dos");
  const [drawAt, setDrawAt] = useState(defaultDrawAt);
  const [method, setMethod] = useState<RifaPaymentMethod>(prefill.method);
  const [account, setAccount] = useState(prefill.account);
  const [holder, setHolder] = useState(prefill.holder);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const countN = Number(count);
  const countValid = Number.isInteger(countN) && countN >= RIFA_NUMBER_COUNT_MIN && countN <= RIFA_NUMBER_COUNT_MAX;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/rifas", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, prizeKind, prizeCop: prizeKind === "dinero" ? Number(prizeCop) : null, prizeText: prizeKind === "texto" ? prizeText : null,
          numberCount: countN, priceCop: Number(price), lotteryName: lottery, digitsRule, drawAt, visibility,
          paymentMethod: method, paymentAccount: account, paymentHolder: holder,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo crear la rifa."); return; }
      router.push(`/rifa/${data.slug}/gestionar`);
    } finally {
      setBusy(false);
    }
  }

  const ready = name.trim().length >= 3 && countValid && Number(price) >= 500 && lottery.trim().length >= 2
    && (prizeKind === "dinero" ? Number(prizeCop) >= 1000 : prizeText.trim().length >= 3)
    && account.trim().length >= 3 && holder.trim().length >= 2 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(drawAt);

  return (
    <form onSubmit={submit} className="space-y-4 px-4 pt-4">
      <StreetCard className="space-y-4 p-4">
        <Choice name="visibilidad" legend="¿Quién la ve?" value={visibility} onChange={setVisibility} options={[
          { value: "privada", label: "Privada", hint: "Solo tú y los administradores" },
          { value: "publica", label: "Pública", hint: "Cualquiera con el enlace" },
        ]} />
        <div>
          <label htmlFor="rifa-nombre" className="block text-[13px] text-text-secondary">Nombre</label>
          <input id="rifa-nombre" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Boleta Sur para el clásico" className="lp-input mt-1 w-full" />
        </div>
        <Choice name="premio" legend="Premio" value={prizeKind} onChange={setPrizeKind} options={[
          { value: "texto", label: "Un objeto o algo" }, { value: "dinero", label: "Dinero" },
        ]} />
        {prizeKind === "dinero" ? (
          <div>
            <label htmlFor="rifa-premio-cop" className="block text-[13px] text-text-secondary">Valor del premio (COP)</label>
            <input id="rifa-premio-cop" inputMode="numeric" value={prizeCop} onChange={(e) => setPrizeCop(digits(e.target.value))} className="lp-input mt-1 w-full" />
          </div>
        ) : (
          <div>
            <label htmlFor="rifa-premio-texto" className="block text-[13px] text-text-secondary">¿Qué se rifa?</label>
            <input id="rifa-premio-texto" value={prizeText} onChange={(e) => setPrizeText(e.target.value)} maxLength={120} placeholder="Boleta de Sur para el clásico" className="lp-input mt-1 w-full" />
          </div>
        )}
        <p className="text-[12px] text-text-muted">La foto del premio se agrega después de crearla.</p>
      </StreetCard>

      <StreetCard className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="min-w-0">
            <label htmlFor="rifa-cantidad" className="block text-[13px] text-text-secondary">Números</label>
            <input id="rifa-cantidad" inputMode="numeric" value={count} onChange={(e) => setCount(digits(e.target.value).slice(0, 3))} className="lp-input mt-1 w-full" aria-describedby="rifa-cantidad-ayuda" />
            <p id="rifa-cantidad-ayuda" className="mt-1 text-[12px] text-text-muted">{countValid ? `Del 00 al ${rifaNumber(countN - 1)}` : "Entre 2 y 100"}</p>
          </div>
          <div className="min-w-0">
            <label htmlFor="rifa-valor" className="block text-[13px] text-text-secondary">Valor por número</label>
            <input id="rifa-valor" inputMode="numeric" value={price} onChange={(e) => setPrice(digits(e.target.value))} placeholder="6000" className="lp-input mt-1 w-full" />
          </div>
        </div>
        <div>
          <label htmlFor="rifa-loteria" className="block text-[13px] text-text-secondary">¿Con qué lotería se juega?</label>
          <input id="rifa-loteria" list="rifa-loterias" value={lottery} onChange={(e) => setLottery(e.target.value)} maxLength={60} className="lp-input mt-1 w-full" />
          <datalist id="rifa-loterias">{LOTTERY_SUGGESTIONS.map((l) => <option key={l} value={l} />)}</datalist>
        </div>
        <Choice name="cifras" legend="¿Qué cifras cuentan?" value={digitsRule} onChange={setDigitsRule} options={[
          { value: "ultimas_dos", label: "Las dos últimas" }, { value: "primeras_dos", label: "Las dos primeras" },
        ]} />
        <ColombiaDateTimeField label="Sorteo y cierre de reservas" value={drawAt} onChange={setDrawAt} />
      </StreetCard>

      <StreetCard className="space-y-4 p-4">
        <p className="text-[15px] font-semibold">¿Dónde recibes los pagos?</p>
        <div>
          <label htmlFor="rifa-metodo" className="block text-[13px] text-text-secondary">Medio</label>
          <select id="rifa-metodo" value={method} onChange={(e) => setMethod(e.target.value as RifaPaymentMethod)} className="lp-input mt-1 w-full">
            {(Object.keys(PAYMENT_METHOD_LABEL) as RifaPaymentMethod[]).map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="rifa-cuenta" className="block text-[13px] text-text-secondary">Número de cuenta o celular</label>
          <input id="rifa-cuenta" value={account} onChange={(e) => setAccount(e.target.value)} maxLength={60} className="lp-input mt-1 w-full" />
        </div>
        <div>
          <label htmlFor="rifa-titular" className="block text-[13px] text-text-secondary">A nombre de</label>
          <input id="rifa-titular" value={holder} onChange={(e) => setHolder(e.target.value)} maxLength={80} className="lp-input mt-1 w-full" />
        </div>
        <p className="text-[12px] text-text-muted">El dinero llega directo a tu cuenta. La Polla no lo recibe.</p>
      </StreetCard>

      {error && <p role="alert" className="rounded-lg border border-red-alert/40 bg-red-alert/10 px-3 py-2 text-[15px] text-text-primary">{error}</p>}
      <button type="submit" disabled={!ready || busy} className="lp-btn lp-btn-primary w-full">{busy ? "Creando…" : "Crear rifa"}</button>
    </form>
  );
}

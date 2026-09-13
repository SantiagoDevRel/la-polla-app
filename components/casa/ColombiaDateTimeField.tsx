"use client";

import { useId } from "react";

/** Separate date/time controls fit mobile without shrinking essential text. */
export function ColombiaDateTimeField({ value, onChange, label, disabled = false }: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
}) {
  const id = useId();
  const [date = "", time = ""] = value.split("T");
  return (
    <fieldset disabled={disabled} className="mt-3 min-w-0 max-w-full">
      <legend className="text-[13px] leading-relaxed text-text-secondary">{label} · hora de Colombia</legend>
      <div className="mt-2 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <label htmlFor={`${id}-date`} className="block text-[13px] text-text-secondary">Fecha</label>
          <input id={`${id}-date`} type="date" value={date} onChange={(event) => onChange(`${event.target.value}T${time || "12:00"}`)}
            className="lp-input mt-1 block min-w-0 max-w-full appearance-none text-[15px]" />
        </div>
        <div className="min-w-0">
          <label htmlFor={`${id}-time`} className="block text-[13px] text-text-secondary">Hora</label>
          <input id={`${id}-time`} type="time" value={time} onChange={(event) => onChange(`${date}T${event.target.value}`)}
            className="lp-input mt-1 block min-w-0 max-w-full appearance-none text-[15px]" />
        </div>
      </div>
    </fieldset>
  );
}

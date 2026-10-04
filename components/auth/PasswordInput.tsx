"use client";

import { useState } from "react";
import { useLocale } from "next-intl";
import { Eye, EyeOff } from "lucide-react";

export default function PasswordInput({ id, label, value, onChange, autoComplete, describedBy, disabled = false }: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "new-password" | "current-password";
  describedBy?: string;
  disabled?: boolean;
}) {
  const en = useLocale() === "en";
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;
  return <div className="space-y-1.5">
    <label htmlFor={id} className="block text-sm leading-normal font-medium text-text-secondary">{label}</label>
    <div className="flex flex-wrap items-stretch gap-2">
      <input id={id} type={visible ? "text" : "password"} inputMode="numeric" autoComplete={autoComplete}
        pattern="[0-9]{6}" maxLength={6} required disabled={disabled}
        value={value} onChange={event => onChange(event.target.value.replace(/\D/g, ""))}
        className="lp-input min-w-0 flex-1 basis-40 text-base" aria-describedby={describedBy} />
      <button type="button" disabled={disabled} onClick={() => setVisible(previous => !previous)}
        aria-controls={id} aria-pressed={visible}
        aria-label={`${visible ? (en ? "Hide" : "Ocultar") : (en ? "Show" : "Mostrar")}: ${label}`}
        className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border-subtle px-3 py-2 text-sm font-medium leading-snug text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-40">
        <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span>{visible ? (en ? "Hide" : "Ocultar") : (en ? "Show" : "Mostrar")}</span>
      </button>
    </div>
  </div>;
}

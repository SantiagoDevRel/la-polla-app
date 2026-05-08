// components/ui/PhoneInput.tsx — Selector de país con búsqueda + input de teléfono en formato E.164.
// Los nombres de país se resuelven dinámicamente vía `Intl.DisplayNames`
// según el locale activo (es-CO o en-US) para no mantener un diccionario
// estático de 200+ entradas en cada idioma.
"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import {
  getCountries,
  getCountryCallingCode,
  type Country as CountryCode,
} from "react-phone-number-input";
import flags from "react-phone-number-input/flags";
import { useLocale, useTranslations } from "next-intl";

interface PhoneInputProps {
  onChange: (value: string) => void;
}

export default function PhoneInput({ onChange }: PhoneInputProps) {
  const t = useTranslations("Phone");
  const locale = useLocale();
  const intlTag = locale === "en" ? "en-US" : "es-CO";

  const displayNames = useMemo(() => {
    try {
      return new Intl.DisplayNames([intlTag], { type: "region" });
    } catch {
      return null;
    }
  }, [intlTag]);

  function getCountryName(code: CountryCode): string {
    if (!displayNames) return code;
    return displayNames.of(code) ?? code;
  }

  // Componente de bandera usando los SVGs de la librería (definido inline
  // para acceder al getCountryName local con el locale aplicado).
  function Flag({ country, className }: { country: CountryCode; className?: string }) {
    const FlagComponent = flags[country];
    if (!FlagComponent) return <span className={className}>{country}</span>;
    return <FlagComponent title={getCountryName(country)} {...(className ? { className } : {})} />;
  }

  const [country, setCountry] = useState<CountryCode>("CO");
  const [localNumber, setLocalNumber] = useState("");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const callingCode = getCountryCallingCode(country);

  // Actualizar el valor E.164 cuando cambia país o número
  useEffect(() => {
    const digits = localNumber.replace(/\D/g, "");
    if (digits) {
      onChange(`+${callingCode}${digits}`);
    } else {
      onChange("");
    }
  }, [country, localNumber, callingCode, onChange]);

  // Cerrar dropdown al hacer click fuera
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  // Focus en búsqueda al abrir
  useEffect(() => {
    if (open && searchRef.current) {
      searchRef.current.focus();
    }
  }, [open]);

  // Lista filtrada y ordenada de países
  const countries = useMemo(() => {
    const all = getCountries();
    const q = search.toLowerCase().trim();

    const filtered = q
      ? all.filter((c) => {
          const name = getCountryName(c).toLowerCase();
          const code = getCountryCallingCode(c);
          return name.includes(q) || code.includes(q);
        })
      : all;

    // Colombia siempre primero, luego alfabético por nombre en el locale activo.
    return filtered.sort((a, b) => {
      if (a === "CO") return -1;
      if (b === "CO") return 1;
      return getCountryName(a).localeCompare(getCountryName(b), intlTag);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, intlTag, displayNames]);

  const handleSelect = (c: CountryCode) => {
    setCountry(c);
    setOpen(false);
    setSearch("");
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <div className="flex rounded-xl overflow-hidden border border-border-subtle focus-within:border-gold/50 transition-colors">
        {/* Botón de país */}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1.5 px-3 py-3 border-r border-border-subtle hover:bg-bg-card-hover transition-colors shrink-0 bg-bg-elevated"
        >
          <Flag country={country} className="w-6 h-4 inline-block" />
          <span className="text-sm font-medium text-text-primary">+{callingCode}</span>
          <svg className={`w-3 h-3 text-text-muted transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Input de número */}
        <input
          type="tel"
          value={localNumber}
          onChange={(e) => setLocalNumber(e.target.value.replace(/\D/g, ""))}
          placeholder={t("samplePlaceholder")}
          className="flex-1 px-3 py-3 outline-none text-lg min-w-0 bg-bg-base text-text-primary placeholder:text-text-muted/50"
          required
        />
      </div>

      {/* Dropdown de países */}
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-xl max-h-72 flex flex-col overflow-hidden bg-bg-card border border-border-medium"
          style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
          {/* Búsqueda */}
          <div className="p-2 border-b border-border-subtle">
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="w-full px-3 py-2 text-sm rounded-lg outline-none bg-bg-base border border-border-subtle text-text-primary placeholder:text-text-muted focus:border-gold/50"
            />
          </div>

          {/* Lista de países */}
          <div className="overflow-y-auto overscroll-contain">
            {countries.length === 0 ? (
              <p className="px-4 py-3 text-sm text-text-muted text-center">
                {t("noResults")}
              </p>
            ) : (
              countries.map((c) => {
                const code = getCountryCallingCode(c);
                const isSelected = c === country;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => handleSelect(c)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-bg-card-hover transition-colors ${
                      isSelected ? "bg-gold-dim" : ""
                    }`}
                  >
                    <Flag country={c} className="w-6 h-4 inline-block shrink-0" />
                    <span className={`text-sm truncate flex-1 ${isSelected ? "text-gold font-medium" : "text-text-primary"}`}>
                      {getCountryName(c)}
                    </span>
                    <span className="text-sm text-text-muted shrink-0">+{code}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

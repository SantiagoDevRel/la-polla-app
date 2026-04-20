// components/polla/CountryCodePicker.tsx — Searchable country-code dropdown
// Uses libphonenumber-js for the full ISO2 + calling-code list and
// Intl.DisplayNames for localized country names. The flag glyph is
// produced from the ISO2 code via regional indicator symbols so no
// extra asset bundle is needed.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import {
  getCountries,
  getCountryCallingCode,
  type CountryCode,
} from "libphonenumber-js";

export interface CountryOption {
  iso: CountryCode;
  name: string;
  calling: string; // digits only, no "+"
  flag: string;
}

function isoToFlag(iso: string): string {
  if (iso.length !== 2) return "";
  const base = 127397; // regional indicator A offset
  const upper = iso.toUpperCase();
  return String.fromCodePoint(
    base + upper.charCodeAt(0),
    base + upper.charCodeAt(1)
  );
}

function buildOptions(): CountryOption[] {
  const displayNames =
    typeof Intl !== "undefined" && "DisplayNames" in Intl
      ? new Intl.DisplayNames(["es"], { type: "region" })
      : null;
  const list: CountryOption[] = [];
  for (const iso of getCountries()) {
    try {
      list.push({
        iso,
        name: displayNames?.of(iso) ?? iso,
        calling: getCountryCallingCode(iso),
        flag: isoToFlag(iso),
      });
    } catch {
      // Skip ISO codes libphonenumber knows but cannot resolve to a code.
    }
  }
  list.sort((a, b) => a.name.localeCompare(b.name, "es"));
  return list;
}

interface Props {
  value: CountryCode;
  onChange: (iso: CountryCode, callingCode: string) => void;
}

export default function CountryCodePicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const options = useMemo(() => buildOptions(), []);
  const current = options.find((o) => o.iso === value) ?? options[0];

  // Strip diacritics so "Mexico" matches "México", "pucon" matches "Pucón", etc.
  const normalize = (s: string) =>
    s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  const filtered = useMemo(() => {
    // Accept "+351" and "351" alike. Collapse whitespace and diacritics.
    const raw = query.trim().replace(/^\+/, "");
    const q = normalize(raw);
    if (!q) return options;
    return options.filter(
      (o) =>
        normalize(o.name).includes(q) ||
        o.iso.toLowerCase().includes(q) ||
        o.calling.includes(q)
    );
  }, [options, query]);

  useEffect(() => {
    // Reset query every time the dropdown opens OR closes so a stale filter
    // does not leave the list looking empty on the next open.
    setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    // Focus the search input as soon as the element mounts. setTimeout hops
    // past the same-tick mousedown that opened the dropdown on mobile, where
    // tapping the trigger otherwise steals focus back from the input.
    const t = setTimeout(() => searchRef.current?.focus(), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 bg-bg-elevated border-r border-border-subtle px-2 py-3 text-sm text-text-primary outline-none cursor-pointer h-full"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="font-semibold">{current?.iso}</span>
        <span className="text-text-muted">+{current?.calling}</span>
        <ChevronDown className="w-3 h-3 text-text-muted" aria-hidden="true" />
      </button>
      {open ? (
        <div className="absolute z-30 mt-1 left-0 w-72 max-w-[90vw] rounded-xl border border-border-subtle bg-bg-card shadow-lg overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle">
            <Search className="w-4 h-4 text-text-muted" aria-hidden="true" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar país o código"
              className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none"
            />
          </div>
          <ul role="listbox" className="max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-text-muted">Sin resultados</li>
            ) : (
              filtered.map((o) => (
                <li key={o.iso}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={o.iso === value}
                    onClick={() => {
                      onChange(o.iso, o.calling);
                      setOpen(false);
                      setQuery("");
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-bg-elevated ${
                      o.iso === value ? "bg-bg-elevated" : ""
                    }`}
                  >
                    <span className="text-base leading-none" aria-hidden="true">
                      {o.flag}
                    </span>
                    <span className="font-semibold text-text-primary w-7">{o.iso}</span>
                    <span className="flex-1 text-text-secondary truncate">{o.name}</span>
                    <span className="text-text-muted">+{o.calling}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

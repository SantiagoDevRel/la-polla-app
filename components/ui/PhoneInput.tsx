// components/ui/PhoneInput.tsx — Selector de país con búsqueda en español + input de teléfono en formato E.164
"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import {
  getCountries,
  getCountryCallingCode,
} from "react-phone-number-input";
import type { CountryCode } from "react-phone-number-input";
import flags from "react-phone-number-input/flags";

// Nombres de países en español colombiano
const COUNTRY_NAMES_ES: Record<string, string> = {
  AC: "Isla Ascensión", AD: "Andorra", AE: "Emiratos Árabes Unidos", AF: "Afganistán",
  AG: "Antigua y Barbuda", AI: "Anguila", AL: "Albania", AM: "Armenia", AO: "Angola",
  AR: "Argentina", AS: "Samoa Americana", AT: "Austria", AU: "Australia", AW: "Aruba",
  AX: "Islas Åland", AZ: "Azerbaiyán", BA: "Bosnia y Herzegovina", BB: "Barbados",
  BD: "Bangladés", BE: "Bélgica", BF: "Burkina Faso", BG: "Bulgaria", BH: "Baréin",
  BI: "Burundi", BJ: "Benín", BL: "San Bartolomé", BM: "Bermudas", BN: "Brunéi",
  BO: "Bolivia", BQ: "Caribe Neerlandés", BR: "Brasil", BS: "Bahamas", BT: "Bután",
  BW: "Botsuana", BY: "Bielorrusia", BZ: "Belice", CA: "Canadá", CC: "Islas Cocos",
  CD: "Congo (RDC)", CF: "República Centroafricana", CG: "Congo", CH: "Suiza",
  CI: "Costa de Marfil", CK: "Islas Cook", CL: "Chile", CM: "Camerún", CN: "China",
  CO: "Colombia", CR: "Costa Rica", CU: "Cuba", CV: "Cabo Verde", CW: "Curazao",
  CX: "Isla de Navidad", CY: "Chipre", CZ: "Chequia", DE: "Alemania", DJ: "Yibuti",
  DK: "Dinamarca", DM: "Dominica", DO: "República Dominicana", DZ: "Argelia",
  EC: "Ecuador", EE: "Estonia", EG: "Egipto", EH: "Sahara Occidental", ER: "Eritrea",
  ES: "España", ET: "Etiopía", FI: "Finlandia", FJ: "Fiyi", FK: "Islas Malvinas",
  FM: "Micronesia", FO: "Islas Feroe", FR: "Francia", GA: "Gabón", GB: "Reino Unido",
  GD: "Granada", GE: "Georgia", GF: "Guayana Francesa", GG: "Guernsey", GH: "Ghana",
  GI: "Gibraltar", GL: "Groenlandia", GM: "Gambia", GN: "Guinea", GP: "Guadalupe",
  GQ: "Guinea Ecuatorial", GR: "Grecia", GT: "Guatemala", GU: "Guam", GW: "Guinea-Bisáu",
  GY: "Guyana", HK: "Hong Kong", HN: "Honduras", HR: "Croacia", HT: "Haití",
  HU: "Hungría", ID: "Indonesia", IE: "Irlanda", IL: "Israel", IM: "Isla de Man",
  IN: "India", IO: "Territorio Británico del Océano Índico", IQ: "Irak", IR: "Irán",
  IS: "Islandia", IT: "Italia", JE: "Jersey", JM: "Jamaica", JO: "Jordania",
  JP: "Japón", KE: "Kenia", KG: "Kirguistán", KH: "Camboya", KI: "Kiribati",
  KM: "Comoras", KN: "San Cristóbal y Nieves", KP: "Corea del Norte",
  KR: "Corea del Sur", KW: "Kuwait", KY: "Islas Caimán", KZ: "Kazajistán",
  LA: "Laos", LB: "Líbano", LC: "Santa Lucía", LI: "Liechtenstein", LK: "Sri Lanka",
  LR: "Liberia", LS: "Lesoto", LT: "Lituania", LU: "Luxemburgo", LV: "Letonia",
  LY: "Libia", MA: "Marruecos", MC: "Mónaco", MD: "Moldavia", ME: "Montenegro",
  MF: "San Martín", MG: "Madagascar", MH: "Islas Marshall", MK: "Macedonia del Norte",
  ML: "Malí", MM: "Myanmar", MN: "Mongolia", MO: "Macao", MP: "Islas Marianas del Norte",
  MQ: "Martinica", MR: "Mauritania", MS: "Montserrat", MT: "Malta", MU: "Mauricio",
  MV: "Maldivas", MW: "Malaui", MX: "México", MY: "Malasia", MZ: "Mozambique",
  NA: "Namibia", NC: "Nueva Caledonia", NE: "Níger", NF: "Isla Norfolk", NG: "Nigeria",
  NI: "Nicaragua", NL: "Países Bajos", NO: "Noruega", NP: "Nepal", NR: "Nauru",
  NU: "Niue", NZ: "Nueva Zelanda", OM: "Omán", PA: "Panamá", PE: "Perú",
  PF: "Polinesia Francesa", PG: "Papúa Nueva Guinea", PH: "Filipinas", PK: "Pakistán",
  PL: "Polonia", PM: "San Pedro y Miquelón", PR: "Puerto Rico", PS: "Palestina",
  PT: "Portugal", PW: "Palaos", PY: "Paraguay", QA: "Catar", RE: "Reunión",
  RO: "Rumanía", RS: "Serbia", RU: "Rusia", RW: "Ruanda", SA: "Arabia Saudita",
  SB: "Islas Salomón", SC: "Seychelles", SD: "Sudán", SE: "Suecia", SG: "Singapur",
  SH: "Santa Elena", SI: "Eslovenia", SJ: "Svalbard y Jan Mayen", SK: "Eslovaquia",
  SL: "Sierra Leona", SM: "San Marino", SN: "Senegal", SO: "Somalia", SR: "Surinam",
  SS: "Sudán del Sur", ST: "Santo Tomé y Príncipe", SV: "El Salvador", SX: "Sint Maarten",
  SY: "Siria", SZ: "Esuatini", TA: "Tristán de Acuña", TC: "Islas Turcas y Caicos",
  TD: "Chad", TG: "Togo", TH: "Tailandia", TJ: "Tayikistán", TK: "Tokelau",
  TL: "Timor Oriental", TM: "Turkmenistán", TN: "Túnez", TO: "Tonga",
  TR: "Turquía", TT: "Trinidad y Tobago", TV: "Tuvalu", TW: "Taiwán",
  TZ: "Tanzania", UA: "Ucrania", UG: "Uganda", US: "Estados Unidos", UY: "Uruguay",
  UZ: "Uzbekistán", VA: "Ciudad del Vaticano", VC: "San Vicente y las Granadinas",
  VE: "Venezuela", VG: "Islas Vírgenes Británicas", VI: "Islas Vírgenes de EE. UU.",
  VN: "Vietnam", VU: "Vanuatu", WF: "Wallis y Futuna", WS: "Samoa", XK: "Kosovo",
  YE: "Yemen", YT: "Mayotte", ZA: "Sudáfrica", ZM: "Zambia", ZW: "Zimbabue",
};

function getCountryName(code: CountryCode): string {
  return COUNTRY_NAMES_ES[code] || code;
}

// Componente de bandera usando los SVGs de la librería
function Flag({ country, className }: { country: CountryCode; className?: string }) {
  const FlagComponent = flags[country];
  if (!FlagComponent) return <span className={className}>{country}</span>;
  return <FlagComponent title={getCountryName(country)} className={className} />;
}

interface PhoneInputProps {
  onChange: (value: string) => void;
}

export default function PhoneInput({ onChange }: PhoneInputProps) {
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

    // Colombia siempre primero, luego alfabético por nombre en español
    return filtered.sort((a, b) => {
      if (a === "CO") return -1;
      if (b === "CO") return 1;
      return getCountryName(a).localeCompare(getCountryName(b), "es");
    });
  }, [search]);

  const handleSelect = (c: CountryCode) => {
    setCountry(c);
    setOpen(false);
    setSearch("");
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <div className="flex border border-gray-300 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-colombia-yellow focus-within:border-transparent">
        {/* Botón de país */}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1.5 px-3 py-3 bg-gray-50 border-r border-gray-300 hover:bg-gray-100 transition-colors shrink-0"
        >
          <Flag country={country} className="w-6 h-4 inline-block" />
          <span className="text-sm font-medium text-gray-700">+{callingCode}</span>
          <svg className={`w-3 h-3 text-gray-500 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Input de número */}
        <input
          type="tel"
          value={localNumber}
          onChange={(e) => setLocalNumber(e.target.value.replace(/\D/g, ""))}
          placeholder="3117312391"
          className="flex-1 px-3 py-3 outline-none text-lg min-w-0"
          required
        />
      </div>

      {/* Hint */}
      <p className="text-xs text-gray-500 mt-1">
        Número sin código de país
      </p>

      {/* Dropdown de países */}
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-72 flex flex-col overflow-hidden">
          {/* Búsqueda */}
          <div className="p-2 border-b border-gray-100">
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar país o código..."
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-1 focus:ring-colombia-yellow"
            />
          </div>

          {/* Lista de países */}
          <div className="overflow-y-auto overscroll-contain">
            {countries.length === 0 ? (
              <p className="px-4 py-3 text-sm text-gray-400 text-center">
                No se encontraron países
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
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-colombia-yellow/10 transition-colors ${
                      isSelected ? "bg-colombia-yellow/20 font-medium" : ""
                    }`}
                  >
                    <Flag country={c} className="w-6 h-4 inline-block shrink-0" />
                    <span className="text-sm text-gray-800 truncate flex-1">
                      {getCountryName(c)}
                    </span>
                    <span className="text-sm text-gray-500 shrink-0">+{code}</span>
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

// lib/auth/telegram-login/mask-phone.ts — Número enmascarado de la página
// «Confirma tu ingreso» (/login/telegram). Suficiente para reconocer el número
// propio, nunca para leer uno ajeno.
//
// v1 asumía un número nacional de 10 dígitos: +351 912 345 581 salía como
// "+35 ••• ••• 5581". El código de país sale ahora de la tabla de códigos de la
// librería de teléfonos que ya usa el selector de país del login:
// react-phone-number-input se apoya en libphonenumber-js (misma versión del
// lockfile) y aquí se importa su núcleo sin React. Importar
// react-phone-number-input en esta página de servidor arrastra el componente
// de clase y rompe el build («Super expression must either be null or a
// function»). Los códigos de país E.164 no son prefijo unos de otros, así que
// basta probar 1, 2 y 3 dígitos contra esa tabla.
//
// Reglas:
//   - Siempre la misma forma "••• ••• 1234": no revela cuántos dígitos tiene.
//   - Máximo 4 dígitos visibles y al menos 4 ocultos del número nacional; en
//     números nacionales cortos se muestran menos (Islandia: "•345").
//   - Código de país desconocido (no geográfico, +800…): sin prefijo y
//     suponiendo el código más largo (3 dígitos) al contar los ocultos.
//   - Algo que no parece E.164 (menos de 8 o más de 15 dígitos): nada visible.

import { getCountries, getCountryCallingCode } from "libphonenumber-js/min";

const MASK = "••• •••";
const VISIBLE_MAX = 4;
const HIDDEN_MIN = 4;
const LONGEST_CALLING_CODE = 3;

let callingCodes: Set<string> | null = null;

function knownCallingCodes(): Set<string> {
  if (!callingCodes) {
    callingCodes = new Set(getCountries().map((country) => String(getCountryCallingCode(country))));
  }
  return callingCodes;
}

/** Código de país E.164 al principio de los dígitos, o null si no se reconoce. */
export function callingCodeOf(digits: string): string | null {
  const codes = knownCallingCodes();
  for (let length = 1; length <= LONGEST_CALLING_CODE && length < digits.length; length++) {
    const candidate = digits.slice(0, length);
    if (codes.has(candidate)) return candidate;
  }
  return null;
}

function lastDigits(national: string): string {
  const visible = Math.max(0, Math.min(VISIBLE_MAX, national.length - HIDDEN_MIN));
  const shown = visible > 0 ? national.slice(-visible) : "";
  return shown.padStart(VISIBLE_MAX, "•");
}

/** "+351912345581" → "+351 ••• ••• 5581"; "+573001234567" → "+57 ••• ••• 4567". */
export function maskPhone(phoneE164: string): string {
  const digits = String(phoneE164 ?? "").replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15 || digits.startsWith("0")) {
    return `${MASK} ${"•".repeat(VISIBLE_MAX)}`;
  }
  const cc = callingCodeOf(digits);
  if (!cc) {
    return `${MASK} ${lastDigits(digits.slice(LONGEST_CALLING_CODE))}`;
  }
  return `+${cc} ${MASK} ${lastDigits(digits.slice(cc.length))}`;
}

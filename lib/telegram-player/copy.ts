// lib/telegram-player/copy.ts — Textos fijos del bot de jugadores.
//
// Registro de casa seria (CLAUDE.md, Tone Rules): claro, directo, en tú, sin
// jerga ("parce", "plata", "pantallazo" de cara a la persona se dice
// "comprobante"). Pensado para gente que no usa muchas apps: una instrucción por
// mensaje, botones con verbo y texto grande. Como el bot de WhatsApp, lleva
// algunos emojis para reconocer cada botón de un vistazo (nunca gallinas).

import { normalizeCommandText } from "./update";
import { cb } from "./ids";

export const MENU_LABELS = {
  abiertas: "⚽ Pollas abiertas",
  mias: "🎟 Mis pollas",
  pagos: "💳 Mis pagos",
  perfil: "👤 Mi perfil",
  ayuda: "❓ Ayuda",
} as const;

/** El menú fijo de abajo: siempre visible, como la barra de una app. */
export const MAIN_KEYBOARD = {
  keyboard: [
    [{ text: MENU_LABELS.abiertas }, { text: MENU_LABELS.mias }],
    [{ text: MENU_LABELS.pagos }, { text: MENU_LABELS.perfil }],
    [{ text: MENU_LABELS.ayuda }],
  ],
  is_persistent: true,
  resize_keyboard: true,
  input_field_placeholder: "Usa los botones de abajo",
};

/**
 * Las mismas opciones como botones dentro del mensaje. En Telegram para
 * computador (web y escritorio) el menú fijo queda escondido detrás del ícono ⌘
 * y con las etiquetas cortadas: verificado en la prueba real del 2026-09-15.
 * Estos botones se ven en todos los clientes.
 */
export function homeButtons() {
  return [
    [{ text: MENU_LABELS.abiertas, callback_data: cb("ol", 0) }],
    [{ text: MENU_LABELS.mias, callback_data: cb("ml", 0) }],
    [{ text: MENU_LABELS.pagos, callback_data: "pg" }, { text: MENU_LABELS.perfil, callback_data: "pf" }],
    [{ text: MENU_LABELS.ayuda, callback_data: "hp" }],
  ];
}

export type MenuCommand = "home" | "abiertas" | "mias" | "pagos" | "perfil" | "ayuda" | "web" | "cancelar";

const COMMANDS: Record<string, MenuCommand> = {
  "/start": "home",
  "/menu": "home",
  menu: "home",
  inicio: "home",
  hola: "home",
  "pollas abiertas": "abiertas",
  "/pollas": "abiertas",
  pollas: "abiertas",
  "mis pollas": "mias",
  "/mispollas": "mias",
  "mis pagos": "pagos",
  "/pagos": "pagos",
  pagos: "pagos",
  "mi perfil": "perfil",
  "/perfil": "perfil",
  perfil: "perfil",
  ayuda: "ayuda",
  "/ayuda": "ayuda",
  "/help": "ayuda",
  "/web": "web",
  web: "web",
  cancelar: "cancelar",
  "/cancelar": "cancelar",
};

const KEYBOARD_COMMANDS: Record<string, MenuCommand> = {
  [MENU_LABELS.abiertas]: "abiertas",
  [MENU_LABELS.mias]: "mias",
  [MENU_LABELS.pagos]: "pagos",
  [MENU_LABELS.perfil]: "perfil",
  [MENU_LABELS.ayuda]: "ayuda",
};

/**
 * Botón del menú o comando conocido; null si es otra cosa (un nombre, un
 * marcador…). strict: solo el texto exacto de los botones de abajo o un comando
 * con «/» (mientras la persona escribe una respuesta libre o su nombre).
 */
export function menuCommandOf(text: string | null, options: { strict?: boolean } = {}): MenuCommand | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (KEYBOARD_COMMANDS[trimmed]) return KEYBOARD_COMMANDS[trimmed];
  const normalized = normalizeCommandText(text);
  // "/start@LaPollaBot" llega como "/start lapollabot".
  if (normalized.startsWith("/")) return COMMANDS[normalized.split(" ")[0]] ?? null;
  if (options.strict) return null;
  return COMMANDS[normalized] ?? null;
}

/** /start con payload (web) o /login: lo atiende el flujo de login. */
export function isLoginIntent(text: string | null): boolean {
  if (!text) return false;
  const t = text.trim();
  return /^\/start(?:@[A-Za-z0-9_]+)?\s+\S+/i.test(t) || /^\/login(?:@[A-Za-z0-9_]+)?\s*$/i.test(t);
}

export function isBareStart(text: string | null): boolean {
  return Boolean(text && /^\/start(?:@[A-Za-z0-9_]+)?\s*$/i.test(text.trim()));
}

export const COPY = {
  intro: [
    "<b>Bienvenido a La Polla Colombiana</b>",
    "",
    "Desde este chat puedes crear tu cuenta, inscribirte a las pollas, enviar el comprobante de pago, pronosticar y ver la tabla de posiciones. Todo con botones.",
  ].join("\n"),
  numberConfirmed: "✅ Listo, confirmamos tu número. Tu cuenta de La Polla ya está creada.",
  welcome: (name: string) =>
    [
      `<b>¡Hola, ${name}!</b>`,
      "",
      "Ya puedes jugar desde aquí.",
      "",
      `${MENU_LABELS.abiertas}: para inscribirte.`,
      `${MENU_LABELS.mias}: para pronosticar y ver la tabla.`,
      `${MENU_LABELS.pagos}: para saber si ya confirmamos tu pago.`,
      "",
      "Estos botones también quedan fijos abajo. En el computador se abren con el ícono de cuatro cuadritos junto a la carita.",
    ].join("\n"),
  home: "¿Qué quieres hacer? Toca una opción:",
  askName: [
    "<b>Paso 1 de 2: tu nombre</b>",
    "",
    "Escribe tu nombre como quieres que aparezca en la tabla de posiciones. Por ejemplo: <i>Carlos Pérez</i>.",
  ].join("\n"),
  askNameChange: "Escribe tu nuevo nombre. Así apareces en la tabla de posiciones.",
  invalidName: "Ese nombre no sirve. Escribe tu nombre real, de 2 a 50 letras (no tu número de celular).",
  pollitoOnboarding: [
    "<b>Paso 2 de 2: tu pollito</b>",
    "",
    "Elige tu pollito. Cada uno lleva la camiseta de un equipo y te acompaña en la tabla.",
  ].join("\n"),
  pollitoChange: "Elige tu pollito. Cada uno lleva la camiseta de un equipo.",
  notUnderstood: "No entendí ese mensaje. Toca una opción:",
  onlyImages: "Solo puedo recibir la foto del comprobante de pago. Para lo demás, toca una opción:",
  failure: "No pudimos completar eso en este momento. Inténtalo de nuevo en unos minutos.",
  expiredButton: "Ese botón ya no está vigente. Te muestro la información actualizada.",
  cancelled: "Listo, cancelamos ese paso.",
  doubleTap: "La pantalla acaba de cambiar. Revisa las opciones y toca otra vez.",
  pendingPoints:
    "⏳ Tu pago está en revisión. Tus pronósticos quedan guardados y sus puntos se suman en la tabla apenas confirmemos el pago, también los de partidos que ya se jugaron.",
} as const;

export const BACK_HOME = "⬅️ Menú";

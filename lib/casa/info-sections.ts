// lib/casa/info-sections.ts — las anclas de la pestaña Info.
//
// (2026-09-18) Pedido del dueño: Info es la ÚNICA parte de la polla con mucho
// texto; el resto de la pantalla se calla y, donde alguien puede querer saber
// más, deja un «Ver más» que abre la regla exacta. Este módulo no lleva
// "use client": lo importan PollaInfo (Server Component) y los botones cliente.

export type InfoSection =
  | "puntos"      // Cómo sumas puntos
  | "premio"      // Premio y ganadores
  | "cierre"      // Hasta cuándo puedes pronosticar
  | "marcador"    // Qué marcador cuenta
  | "suspendido"  // Si se suspende un partido
  | "otros"       // Pronósticos de otros jugadores
  | "invita"      // Invita y gana cupos
  | "entrada"     // Cómo entras / Cómo se paga la entrada
  | "cobro";      // Cómo recibes tu premio

const PREFIX = "info-";

export const infoAnchor = (section: InfoSection) => `${PREFIX}${section}`;

/** Evento que escucha PollaTabs para cambiar a Info y abrir una regla. */
export const INFO_EVENT = "lp:abrir-info";

/** `#info-premio` → `info-premio`; cualquier otro hash → null. */
export function infoAnchorFromHash(hash: string): string | null {
  const id = hash.replace(/^#/, "");
  return /^info-[a-z]+$/.test(id) ? id : null;
}

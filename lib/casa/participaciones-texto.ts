// lib/casa/participaciones-texto.ts — textos de «Tus cupos», sin React.
//
// (2026-09-18) `faltanTexto` vivía dentro de `components/casa/Participaciones.tsx`,
// que es un módulo "use client". El Server Component `/polla/[slug]/page.tsx` la
// llamaba directo y Next lo rechaza en runtime:
//
//   Attempted to call faltanTexto() from the server but faltanTexto is on the
//   client. It's not possible to invoke a client function from the server.
//
// El build no lo detecta y el error solo aparece para quien está inscrito, con
// un solo cupo y pronósticos pendientes — el único caso que renderiza esa línea.
// A esa persona la polla entera se le caía en «Se nos enredó la cancha».
//
// Vive acá, sin "use client", para que el servidor y el cliente compartan el
// mismo texto sin cruzar esa frontera.

export const faltanTexto = (n: number) => (n === 1 ? "Te falta 1 pronóstico" : `Te faltan ${n} pronósticos`);

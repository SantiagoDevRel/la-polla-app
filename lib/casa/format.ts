// lib/casa/format.ts — formato de plata y fechas, en un solo lugar.
//
// Vive aparte de los componentes porque el bot de Telegram (server, sin React)
// necesita exactamente el mismo formato que la web. Una sola verdad sobre como
// se escribe un peso.

/** $1.250.000 — sin decimales, separador de miles con punto (es-CO). */
/**
 * URL publica de la foto del premio (bucket `prize-images`, migracion 089).
 *
 * Se arma a mano en vez de pedirle a supabase-js un cliente: es una URL fija y
 * publica, y esto lo usan Server Components donde crear un cliente de Storage
 * para resolver una cadena seria puro peso. Si el bucket dejara de ser publico,
 * este es el unico lugar que hay que cambiar.
 */
export function prizeImageUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return `${base}/storage/v1/object/public/prize-images/${path}`;
}

export function formatCop(cop: number): string {
  return `$${Math.round(cop).toLocaleString("es-CO")}`;
}

/** 1.250.000 — igual pero sin el signo, para cuando el $ ya esta en la etiqueta. */
export function formatNumber(n: number): string {
  return Math.round(n).toLocaleString("es-CO");
}

/** "sáb 30 ago · 3:00 p.m." en hora de Colombia. */
export function formatMatchTime(iso: string): string {
  const d = new Date(iso);
  const fecha = new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(d);
  const hora = new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
  return `${fecha} · ${hora}`;
}

/**
 * "cierra en 2h 14m" / "cerrada". Se usa en las tarjetas del inicio, donde el
 * apuro es la mitad del gancho.
 */
export function timeLeft(iso: string, now: Date = new Date()): string {
  const ms = new Date(iso).getTime() - now.getTime();
  if (ms <= 0) return "cerrada";
  const min = Math.floor(ms / 60_000);
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Slug a partir del nombre que escribe el admin. */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

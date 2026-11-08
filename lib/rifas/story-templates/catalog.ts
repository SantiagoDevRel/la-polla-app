/** Client-safe metadata: importing the selector never bundles the image renderer. */
export const STORY_TEMPLATE_CATALOG = [
  { key: "neutra", label: "La Polla", usesClub: false },
  { key: "club", label: "Colores de club", usesClub: true },
  { key: "estadio", label: "Noche de estadio", usesClub: false },
  { key: "boleta", label: "Boleta de la suerte", usesClub: false },
  { key: "marcador", label: "Marcador luminoso", usesClub: false },
  { key: "cuaderno", label: "En mi cuaderno", usesClub: false },
  { key: "camiseta", label: "La camiseta", usesClub: true },
  { key: "pizarra", label: "La jugada", usesClub: false },
  { key: "retro", label: "Lotería de barrio", usesClub: false },
  { key: "premium", label: "Edición premium", usesClub: false },
  { key: "neon", label: "Noche de neón", usesClub: false },
  { key: "confeti", label: "Gran celebración", usesClub: false },
] as const;
export type StoryTemplateKey = (typeof STORY_TEMPLATE_CATALOG)[number]["key"];

/**
 * Plantillas de Los Del Sur (lib/rifas/partner.ts): solo para las rifas de la
 * barra, y esas rifas solo ven estas. Cada una lleva un pollito barrista
 * (assets/rifas-story/lds/pollito-<pollito>.png) y una foto real de la barra
 * de fondo (assets/rifas-story/lds/fondo-<background>.jpg, del Instagram
 * oficial @ldsoficial: scripts/bake-rifa-lds-fondos.py).
 */
export const LDS_STORY_TEMPLATE_CATALOG = [
  // (2026-11-08, pedido del dueño) El tablero es la principal: va primero y sale por defecto.
  { key: "lds-tablero", label: "Tablero", usesClub: false, partner: "lds", background: "tablero", pollito: "pava" },
  { key: "lds-tribuna", label: "La tribuna", usesClub: false, partner: "lds", background: "tribuna", pollito: "pava" },
  { key: "lds-combos", label: "Los combos", usesClub: false, partner: "lds", background: "combos", pollito: "trompeta" },
  { key: "lds-humo", label: "Humo verde", usesClub: false, partner: "lds", background: "humo", pollito: "bombo" },
  { key: "lds-trapo", label: "El trapo", usesClub: false, partner: "lds", background: "trapo", pollito: "trapo" },
  { key: "lds-escudo", label: "El escudo", usesClub: false, partner: "lds", background: "escudo", pollito: "bandera" },
  { key: "lds-sombrillas", label: "Sombrillas", usesClub: false, partner: "lds", background: "sombrillas", pollito: "sombrilla" },
] as const;
export type LdsStoryTemplateKey = (typeof LDS_STORY_TEMPLATE_CATALOG)[number]["key"];

/**
 * Formatos de exportación. Solo el tablero ofrece los dos: cuadrada (1080×1350,
 * WhatsApp y feed) y vertical (1080×1920, historia de Instagram: el mismo
 * cuadrado con 285 px de foto arriba y abajo, las zonas que tapa Instagram).
 * Las demás plantillas son verticales.
 */
export const STORY_FORMATS = [
  { key: "cuadrada", label: "Cuadrada", width: 1080, height: 1350 },
  { key: "vertical", label: "Vertical (historia de Instagram)", width: 1080, height: 1920 },
] as const;
export type StoryFormat = (typeof STORY_FORMATS)[number]["key"];
export const TABLERO_KEY = "lds-tablero";

export function storyHasFormats(key: string): boolean {
  return key === TABLERO_KEY;
}

/** Formato pedido; el de por defecto es el cuadrado. Las demás plantillas siempre son verticales. */
export function storyFormat(key: string, requested: string | null | undefined): StoryFormat {
  if (!storyHasFormats(key)) return "vertical";
  return requested === "vertical" ? "vertical" : "cuadrada";
}
export type AnyStoryTemplateKey = StoryTemplateKey | LdsStoryTemplateKey;

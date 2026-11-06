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
 * (assets/rifas-story/lds/pollito-<pollito>.png) y, si tiene foto, su fondo
 * (assets/rifas-story/lds/fondo-<background>.jpg).
 */
export const LDS_STORY_TEMPLATE_CATALOG = [
  { key: "lds-tribuna", label: "La tribuna", usesClub: false, partner: "lds", background: "tribuna", pollito: "pava" },
  { key: "lds-combos", label: "Los combos", usesClub: false, partner: "lds", background: "combos", pollito: "trompeta" },
  { key: "lds-humo", label: "Humo verde", usesClub: false, partner: "lds", background: "humo", pollito: "bombo" },
  { key: "lds-trapo", label: "El trapo", usesClub: false, partner: "lds", background: null, pollito: "trapo" },
  { key: "lds-escudo", label: "El escudo", usesClub: false, partner: "lds", background: null, pollito: "bandera" },
  { key: "lds-sombrillas", label: "Sombrillas", usesClub: false, partner: "lds", background: null, pollito: "sombrilla" },
] as const;
export type LdsStoryTemplateKey = (typeof LDS_STORY_TEMPLATE_CATALOG)[number]["key"];
export type AnyStoryTemplateKey = StoryTemplateKey | LdsStoryTemplateKey;

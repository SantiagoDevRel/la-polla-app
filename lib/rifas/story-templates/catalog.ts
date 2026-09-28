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

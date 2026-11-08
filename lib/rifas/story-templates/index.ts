import { LDS_STORY_TEMPLATE_CATALOG, STORY_TEMPLATE_CATALOG, storyHasFormats, type StoryFormat } from "./catalog";
import * as designs from "./designs";
import * as ldsDesigns from "./designs-lds";
import { tablero, TABLERO_SIZE } from "./designs-lds-tablero";
import { STORY_H, STORY_W } from "./common";
import type { StoryProps, StoryTemplate } from "./types";

export { STORY_W, STORY_H } from "./common";
export { STORY_FORMATS, storyFormat, storyHasFormats, type StoryFormat } from "./catalog";
export type { StoryData, StoryHeadlineLine, StoryPartnerArt, StoryProps, StoryTemplate } from "./types";
export const STORY_TEMPLATE_LIST: readonly StoryTemplate[] = STORY_TEMPLATE_CATALOG.map((entry) => ({
  ...entry, render: designs[entry.key],
}));
const LDS_RENDER = {
  "lds-tablero": tablero,
  "lds-tribuna": ldsDesigns.tribuna, "lds-combos": ldsDesigns.combos, "lds-humo": ldsDesigns.humo,
  "lds-trapo": ldsDesigns.trapo, "lds-escudo": ldsDesigns.escudo, "lds-sombrillas": ldsDesigns.sombrillas,
} as const;
export const LDS_STORY_TEMPLATE_LIST: readonly (StoryTemplate & { background: string | null; pollito: string })[] =
  LDS_STORY_TEMPLATE_CATALOG.map((entry) => ({ ...entry, render: LDS_RENDER[entry.key] }));

/** Una rifa de la barra solo usa sus plantillas; las demás, las de La Polla. */
export function getStoryTemplate(key: string | null | undefined, partner: "lds" | null = null): StoryTemplate {
  const list: readonly StoryTemplate[] = partner === "lds" ? LDS_STORY_TEMPLATE_LIST : STORY_TEMPLATE_LIST;
  return list.find((template) => template.key === key) ?? list[0];
}

/** Tamaño de la imagen: el tablero tiene dos formatos; las demás son 1080×1920. */
export function storySize(key: string, format: StoryFormat) {
  return storyHasFormats(key) ? TABLERO_SIZE[format] : { width: STORY_W, height: STORY_H };
}

export function renderStory(key: string | null | undefined, props: StoryProps) {
  const template = [...STORY_TEMPLATE_LIST, ...LDS_STORY_TEMPLATE_LIST].find((t) => t.key === key) ?? STORY_TEMPLATE_LIST[0];
  return template.render({ ...props, pollito: template.usesClub || template.partner ? props.pollito : null });
}

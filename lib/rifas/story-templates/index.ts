import { LDS_STORY_TEMPLATE_CATALOG, STORY_TEMPLATE_CATALOG } from "./catalog";
import * as designs from "./designs";
import * as ldsDesigns from "./designs-lds";
import type { StoryProps, StoryTemplate } from "./types";

export { STORY_W, STORY_H } from "./common";
export type { StoryData, StoryPartnerArt, StoryProps, StoryTemplate } from "./types";
export const STORY_TEMPLATE_LIST: readonly StoryTemplate[] = STORY_TEMPLATE_CATALOG.map((entry) => ({
  ...entry, render: designs[entry.key],
}));
const LDS_RENDER = {
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

export function renderStory(key: string | null | undefined, props: StoryProps) {
  const template = [...STORY_TEMPLATE_LIST, ...LDS_STORY_TEMPLATE_LIST].find((t) => t.key === key) ?? STORY_TEMPLATE_LIST[0];
  return template.render({ ...props, pollito: template.usesClub || template.partner ? props.pollito : null });
}

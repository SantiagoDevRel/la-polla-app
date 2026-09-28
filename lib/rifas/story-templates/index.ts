import { STORY_TEMPLATE_CATALOG } from "./catalog";
import * as designs from "./designs";
import type { StoryProps, StoryTemplate } from "./types";

export { STORY_W, STORY_H } from "./common";
export type { StoryData, StoryProps, StoryTemplate } from "./types";
export const STORY_TEMPLATE_LIST: readonly StoryTemplate[] = STORY_TEMPLATE_CATALOG.map((entry) => ({
  ...entry, render: designs[entry.key],
}));

export function getStoryTemplate(key: string | null | undefined): StoryTemplate {
  return STORY_TEMPLATE_LIST.find((template) => template.key === key) ?? STORY_TEMPLATE_LIST[0];
}

export function renderStory(key: string | null | undefined, props: StoryProps) {
  const template = getStoryTemplate(key);
  return template.render({ ...props, pollito: template.usesClub ? props.pollito : null });
}

// Compatibility entry point for existing consumers of the original two templates.
import { renderStory, type StoryProps } from "./story-templates";
import type { StoryTemplate } from "./shared";
export { STORY_W, STORY_H } from "./story-templates";
export type { StoryData } from "./story-templates";

export function storyElement({ template, ...props }: StoryProps & { template: StoryTemplate }) {
  return renderStory(template, props);
}

import type { ReactElement } from "react";
import type { StoryClub } from "../shared";
import type { StoryTemplateKey } from "./catalog";

export interface StoryData {
  slug: string; name: string; prize_kind: "dinero" | "texto"; prize_cop: number | null; prize_text: string | null;
  number_count: number; price_cop: number; lottery_name: string; draw_at: string; status: string;
  winning_number: number | null; taken: number[];
}
export interface StoryProps {
  r: StoryData; club: StoryClub; appHost: string;
  /** Local PNG data URIs; rendering never fetches assets. */
  logo: string; pollito: string | null;
}
export interface StoryTemplate {
  key: StoryTemplateKey; label: string; usesClub: boolean;
  render(props: StoryProps): ReactElement;
}

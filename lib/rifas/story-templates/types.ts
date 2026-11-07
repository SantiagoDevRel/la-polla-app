import type { ReactElement } from "react";
import type { StoryClub } from "../shared";
import type { AnyStoryTemplateKey } from "./catalog";

export interface StoryData {
  slug: string; name: string; prize_kind: "dinero" | "texto"; prize_cop: number | null; prize_text: string | null;
  number_count: number; price_cop: number; lottery_name: string; draw_at: string; status: string;
  winning_number: number | null; taken: number[];
}
/** Arte de la barra para sus plantillas (data URIs locales). */
export interface StoryPartnerArt { escudo: string; trapo: string; background: string | null }
export interface StoryProps {
  r: StoryData; club: StoryClub; appHost: string;
  /** Local PNG data URIs; rendering never fetches assets. */
  logo: string; pollito: string | null;
  partner?: StoryPartnerArt | null;
  /** Foto del premio de frente (PNG data URI, fondo transparente): va al lado del texto del premio. */
  prizeImage?: string | null;
}
export interface StoryTemplate {
  key: AnyStoryTemplateKey; label: string; usesClub: boolean;
  /** Plantilla de una barra: siempre lleva su pollito barrista. */
  partner?: "lds";
  render(props: StoryProps): ReactElement;
}

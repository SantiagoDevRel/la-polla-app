import "server-only";
import { z } from "zod";

const slotSchema = z.object({
  slot_id: z.string().min(1).max(100),
  order: z.number().int().min(0),
  stage: z.enum(["cuadrangulares", "final"]),
  stage_label: z.string().min(1).max(100),
  group: z.enum(["A", "B"]).nullable(),
  matchday: z.number().int().min(1).max(6).nullable(),
  game_in_group_matchday: z.number().int().min(1).max(2).nullable(),
  leg: z.union([z.string().max(30), z.number().int().min(1).max(2)]).nullable(),
  label: z.string().min(1).max(200),
  home_label: z.string().min(1).max(100),
  away_label: z.string().min(1).max(100),
  home_team: z.null(),
  away_team: z.null(),
  scheduled_at: z.null(),
  match_id: z.null(),
});

export const casaPrivateDraftSchema = z.object({
  version: z.literal(1),
  allowed_admin_ids: z.array(z.string().uuid()).min(1).max(10),
  tie_break: z.literal("earliest_registration"),
  slots: z.array(slotSchema).min(1).max(100),
  image_path: z.string().max(300).regex(/^[a-f0-9-]{36}\/[a-z0-9][a-z0-9._-]*\.(?:png|jpe?g|webp)$/i).nullable(),
  sources: z.array(z.object({ title: z.string().min(1).max(200), url: z.string().url().startsWith("https://") })).max(20),
  schedule_confirmed: z.literal(false),
  motion: z.object({
    video_path: z.string().max(300).regex(/^[a-f0-9-]{36}\/[a-z0-9][a-z0-9._-]*\.webm$/i),
    animation_path: z.string().max(300).regex(/^[a-f0-9-]{36}\/[a-z0-9][a-z0-9._-]*\.webp$/i),
  }).strict().optional(),
  presentation: z.object({
    competitionLabel: z.string().min(1).max(120),
    tagline: z.string().min(1).max(200),
    prizeCaption: z.string().min(1).max(200),
    imageAlt: z.string().min(1).max(200),
  }).strict().optional(),
}).passthrough().superRefine((draft, ctx) => {
  if (new Set(draft.allowed_admin_ids).size !== draft.allowed_admin_ids.length) {
    ctx.addIssue({ code: "custom", message: "Duplicate draft administrators", path: ["allowed_admin_ids"] });
  }
  if (new Set(draft.slots.map(slot => slot.slot_id)).size !== draft.slots.length) {
    ctx.addIssue({ code: "custom", message: "Duplicate draft slots", path: ["slots"] });
  }
});

export type CasaPrivateDraft = z.infer<typeof casaPrivateDraftSchema>;
export type CasaPrivateDraftSlot = z.infer<typeof slotSchema>;
export type CasaDraftViewer = { id: string; is_admin: boolean } | null;

/** Admin-only payload: never send the allowlist through a public/client payload. */
export function parseCasaPrivateDraft(value: unknown): CasaPrivateDraft | null {
  const result = casaPrivateDraftSchema.safeParse(value);
  return result.success ? result.data : null;
}

/** Service-role reads must select campaign_draft explicitly. Missing data fails closed. */
export function canAccessCasaPolla(polla: { campaign_draft?: unknown }, user: CasaDraftViewer): boolean {
  if (polla.campaign_draft === null) return true;
  if (!user?.is_admin) return false;
  const draft = parseCasaPrivateDraft(polla.campaign_draft);
  return draft !== null && draft.allowed_admin_ids.includes(user.id);
}

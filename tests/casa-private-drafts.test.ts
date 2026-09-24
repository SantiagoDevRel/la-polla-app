import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { canAccessCasaPolla, parseCasaPrivateDraft } from "@/lib/casa/private-drafts";

const allowed = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const draft = {
  version: 1, allowed_admin_ids: [allowed], tie_break: "earliest_registration",
  image_path: null, sources: [{ title: "Official fixture", url: "https://example.org/rules" }],
  schedule_confirmed: false,
  slots: [{ slot_id: "a-j1-p1", order: 1, stage: "cuadrangulares", stage_label: "Cuadrangulares",
    group: "A", matchday: 1, game_in_group_matchday: 1, leg: null, label: "Group A, first game",
    home_label: "Home pending", away_label: "Away pending", home_team: null, away_team: null,
    scheduled_at: null, match_id: null }],
};

describe("private Casa campaign access", () => {
  it("admits only an explicitly selected administrator", () => {
    expect(canAccessCasaPolla({ campaign_draft: draft }, { id: allowed, is_admin: true })).toBe(true);
    expect(canAccessCasaPolla({ campaign_draft: draft }, { id: other, is_admin: true })).toBe(false);
    expect(canAccessCasaPolla({ campaign_draft: draft }, { id: allowed, is_admin: false })).toBe(false);
    expect(canAccessCasaPolla({ campaign_draft: draft }, null)).toBe(false);
  });

  it("fails closed when the service query omitted metadata or returned malformed metadata", () => {
    const viewer = { id: allowed, is_admin: true };
    expect(canAccessCasaPolla({}, viewer)).toBe(false);
    expect(canAccessCasaPolla({ campaign_draft: {} }, viewer)).toBe(false);
    expect(canAccessCasaPolla({ campaign_draft: { ...draft, allowed_admin_ids: [other] } }, viewer)).toBe(false);
    expect(canAccessCasaPolla({ campaign_draft: null }, null)).toBe(true);
  });

  it("accepts all three explicitly selected accounts without authorizing a fourth", () => {
    const third = "00000000-0000-4000-8000-000000000003";
    const value = { ...draft, allowed_admin_ids: [allowed, other, third] };
    expect(canAccessCasaPolla({ campaign_draft: value }, { id: third, is_admin: true })).toBe(true);
    expect(canAccessCasaPolla({ campaign_draft: value }, { id: "00000000-0000-4000-8000-000000000004", is_admin: true })).toBe(false);
  });

  it("does not silently turn planning slots into real fixtures or guessed dates", () => {
    expect(parseCasaPrivateDraft(draft)).not.toBeNull();
    expect(parseCasaPrivateDraft({ ...draft, slots: [{ ...draft.slots[0], match_id: allowed }] })).toBeNull();
    expect(parseCasaPrivateDraft({ ...draft, slots: [{ ...draft.slots[0], scheduled_at: "2026-12-01" }] })).toBeNull();
    expect(parseCasaPrivateDraft({ ...draft, slots: [draft.slots[0], draft.slots[0]] })).toBeNull();
    expect(parseCasaPrivateDraft({ ...draft, schedule_confirmed: true })).toBeNull();
  });

  it("rejects image paths outside a single campaign folder", () => {
    expect(parseCasaPrivateDraft({ ...draft, image_path: `${allowed}/iphone.jpg` })).not.toBeNull();
    for (const image_path of ["../iphone.jpg", `${allowed}/../other.jpg`, "https://example.org/phone.jpg"]) {
      expect(parseCasaPrivateDraft({ ...draft, image_path })).toBeNull();
    }
  });

  it("accepts optional motion assets as a complete local WebM/WebP pair", () => {
    const motion = { video_path: `${allowed}/prize-loop.v1.webm`, animation_path: `${allowed}/prize-loop.v1.webp` };
    expect(parseCasaPrivateDraft({ ...draft, motion })?.motion).toEqual(motion);
    expect(parseCasaPrivateDraft({ ...draft, motion: {
      video_path: `${allowed}/prize.WEBM`, animation_path: `${allowed}/prize.WEBP`,
    } })).not.toBeNull();
    expect(parseCasaPrivateDraft(draft)?.motion).toBeUndefined();
    expect(parseCasaPrivateDraft({ ...draft, motion: { video_path: motion.video_path } })).toBeNull();
    expect(parseCasaPrivateDraft({ ...draft, motion: { animation_path: motion.animation_path } })).toBeNull();
    expect(parseCasaPrivateDraft({ ...draft, motion: { ...motion, externalUrl: "https://example.org/clip.webm" } })).toBeNull();
  });

  it("rejects external, nested, encoded and wrong-format motion asset paths", () => {
    const motion = { video_path: `${allowed}/prize.webm`, animation_path: `${allowed}/prize.webp` };
    for (const field of ["video_path", "animation_path"] as const) {
      const ext = field === "video_path" ? "webm" : "webp";
      for (const path of [
        `https://example.org/prize.${ext}`, `../prize.${ext}`, `${allowed}/../prize.${ext}`,
        `${allowed}/nested/prize.${ext}`, `${allowed}/%2e%2e%2fprize.${ext}`,
        `${allowed}/prize.${ext}?download=1`, `${allowed}/prize.png`, `${allowed}/${"x".repeat(301)}.${ext}`,
      ]) {
        const invalid = { ...draft, motion: { ...motion, [field]: path } };
        expect(parseCasaPrivateDraft(invalid), path).toBeNull();
        expect(canAccessCasaPolla({ campaign_draft: invalid }, { id: allowed, is_admin: true }), path).toBe(false);
      }
    }
  });

  it("validates private presentation copy without requiring campaign literals in the renderer", () => {
    const presentation = { competitionLabel: "Tournament finals", tagline: "A campaign for the fans",
      prizeCaption: "Configured prize", imageAlt: "Photograph of the configured prize" };
    expect(parseCasaPrivateDraft({ ...draft, presentation })?.presentation).toEqual(presentation);
    expect(parseCasaPrivateDraft({ ...draft, presentation: { ...presentation, imageAlt: "x".repeat(201) } })).toBeNull();
    expect(parseCasaPrivateDraft({ ...draft, presentation: { ...presentation, unvalidatedCopy: "Extra" } })).toBeNull();
  });
});

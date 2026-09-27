import { describe, expect, it } from "vitest";
import { campaignTemplate, selectAudience, smsSize, type AudienceUser } from "./shared";

describe("campaign copy and audience", () => {
  it("counts extension septets and UTF-16 rather than visible characters", () => {
    expect(smsSize("a".repeat(160)).segments).toBe(1);
    expect(smsSize("a".repeat(161)).segments).toBe(2);
    expect(smsSize("^".repeat(81)).segments).toBe(2);
    expect(smsSize("🐥".repeat(36))).toEqual({ unicode: true, units: 72, segments: 2 });
  });
  it("keeps country and opt-out stronger than membership exceptions, deduplicates phones", () => {
    const users: AudienceUser[] = [
      { id: "a", name: "A", phone: "+571", country: "CO" },
      { id: "b", name: "B", phone: "+571", country: "CO" },
      { id: "c", name: "C", phone: "+572", country: "CO" },
      { id: "d", name: "D", phone: "+351", country: "PT" },
    ];
    const filter = { countries: ["CO"], selectedIds: null, excludedPollaIds: [], exceptionIds: ["a", "c", "d"] };
    expect(selectAudience(users, filter, new Set(["a", "c", "d"]), new Set(["+572"])).map(u => u.id)).toEqual(["a"]);
  });
  it("offers exactly opening and configurable closing with canonical link and actual amounts", () => {
    const polla = { id: "x", slug: "ofi-golazo-3", name: "OFI GOLAZO 3", entry: 20000, prize: "un premio mínimo garantizado de $1.000.000 COP", closesAt: "", game: "Acierta los resultados (1X2)" };
    expect(campaignTemplate(polla, "opening")).toContain("Entrada: $20.000 COP");
    expect(campaignTemplate(polla, "closing", 1)).toContain("se cierra mañana");
    expect(campaignTemplate(polla, "closing", 2)).toContain("se cierra en 2 días");
    expect(campaignTemplate(polla, "closing", 0)).toContain("https://lapollacolombiana.com/polla/ofi-golazo-3");
  });
});

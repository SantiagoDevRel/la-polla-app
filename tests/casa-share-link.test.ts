import { afterEach, describe, expect, it, vi } from "vitest";
import { shareLink } from "@/lib/casa/share-link";
import { referralLink } from "@/lib/casa/referrals-shared";
import { courtesyLink } from "@/lib/casa/courtesies-shared";

afterEach(() => vi.unstubAllGlobals());

describe("compartir el enlace de una polla", () => {
  const links = [
    referralLink("https://lapollacolombiana.com", "regalo", "ANA1234"),
    courtesyLink("https://lapollacolombiana.com", "regalo", "ABCDEFGHJK"),
    referralLink("https://chickenpicks.app", "regalo", null),
  ];

  it.each(links)("entrega solo la URL a la hoja nativa: %s", async (url) => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { share, clipboard: { writeText } });
    expect(await shareLink(url)).toBe("shared");
    expect(share).toHaveBeenCalledWith({ url });
    expect(writeText).not.toHaveBeenCalled();
  });

  it.each(links)("copia solo el enlace, conservando su código: %s", async (url) => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await shareLink(url)).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(url);
  });

  it("copia el enlace si compartir falla", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      share: vi.fn().mockRejectedValue(new DOMException("Denied", "NotAllowedError")),
      clipboard: { writeText },
    });
    expect(await shareLink(links[0])).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(links[0]);
  });

  it("cancelar no sobrescribe el portapapeles", async () => {
    const writeText = vi.fn();
    vi.stubGlobal("navigator", {
      share: vi.fn().mockRejectedValue(new DOMException("Cancelled", "AbortError")),
      clipboard: { writeText },
    });
    expect(await shareLink(links[0])).toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("no confirma copia si el navegador la rechaza", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("Denied")) } });
    await expect(shareLink(links[0])).rejects.toThrow("Denied");
  });
});

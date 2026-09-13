import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendPhoto: vi.fn(),
  sendMessage: vi.fn(),
  listActiveAdminChats: vi.fn(),
  createSignedUrl: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("@/lib/telegram/bot", () => ({ esc: (s: string) => s, sendPhoto: mocks.sendPhoto, sendMessage: mocks.sendMessage }));
vi.mock("@/lib/telegram/admin", () => ({ listActiveAdminChats: mocks.listActiveAdminChats }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: { from: () => ({ createSignedUrl: mocks.createSignedUrl }) },
    from: () => ({ insert: mocks.insert }),
  }),
}));

import { notifyNewProof } from "@/lib/telegram/notify";

const notice = {
  entryId: "entry", attemptId: "attempt", prizeKind: "pozo" as const, prizeObject: null, pollaName: "Polla",
  pollaSlug: "polla", userName: "Persona", amountCop: 10000, proofPath: "casa/p/e/a.jpg", potAfterCop: 7000,
};

describe("notifyNewProof", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listActiveAdminChats.mockResolvedValue([111]);
    mocks.createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://storage.local/signed" }, error: null });
    mocks.insert.mockResolvedValue({ error: null });
  });

  it("sends the photo when Telegram accepts it", async () => {
    mocks.sendPhoto.mockResolvedValue({ message_id: 5 });
    await notifyNewProof(notice);
    expect(mocks.sendPhoto).toHaveBeenCalledTimes(1);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ message_id: 5, kind: "proof_review" }));
  });

  it("falls back to a text message with the same buttons when sendPhoto fails", async () => {
    mocks.sendPhoto.mockResolvedValue(null);
    mocks.sendMessage.mockResolvedValue({ message_id: 6 });
    await notifyNewProof(notice);
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    const [chat, text, buttons] = mocks.sendMessage.mock.calls[0];
    expect(chat).toBe(111);
    expect(text).toContain("No pude mostrar la foto del comprobante");
    expect(buttons).toEqual(mocks.sendPhoto.mock.calls[0][3]);
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ message_id: 6 }));
  });

  it("sends text when the proof URL cannot be signed", async () => {
    mocks.createSignedUrl.mockResolvedValue({ data: null, error: { message: "missing" } });
    mocks.sendMessage.mockResolvedValue({ message_id: 7 });
    await notifyNewProof(notice);
    expect(mocks.sendPhoto).not.toHaveBeenCalled();
    expect(mocks.sendMessage.mock.calls[0][1]).toContain("No pude cargar el comprobante");
  });
});

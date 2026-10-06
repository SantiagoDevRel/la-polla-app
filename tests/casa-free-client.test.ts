import { afterEach, expect, it, vi } from "vitest";
import { joinFreePolla } from "@/lib/casa/join-free";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
afterEach(() => vi.unstubAllGlobals());
it("requires an exact enrollment ACK, not HTTP 200", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(json({ ok: true })).mockResolvedValueOnce(json({ ok: true, owner_id: "session-user", slug: "gift", joined: false, entry: null }));
  vi.stubGlobal("fetch", fetch);
  expect(await joinFreePolla("gift", "session-user")).toMatchObject({ ok: false, kind: "uncertain" });
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("returns authentication failure without a false success or second write", async () => {
  const fetch = vi.fn().mockResolvedValue(json({ error: "expired" }, 401)); vi.stubGlobal("fetch", fetch);
  expect(await joinFreePolla("gift", "session-user")).toMatchObject({ ok: false, kind: "auth" });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("recovers a committed enrollment after losing the response using only GET", async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce(json({
    ok: true, owner_id: "session-user", slug: "gift", joined: true, entry: { entry_id: "entry", entry_number: 1, status: "pagada" },
  })); vi.stubGlobal("fetch", fetch);
  expect(await joinFreePolla("gift", "session-user")).toEqual({ ok: true });
  expect(fetch.mock.calls.map(([, init]) => init.method ?? "GET")).toEqual(["POST", "GET"]);
});
it("never confirms HTML or somebody else's slug", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response("<html>login</html>")).mockResolvedValueOnce(json({
    ok: true, slug: "other", joined: true, entry: { entry_id: "entry", entry_number: 1, status: "pagada" },
  })); vi.stubGlobal("fetch", fetch);
  expect(await joinFreePolla("gift", "session-user")).toMatchObject({ ok: false, kind: "uncertain" });
});
it("a paid or closed rejection is preserved without reconciliation", async () => {
  const fetch = vi.fn().mockResolvedValue(json({ error: "closed" }, 409)); vi.stubGlobal("fetch", fetch);
  expect(await joinFreePolla("gift", "session-user")).toMatchObject({ ok: false, kind: "rejected", error: "closed" });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("does not confirm another account's paid enrollment after a lost response", async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error("lost")).mockResolvedValueOnce(json({ ok: true, owner_id: "other-user", slug: "gift", joined: true,
    entry: { entry_id: "other-entry", entry_number: 1, status: "pagada" } })); vi.stubGlobal("fetch", fetch);
  expect(await joinFreePolla("gift", "session-user")).toMatchObject({ ok: false, kind: "account" });
  expect(fetch.mock.calls[0][1].headers).toMatchObject({ "X-Casa-Owner": "session-user" });
});
it("blocks a write without a stable original account", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  expect(await joinFreePolla("gift")).toMatchObject({ ok: false, kind: "auth" }); expect(fetch).not.toHaveBeenCalled();
});
it("classifies HTTP 412 by its precondition status without relying on the error text", async () => {
  const fetch = vi.fn().mockResolvedValue(json({ code: "ACCOUNT_CHANGED", error: "different wording" }, 412)); vi.stubGlobal("fetch", fetch);
  expect(await joinFreePolla("gift", "session-user")).toMatchObject({ ok: false, kind: "account", error: "different wording" });
  expect(fetch).toHaveBeenCalledTimes(1);
});

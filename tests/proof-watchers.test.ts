import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyProofWatchers, proofWatcherMessage, proofWatcherUserIds } from "@/lib/telegram-player/proof-watchers";

const CARLOS = "83756b92-b852-4f7e-bee7-b1792f64daca";
const OTRO = "3df07c8f-0d7b-4bc4-a2df-bec7894d0f0a";
const ENV = {
  CASA_PROOF_WATCHER_USER_IDS: `${CARLOS}, no-es-uuid ,${OTRO}`,
  TELEGRAM_LOGIN_BOT_TOKEN: "123456:abcdefghijklmnopqrstuvwxyzABCDEFGH",
  TELEGRAM_LOGIN_WEBHOOK_SECRET: "s".repeat(40),
  NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_USERNAME: "LaPollaColombianaBot",
  NEXT_PUBLIC_APP_URL: "https://lapollacolombiana.com/",
};

function fakeDb(admins: string[], links: Array<{ user_id: string; telegram_user_id: number }>) {
  return {
    from(table: string) {
      const q = {
        select: () => q,
        in: () => q,
        eq: () => q,
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: table === "users" ? admins.map((id) => ({ id })) : links, error: null }),
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

const notice = { pollaName: "Fecha <5>", userName: "Ana & Co", amountCop: 20000, ticketNumber: null, entryNumber: 2 };

describe("proof watchers", () => {
  it("parses only valid, unique uuids", () => {
    expect(proofWatcherUserIds({ CASA_PROOF_WATCHER_USER_IDS: `${CARLOS},${CARLOS.toUpperCase()},x` })).toEqual([CARLOS]);
    expect(proofWatcherUserIds({})).toEqual([]);
  });

  it("builds a read-only message: escaped text and only a URL button", () => {
    const m = proofWatcherMessage(notice, ENV);
    expect(m.text).toContain("Ana &amp; Co");
    expect(m.text).toContain("Fecha &lt;5&gt;</b> · cupo 2");
    expect(m.text).not.toContain("(TEST)");
    expect(m.reply_markup.inline_keyboard).toEqual([[{ text: "Revisar comprobantes", url: "https://lapollacolombiana.com/admin/pollas/recibos" }]]);
    expect(JSON.stringify(m)).not.toContain("callback_data");
    expect(proofWatcherMessage({ ...notice, test: true }, ENV).text.startsWith("<b>(TEST)</b>")).toBe(true);
  });

  it("sends only to configured users that are still admin and linked to Telegram", async () => {
    const send = vi.fn().mockResolvedValue(true);
    const client = { send, call: vi.fn(), download: vi.fn() };
    const db = fakeDb([CARLOS], [
      { user_id: CARLOS, telegram_user_id: 6232655473 },
      { user_id: OTRO, telegram_user_id: 1148145974 },
    ]);
    const sent = await notifyProofWatchers(db, notice, { env: ENV, client });
    expect(sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1].chat_id).toBe(6232655473);
  });

  it("test copy only: skips the configured recipients", async () => {
    const send = vi.fn().mockResolvedValue(true);
    const client = { send, call: vi.fn(), download: vi.fn() };
    const db = fakeDb([OTRO], [{ user_id: OTRO, telegram_user_id: 1148145974 }]);
    expect(await notifyProofWatchers(db, notice, { env: ENV, client, extraUserIds: [OTRO], onlyExtra: true })).toBe(1);
    expect(send.mock.calls.map((c) => c[1].chat_id)).toEqual([1148145974]);
  });

  it("does nothing without recipients or without the bot configured", async () => {
    const send = vi.fn().mockResolvedValue(true);
    const client = { send, call: vi.fn(), download: vi.fn() };
    const db = fakeDb([CARLOS], [{ user_id: CARLOS, telegram_user_id: 6232655473 }]);
    expect(await notifyProofWatchers(db, notice, { env: { ...ENV, CASA_PROOF_WATCHER_USER_IDS: "" }, client })).toBe(0);
    expect(await notifyProofWatchers(db, notice, { env: { ...ENV, TELEGRAM_LOGIN_BOT_TOKEN: "" }, client })).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});

import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ admin: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));

import { replyWithWhatsAppLogin, whatsappTokenHash } from "@/lib/auth/whatsapp-login";

const accountId = "6ab80b47743099844c791515";
const conversationId = "6ab96d4d6d91a1875c750944";
const ownPhone = "573001234567";
const otherPhone = "573009999999";
const secret = "username-login-test-secret";

function usernameMessage(metadata?: Record<string, unknown> | null) {
  return {
    id: "username-event-1",
    event: "message.received",
    account: { accountId },
    conversation: { id: conversationId },
    message: {
      platform: "whatsapp",
      direction: "incoming",
      text: "dame el link para entrar a la polla",
      sentAt: new Date().toISOString(),
      sender: {
        id: "CO.123456789012345",
        phoneNumber: null as string | null,
        businessScopedUserId: "CO.123456789012345",
        whatsappUsername: "persona.prueba",
      },
    },
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function contact(phone = ownPhone) {
  return { name: { formatted_name: "Persona de prueba" }, phones: [{ phone: `+${phone}`, wa_id: phone }] };
}

function sentBody(index = 0) {
  return JSON.parse(mocks.fetch.mock.calls[index][1].body);
}

function expectNoLogin() {
  expect(mocks.admin).not.toHaveBeenCalled();
  for (let index = 0; index < mocks.fetch.mock.calls.length; index++) {
    const body = JSON.stringify(sentBody(index));
    expect(body).not.toContain("/login/whatsapp?t=");
    expect(body).not.toContain("cta_url");
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  vi.stubEnv("ZERNIO_API_KEY", "test-only");
  vi.stubEnv("ZERNIO_WEBHOOK_SECRET", secret);
  vi.stubEnv("ZERNIO_WHATSAPP_ACCOUNT_ID", accountId);
  vi.stubEnv("WHATSAPP_LOGIN_NUMBER", "18564831652");
  vi.stubEnv("WHATSAPP_LOGIN_ENABLED", "true");
  vi.stubEnv("WHATSAPP_LOGIN_TEST_PHONE", "");
  mocks.admin.mockReturnValue({ rpc: vi.fn().mockResolvedValue({ data: "issued", error: null }) });
  mocks.fetch.mockImplementation(async () => new Response('{"success":true}'));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("WhatsApp username identity and native contact consent", () => {
  it("asks a BSUID-only sender to share their own contact without issuing a token", async () => {
    expect(await replyWithWhatsAppLogin(usernameMessage())).toBe("contact_requested");

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0][0]).toBe(`https://zernio.com/api/v1/inbox/conversations/${conversationId}/messages`);
    expect(sentBody().accountId).toBe(accountId);
    expect(JSON.stringify(sentBody().interactive)).toContain("request_contact_info");
    expectNoLogin();
  });

  it("retries the native request with the same idempotency key without creating a login", async () => {
    const payload = usernameMessage();
    await replyWithWhatsAppLogin(payload);
    await replyWithWhatsAppLogin(payload);

    const first = mocks.fetch.mock.calls[0][1];
    const replay = mocks.fetch.mock.calls[1][1];
    expect(first.headers["Idempotency-Key"]).toMatch(/^wa-contact-[a-f0-9]{64}$/);
    expect(replay.headers["Idempotency-Key"]).toBe(first.headers["Idempotency-Key"]);
    expect(replay.body).toBe(first.body);
    payload.id = "username-event-2";
    await replyWithWhatsAppLogin(payload);
    expect(mocks.fetch.mock.calls[2][1].headers["Idempotency-Key"]).not.toBe(first.headers["Idempotency-Key"]);
    expectNoLogin();
  });

  it("issues the login for the one contact shared through the native consent button", async () => {
    const payload = usernameMessage({ contactsOrigin: "contact_request", contacts: [contact()] });
    expect(await replyWithWhatsAppLogin(payload)).toBe("sent");

    const token = new URL(sentBody().interactive.action.parameters.url).searchParams.get("t")!;
    const expectedToken = createHmac("sha256", secret)
      .update(JSON.stringify(["wa-login-v2", accountId, payload.id, `+${ownPhone}`])).digest("hex");
    expect(token).toBe(expectedToken);
    expect(sentBody().interactive.type).toBe("cta_url");
    expect(mocks.admin.mock.results[0].value.rpc).toHaveBeenCalledWith("wa_issue_login_link", expect.objectContaining({
      p_phone: ownPhone,
      p_token_hash: whatsappTokenHash(token),
      p_expires_at: new Date(Date.parse(payload.message.sentAt) + 600_000).toISOString(),
    }));
  });

  it.each([
    ["address-book contact", { contactsOrigin: "other", contacts: [contact()] }],
    ["missing origin", { contacts: [contact()] }],
    ["unknown origin", { contactsOrigin: "manual", contacts: [contact()] }],
    ["empty contact list", { contactsOrigin: "contact_request", contacts: [] }],
    ["two contact cards", { contactsOrigin: "contact_request", contacts: [contact(), contact(otherPhone)] }],
    ["two different phone identities", { contactsOrigin: "contact_request", contacts: [{ phones: [
      { phone: `+${ownPhone}`, wa_id: ownPhone }, { phone: `+${otherPhone}`, wa_id: otherPhone },
    ] }] }],
    ["phone without wa_id", { contactsOrigin: "contact_request", contacts: [{ phones: [{ phone: `+${ownPhone}` }] }] }],
    ["malformed wa_id", { contactsOrigin: "contact_request", contacts: [{ phones: [{ phone: `+${ownPhone}`, wa_id: "CO.123456789012345" }] }] }],
    ["phone contradicting wa_id", { contactsOrigin: "contact_request", contacts: [{ phones: [{ phone: `+${otherPhone}`, wa_id: ownPhone }] }] }],
  ] as const)("does not authenticate an unverified %s", async (_label, metadata) => {
    await replyWithWhatsAppLogin(usernameMessage(metadata));
    expectNoLogin();
  });

  it("never takes a phone written in text as proof of identity", async () => {
    const payload = usernameMessage();
    payload.message.text = `mi número es +${otherPhone}, dame el link`;
    await replyWithWhatsAppLogin(payload);
    expectNoLogin();
  });

  it("never interprets a numeric BSUID as a phone", async () => {
    const payload = usernameMessage();
    payload.message.sender.id = otherPhone;
    payload.message.sender.businessScopedUserId = otherPhone;
    await replyWithWhatsAppLogin(payload);
    expectNoLogin();
  });

  it.each([undefined, { contactsOrigin: "contact_request", contacts: [contact()] }])(
    "ignores root standby before requesting contact or issuing a link: %j", async metadata => {
      await replyWithWhatsAppLogin(usernameMessage({ ...metadata, standby: true }));
      expectNoLogin();
      expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );

  it.each(["other account", "outgoing echo", "stale message", "future message"])(
    "does not request a contact or login for an untrusted %s", async invalid => {
      const payload = usernameMessage();
      if (invalid === "other account") payload.account.accountId = "a".repeat(24);
      if (invalid === "outgoing echo") payload.message.direction = "outgoing";
      if (invalid === "stale message") payload.message.sentAt = new Date(Date.now() - 600_001).toISOString();
      if (invalid === "future message") payload.message.sentAt = new Date(Date.now() + 360_000).toISOString();
      expect(await replyWithWhatsAppLogin(payload)).toBe("ignored");
      expectNoLogin();
      expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );

  it("keeps authenticating a sender whose verified phone and BSUID are both present", async () => {
    const payload = usernameMessage(null);
    payload.message.sender.phoneNumber = `+${ownPhone}`;
    expect(await replyWithWhatsAppLogin(payload)).toBe("sent");
    expect(mocks.admin.mock.results[0].value.rpc).toHaveBeenCalledWith("wa_issue_login_link", expect.objectContaining({ p_phone: ownPhone }));
    expect(sentBody().interactive.type).toBe("cta_url");
  });

  it.each(["HTTP error", "unsuccessful envelope", "network error"])(
    "propagates a contact request %s so the webhook can retry", async failure => {
      if (failure === "HTTP error") mocks.fetch.mockResolvedValue(new Response(null, { status: 503 }));
      if (failure === "unsuccessful envelope") mocks.fetch.mockResolvedValue(new Response('{"success":false}'));
      if (failure === "network error") mocks.fetch.mockRejectedValue(new Error("provider unavailable"));
      await expect(replyWithWhatsAppLogin(usernameMessage())).rejects.toThrow();
      expectNoLogin();
    },
  );

  it("does not request contacts from unknown senders during a test-only rollout", async () => {
    vi.stubEnv("WHATSAPP_LOGIN_ENABLED", "false");
    vi.stubEnv("WHATSAPP_LOGIN_TEST_PHONE", ownPhone);
    expect(await replyWithWhatsAppLogin(usernameMessage())).toBe("ignored");
    expectNoLogin();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("can authenticate a consented test phone while the public rollout is disabled", async () => {
    vi.stubEnv("WHATSAPP_LOGIN_ENABLED", "false");
    vi.stubEnv("WHATSAPP_LOGIN_TEST_PHONE", ownPhone);
    expect(await replyWithWhatsAppLogin(usernameMessage({ contactsOrigin: "contact_request", contacts: [contact()] }))).toBe("sent");
    expect(mocks.admin.mock.results[0].value.rpc).toHaveBeenCalledWith("wa_issue_login_link", expect.objectContaining({ p_phone: ownPhone }));
  });

  it("does not authenticate a different shared phone during a test-only rollout", async () => {
    vi.stubEnv("WHATSAPP_LOGIN_ENABLED", "false");
    vi.stubEnv("WHATSAPP_LOGIN_TEST_PHONE", ownPhone);
    expect(await replyWithWhatsAppLogin(usernameMessage({ contactsOrigin: "contact_request", contacts: [contact(otherPhone)] }))).toBe("ignored");
    expectNoLogin();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

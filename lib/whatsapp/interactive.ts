// lib/whatsapp/interactive.ts — Helper functions for WhatsApp Cloud API interactive messages
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-reply-buttons-messages

// Resolve env at call time, not module-load. Module-level throws break
// Vercel's build "collect page data" pass when any preview env scope
// lacks META_WA_*. Defer the check so unrelated builds stay green.
function getWhatsAppConfig(): { token: string; url: string } {
  const token = process.env.META_WA_ACCESS_TOKEN;
  const phoneNumberId = process.env.META_WA_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    throw new Error(
      "[whatsapp] Missing required env: META_WA_ACCESS_TOKEN and/or " +
      "META_WA_PHONE_NUMBER_ID. Refusing to send — sends would 404 " +
      "at runtime otherwise.",
    );
  }
  return {
    token,
    url: `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
  };
}

async function sendInteractive(to: string, payload: Record<string, unknown>) {
  const { token, url } = getWhatsAppConfig();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: payload,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error("[WA interactive] Error:", res.status, JSON.stringify(err));
    throw new Error(`WhatsApp API error: ${res.status}`);
  }
}

/**
 * Send a message with up to 3 tap buttons.
 * buttons: array of { id, title } — max 3, title max 20 chars
 */
export async function sendReplyButtons(
  to: string,
  body: string,
  buttons: { id: string; title: string }[],
  header?: string,
  footer?: string
): Promise<void> {
  const interactive: Record<string, unknown> = {
    type: "button",
    body: { text: body },
    action: {
      buttons: buttons.slice(0, 3).map((b) => ({
        type: "reply",
        reply: { id: b.id, title: b.title.slice(0, 20) },
      })),
    },
  };
  if (header) interactive.header = { type: "text", text: header };
  if (footer) interactive.footer = { text: footer };

  await sendInteractive(to, interactive);
}

/**
 * Send a message with a scrollable list of options.
 * sections: array of { title, rows: { id, title, description? }[] }
 * max 10 rows total, title max 24 chars, description max 72 chars
 */
export async function sendListMessage(
  to: string,
  body: string,
  buttonLabel: string,
  sections: {
    title: string;
    rows: { id: string; title: string; description?: string }[];
  }[],
  header?: string,
  footer?: string
): Promise<void> {
  const trimmedSections = sections.map((s) => ({
    title: s.title,
    rows: s.rows.map((r) => ({
      id: r.id,
      title: r.title.slice(0, 24),
      description: r.description?.slice(0, 72) || "",
    })),
  }));

  const interactive: Record<string, unknown> = {
    type: "list",
    body: { text: body },
    action: {
      button: buttonLabel.slice(0, 20),
      sections: trimmedSections,
    },
  };
  if (header) interactive.header = { type: "text", text: header };
  if (footer) interactive.footer = { text: footer };

  await sendInteractive(to, interactive);
}

/**
 * Send a message with a single URL CTA button.
 */
export async function sendCTAButton(
  to: string,
  body: string,
  buttonLabel: string,
  url: string,
  footer?: string
): Promise<void> {
  const interactive: Record<string, unknown> = {
    type: "cta_url",
    body: { text: body },
    action: {
      name: "cta_url",
      parameters: {
        display_text: buttonLabel,
        url: url.trim(),
      },
    },
  };
  if (footer) interactive.footer = { text: footer };

  await sendInteractive(to, interactive);
}

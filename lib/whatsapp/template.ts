// lib/whatsapp/template.ts — Wrapper de Meta WhatsApp Cloud API para
// enviar template messages (HSMs).
//
// Diferente de sendTextMessage / sendInteractive: los templates se usan
// FUERA del window de 24h del user. Meta cobra por template (Utility ~
// $0.005 USD en Colombia, Marketing ~$0.0125).
//
// Templates tienen que estar pre-aprobados en Meta Business Manager.
// Acá solo los referenciamos por `name` + `language` + `components`.

const GRAPH_API_VERSION = "v21.0";

/**
 * Componentes de un template message segun la spec de Meta:
 * https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates
 *
 * - "header": variables del header (image/video/text)
 * - "body": variables del body — array ordenado matchea {{1}}, {{2}}, etc.
 * - "button": parametros para botones URL dinamicos (no aplica si la URL del
 *    botón es estática como en nuestro caso). Lo dejamos disponible por si
 *    en el futuro queremos URL parametrizada.
 */
export type TemplateComponent =
  | { type: "body"; parameters: Array<{ type: "text"; text: string }> }
  | { type: "header"; parameters: Array<{ type: "text"; text: string }> }
  | {
      type: "button";
      sub_type: "url";
      index: string;
      parameters: Array<{ type: "text"; text: string }>;
    };

export interface SendTemplateResult {
  ok: boolean;
  messageId?: string; // wamid devuelto por Meta
  error?: string;
}

/**
 * Envia un template message via Meta Cloud API.
 *
 * @param to       E.164 sin "+" — ej "573117312391"
 * @param templateName   Nombre exacto del template aprobado en Meta
 * @param languageCode   "es" / "es_CO" / "en_US" — debe matchear el
 *                       template aprobado
 * @param components     Variables del template (body params, etc.)
 */
export async function sendTemplateMessage(
  to: string,
  templateName: string,
  languageCode: string,
  components: TemplateComponent[],
): Promise<SendTemplateResult> {
  const token = process.env.META_WA_ACCESS_TOKEN;
  const phoneNumberId = process.env.META_WA_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    return { ok: false, error: "META_WA_ACCESS_TOKEN/PHONE_NUMBER_ID missing" };
  }

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;
  const body = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      components,
    },
  };

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return {
        ok: false,
        error: `Meta API ${resp.status}: ${text.slice(0, 300)}`,
      };
    }
    const data = (await resp.json()) as {
      messages?: Array<{ id: string }>;
    };
    return {
      ok: true,
      messageId: data.messages?.[0]?.id,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "fetch failed",
    };
  }
}

/**
 * Costo aproximado por template en USD para Colombia. Meta no devuelve
 * costo por mensaje en la API — son tarifas publicas que actualizan
 * trimestralmente. Usado solo para el admin dashboard MTD spend, NO
 * para billing.
 *
 * Pricing dec 2025 (Colombia, en USD):
 *   utility:        ~0.0050
 *   marketing:      ~0.0125
 *   authentication: ~0.0035
 *   service (within 24h window): GRATIS
 */
export function estimateTemplateCost(
  category: "marketing" | "utility" | "authentication" | "service",
): number {
  switch (category) {
    case "utility":
      return 0.005;
    case "marketing":
      return 0.0125;
    case "authentication":
      return 0.0035;
    case "service":
      return 0;
    default:
      return 0;
  }
}

// lib/whatsapp-zernio/pick-flow-json.ts — static WhatsApp Flow JSON for the
// one-screen 1X2 form. Dependency-free so scripts/zernio-pick-flow.mjs can load
// it with plain Node. Published flows are immutable: a change here requires a
// new published flow and updating ZERNIO_WHATSAPP_PICKS_FLOW_ID.

/** Meta allows 50 components per screen: intro + slots + footer stays far below. */
export const PICK_FLOW_SLOTS = 20;
export const PICK_FLOW_SCREEN = "PICKS";
export const PICK_FLOW_TOKEN_PREFIX = "lp-picks:";

const slots = Array.from({ length: PICK_FLOW_SLOTS }, (_, i) => i + 1);
const option = { type: "object", properties: { id: { type: "string" }, title: { type: "string" } } };

/** Static Flow JSON. Changing it requires publishing a new flow (published flows are immutable). */
export function buildPickFlowJson() {
  const data: Record<string, unknown> = {
    intro: { type: "string", __example__: "Escoge quién gana en cada partido." },
    p: { type: "string", __example__: "00000000-0000-4000-8000-000000000000" },
  };
  for (const n of slots) {
    data[`k${n}`] = { type: "string", __example__: "00000000-0000-4000-8000-000000000001" };
    data[`l${n}`] = { type: "string", __example__: "Nacional vs Millonarios" };
    data[`d${n}`] = { type: "string", __example__: "sáb 1 nov · 6:00 p. m." };
    data[`o${n}`] = { type: "array", items: option, __example__: [{ id: "L", title: "Gana Nacional" }, { id: "E", title: "Empate" }, { id: "V", title: "Gana Millonarios" }] };
    data[`v${n}`] = { type: "boolean", __example__: true };
  }
  const payload: Record<string, string> = { p: "${data.p}" };
  for (const n of slots) {
    payload[`k${n}`] = `\${data.k${n}}`;
    payload[`r${n}`] = `\${form.r${n}}`;
  }
  return {
    version: "7.1",
    screens: [{
      id: PICK_FLOW_SCREEN, title: "Pronósticos", terminal: true, success: true, data,
      layout: {
        type: "SingleColumnLayout",
        children: [
          { type: "TextBody", text: "${data.intro}" },
          ...slots.map(n => ({
            type: "RadioButtonsGroup", name: `r${n}`, label: `\${data.l${n}}`, description: `\${data.d${n}}`,
            "data-source": `\${data.o${n}}`, visible: `\${data.v${n}}`, required: false,
          })),
          { type: "Footer", label: "Guardar", "on-click-action": { name: "complete", payload } },
        ],
      },
    }],
  };
}

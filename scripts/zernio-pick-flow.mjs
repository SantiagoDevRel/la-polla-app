// scripts/zernio-pick-flow.mjs — create, check and publish the one-screen 1X2
// WhatsApp Flow through Zernio. Run with the key in the environment only:
//   node tools/secrets.mjs run --vars zernio.env -- node --experimental-strip-types \
//     scripts/zernio-pick-flow.mjs <create|status|upload|publish> [flowId]
// ZERNIO_WHATSAPP_ACCOUNT_ID must also be set. Publishing is irreversible: the
// flow becomes immutable. Prints ids and Meta validation errors, never the key.
import { buildPickFlowJson } from "../lib/whatsapp-zernio/pick-flow-json.ts";

const [command, flowId] = process.argv.slice(2);
const key = process.env.ZERNIO_API_KEY;
const accountId = process.env.ZERNIO_WHATSAPP_ACCOUNT_ID;
if (!key || !/^[a-f0-9]{24}$/.test(accountId ?? "")) throw new Error("ZERNIO_API_KEY and ZERNIO_WHATSAPP_ACCOUNT_ID are required");
if (command !== "create" && !/^\d{6,20}$/.test(flowId ?? "")) throw new Error("Flow id required");

async function call(method, path, body) {
  const response = await fetch(`https://zernio.com/api/v1${path}`, {
    method, redirect: "error", signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

const show = ({ status, data }) => console.log(JSON.stringify({ status, success: data.success, id: data.flow?.id, flowStatus: data.flow?.status,
  validation_errors: data.validation_errors ?? data.flow?.validation_errors, error: data.error, code: data.code }, null, 2));

if (command === "create") {
  const created = await call("POST", "/whatsapp/flows", { accountId, name: "La Polla pronosticos 1X2", categories: ["OTHER"] });
  show(created);
  if (created.data.flow?.id) show(await call("PUT", `/whatsapp/flows/${created.data.flow.id}/json`, { accountId, flow_json: buildPickFlowJson() }));
} else if (command === "upload") {
  show(await call("PUT", `/whatsapp/flows/${flowId}/json`, { accountId, flow_json: buildPickFlowJson() }));
} else if (command === "status") {
  show(await call("GET", `/whatsapp/flows/${flowId}?accountId=${accountId}`));
} else if (command === "publish") {
  show(await call("POST", `/whatsapp/flows/${flowId}/publish`, { accountId }));
} else {
  throw new Error("Unknown command");
}

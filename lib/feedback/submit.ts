import { requestJson } from "@/lib/http/json-request";

export type FeedbackInput = { message: string; pageUrl: string | null; requestId: string; ownerId: string };
type FeedbackAck = { ok: true; owner_id: string; id: string; request_id: string };
type FeedbackRead = { ok: true; owner_id: string; request_id: string; report: null | { id: string; request_id: string; message: string; page_url: string | null } };
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** Keep the request identity until confirmed. Only the user's original report counts. */
export async function submitFeedback(input: FeedbackInput) {
  const result = await requestJson("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json", "X-Feedback-Owner": input.ownerId }, body: JSON.stringify(input) },
    (value): value is FeedbackAck => isRecord(value) && value.ok === true && value.owner_id === input.ownerId && value.request_id === input.requestId
      && typeof value.id === "string" && value.id.length > 0);
  if (result.ok) return result;
  if (result.status === 412) return { ok: false as const, kind: "account" as const, error: result.error };
  if (result.kind !== "uncertain") return result;
  const current = await requestJson(`/api/feedback?requestId=${encodeURIComponent(input.requestId)}`, {}, (value): value is FeedbackRead => {
    if (!isRecord(value) || value.ok !== true || typeof value.owner_id !== "string" || value.request_id !== input.requestId) return false;
    if (value.report === null) return true;
    return isRecord(value.report) && typeof value.report.id === "string" && value.report.id.length > 0
      && value.report.request_id === input.requestId && value.report.message === input.message && value.report.page_url === input.pageUrl;
  }, 5_000);
  if (current.ok && current.data.owner_id !== input.ownerId) return { ok: false as const, kind: "account" as const,
    error: "Tu cuenta cambió. Revisa tu perfil e ingresa con la cuenta original; conservamos tu reporte." };
  if (current.ok && current.data.report) return { ok: true as const, data: { ok: true as const, owner_id: input.ownerId, id: current.data.report.id, request_id: input.requestId } };
  if (!current.ok && current.kind === "auth") return current;
  return { ok: false as const, kind: "uncertain" as const, error: "No pudimos confirmar el envío. Conservamos tu mensaje; puedes reintentar sin duplicarlo." };
}

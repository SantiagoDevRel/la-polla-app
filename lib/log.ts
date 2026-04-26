// lib/log.ts — PII redaction helpers for server-side logs.
//
// We don't ship Sentry/Axiom on the free tier; runtime logs land in Vercel
// where anyone with team access can grep them. To not leak phone numbers,
// user IDs, and message bodies into that surface, every log line touching
// those fields runs through one of the helpers here. Redaction keeps just
// enough of the value (prefix + suffix) to correlate when debugging.
//
// Examples:
//   redactPhone("573117312391") → "57XXXXXXX391"
//   redactId("8c1f2a4e-b6c3-49a1-9e80-12abcd34ef56") → "8c1f2…ef56"
//   redactText("Hola parce, mandame el código de la polla")
//     → "Hola p… (44 chars)"

export function redactPhone(phone: string | null | undefined): string {
  if (!phone) return "(no phone)";
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length <= 5) return "***";
  // Keep country prefix (first 2) and last 3, mask the middle.
  return `${digits.slice(0, 2)}${"X".repeat(Math.max(digits.length - 5, 1))}${digits.slice(-3)}`;
}

export function redactId(id: string | null | undefined): string {
  if (!id) return "(no id)";
  const s = String(id);
  if (s.length <= 8) return "***";
  return `${s.slice(0, 5)}…${s.slice(-4)}`;
}

export function redactText(text: string | null | undefined, keep = 6): string {
  if (text == null) return "(no text)";
  const s = String(text);
  if (s.length <= keep) return `${s} (${s.length} chars)`;
  return `${s.slice(0, keep)}… (${s.length} chars)`;
}

// instrumentation.ts — Runs once per server instance (Node.js and Edge).
// In a Vercel preview, messaging and payment providers become no-ops
// (lib/preview-guard.ts). Elsewhere this does nothing.
export async function register() {
  const { installPreviewFetchGuard } = await import("./lib/preview-guard");
  installPreviewFetchGuard();
}

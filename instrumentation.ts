// instrumentation.ts — Se ejecuta una vez al iniciar el servidor Next.js
export async function register() {
  if (process.env.NODE_ENV === "development") {
    const { ensureDevUser } = await import("@/lib/utils/dev-helpers");
    await ensureDevUser();
  }
}

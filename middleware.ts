// middleware.ts — Middleware principal de Next.js que protege rutas usando Supabase Auth
import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Se aplica a todas las rutas excepto:
     * - _next/static (archivos estáticos)
     * - _next/image (optimización de imágenes)
     * - favicon.ico (favicon)
     * - Archivos públicos (svg, png, jpg, etc.)
     */
    "/((?!_next/static|_next/image|favicon.ico|icons/|manifest.json|reset\\.html|.*\\.(?:svg|png|jpg|jpeg|gif|webp|html)$).*)",
  ],
};

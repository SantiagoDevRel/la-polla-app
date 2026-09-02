// app/api/casa/admin/prize-image/route.ts — la foto de lo que se rifa.
//
// (2026-09-02) Nace con el premio en objeto: cuando la casa rifa una camiseta
// o un telefono, la foto es literalmente el argumento de venta. Un texto que
// diga "iPhone 15" no vende nada.
//
// La foto se sube ANTES de crear la polla: el formulario la manda acá, se
// queda con la ruta que devuelve este endpoint, y esa ruta viaja como
// `prizeImagePath` en el POST de creación. El orden importa — si se subiera
// después, una polla podría publicarse sin la imagen que ya se prometió.
//
// A diferencia de `payment-proofs`, el bucket `prize-images` es PUBLICO: la
// tiene que poder ver cualquiera que abra el link compartido, incluso sin
// sesión. ESCRIBIR sigue siendo solo del admin, y por eso pasa por acá en vez
// de que el browser hable con Storage directo.

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { redactId } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 8 MB, el mismo techo que el comprobante de pago. */
const MAX_BYTES = 8 * 1024 * 1024;
const TIPOS_OK = ["image/jpeg", "image/png", "image/webp"];

export async function POST(req: NextRequest) {
  // Auth ANTES de leer el archivo: no tiene sentido cargar 8 MB en memoria
  // para después descubrir que quien llama no es admin.
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  if (!user.is_admin) {
    return NextResponse.json({ error: "Solo el administrador." }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "No pude leer el formulario." }, { status: 400 });
  }

  const file = form.get("image");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Falta la imagen." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "La imagen supera los 8 MB." },
      { status: 413 },
    );
  }
  if (!TIPOS_OK.includes(file.type)) {
    // Mismo criterio que el comprobante: HEIC merece su propio mensaje porque
    // es lo que manda un iPhone y "formato no soportado" no dice qué hacer.
    const esHeic = /heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name ?? "");
    return NextResponse.json(
      {
        error: esHeic
          ? "Ese formato de iPhone no sirve. Toma un pantallazo de la foto y sube esa imagen."
          : "Solo se aceptan imágenes JPG, PNG o WEBP.",
      },
      { status: 415 },
    );
  }

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  // El nombre lleva un id aleatorio y NO el nombre original del archivo: un
  // nombre subido por el usuario en una ruta pública es superficie que no
  // necesitamos (y el bucket es de lectura abierta).
  const path = `premios/${crypto.randomUUID()}.${ext}`;

  const db = createAdminClient();
  const { error } = await db.storage
    .from("prize-images")
    .upload(path, file, { contentType: file.type, upsert: false });

  if (error) {
    console.error("[casa/prize-image] upload:", error.message);
    return NextResponse.json({ error: "No se pudo subir la imagen." }, { status: 500 });
  }

  const { data: pub } = db.storage.from("prize-images").getPublicUrl(path);

  console.log(`[casa/prize-image] subida por ${redactId(user.id)} -> ${path}`);
  return NextResponse.json({ ok: true, path, url: pub.publicUrl });
}

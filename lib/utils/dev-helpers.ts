// lib/utils/dev-helpers.ts — Utilidades para modo desarrollo
import { createClient } from "@/lib/supabase/server";

const DEV_USER = {
  whatsapp_number: "+573001234567",
  display_name: "Usuario Test",
  email: "test@lapolla.co",
};

/**
 * Inserta el usuario de prueba en Supabase si no existe.
 * Solo se ejecuta cuando NODE_ENV === "development".
 */
export async function ensureDevUser() {
  if (process.env.NODE_ENV !== "development") return;

  const supabase = createClient();

  const { data: existing } = await supabase
    .from("users")
    .select("id")
    .eq("whatsapp_number", DEV_USER.whatsapp_number)
    .single();

  if (existing) return;

  const { error } = await supabase.from("users").insert(DEV_USER);

  if (error) {
    console.error("[DEV] Error insertando usuario de prueba:", error.message);
  } else {
    console.log("[DEV] Usuario de prueba creado");
  }
}

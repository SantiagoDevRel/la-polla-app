// app/api/pollas/route.ts — CRUD de pollas (crear y listar pollas del usuario)
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

const createPollaSchema = z.object({
  name: z.string().min(3, "El nombre debe tener al menos 3 caracteres"),
  description: z.string().optional(),
  leagueId: z.number().positive("Liga inválida"),
  entryFee: z.number().min(0, "El valor de entrada no puede ser negativo"),
  isPrivate: z.boolean().default(false),
});

// GET — Listar pollas del usuario
export async function GET() {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { data: pollas, error } = await supabase
      .from("pollas")
      .select("*")
      .or(`created_by.eq.${user.id},participants.cs.{${user.id}}`)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return NextResponse.json({ pollas });
  } catch (error) {
    console.error("Error listando pollas:", error);
    return NextResponse.json({ error: "Error al listar pollas" }, { status: 500 });
  }
}

// POST — Crear nueva polla
export async function POST(request: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = createPollaSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const slug = parsed.data.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");

    const { data: polla, error } = await supabase
      .from("pollas")
      .insert({
        name: parsed.data.name,
        description: parsed.data.description || "",
        slug,
        league_id: parsed.data.leagueId,
        entry_fee: parsed.data.entryFee,
        is_private: parsed.data.isPrivate,
        created_by: user.id,
        participants: [user.id],
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ polla }, { status: 201 });
  } catch (error) {
    console.error("Error creando polla:", error);
    return NextResponse.json({ error: "Error al crear la polla" }, { status: 500 });
  }
}

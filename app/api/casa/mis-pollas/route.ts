import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listMyPollas } from "@/lib/casa/my-pollas";

export async function GET() {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: "No autorizado" }, { status: 401, headers });
    return NextResponse.json({ pollas: await listMyPollas(user.id) }, { headers });
  } catch {
    return NextResponse.json({ error: "No pudimos cargar tus pollas" }, { status: 500, headers });
  }
}

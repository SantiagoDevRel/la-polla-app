// app/api/ai-image/route.ts — "Crea tu Selfie" (ADMIN-ONLY).
// POST: recibe 1-3 selfies + jugador + face_paint, sube las selfies a Storage privado,
// inserta un job en ai_image_jobs. Un worker en el DGX lo reclama y genera la imagen.
// GET: lista los jobs recientes del usuario (para el historial del sheet).
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCurrentUserAdmin } from "@/lib/auth/admin";

export const dynamic = "force-dynamic";

const BUCKET = "ai-images";
const FACE_PAINT = new Set(["none", "cheek", "full"]);
const MAX_BYTES = 12 * 1024 * 1024;

export async function POST(req: NextRequest) {
  // 1) auth + admin gate
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "Solo admin" }, { status: 403 });
  }

  // 2) parse multipart
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Body inválido (esperado multipart)" }, { status: 400 });
  }

  const facePaint = String(form.get("face_paint") ?? "none");
  if (!FACE_PAINT.has(facePaint)) {
    return NextResponse.json({ error: "face_paint inválido" }, { status: 400 });
  }
  const playerName = form.get("player_name") ? String(form.get("player_name")) : null;
  const playerTeam = form.get("player_team") ? String(form.get("player_team")) : null;

  // selfies: selfie1..selfie3 (al menos 1)
  const selfies: File[] = [];
  for (const key of ["selfie1", "selfie2", "selfie3"]) {
    const f = form.get(key);
    if (f instanceof File && f.size > 0) selfies.push(f);
  }
  if (selfies.length === 0) {
    return NextResponse.json({ error: "Subí al menos una selfie" }, { status: 400 });
  }
  if (selfies.some((f) => f.size > MAX_BYTES)) {
    return NextResponse.json({ error: "Una imagen supera 12MB" }, { status: 400 });
  }
  if (playerName === null && facePaint === "none") {
    return NextResponse.json({ error: "Elegí un jugador o una opción de pintura" }, { status: 400 });
  }

  const admin = createAdminClient();
  const jobId = randomUUID();

  // 3) subir selfies a Storage privado: selfies/{userId}/{jobId}/N.jpg
  const selfiePaths: string[] = [];
  for (let i = 0; i < selfies.length; i++) {
    const buf = Buffer.from(await selfies[i].arrayBuffer());
    const path = `selfies/${user.id}/${jobId}/${i + 1}.jpg`;
    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(path, buf, { contentType: "image/jpeg", upsert: true });
    if (upErr) {
      return NextResponse.json({ error: "Falló la subida de la selfie" }, { status: 500 });
    }
    selfiePaths.push(path);
  }

  // 4) insertar job
  const { data: job, error: insErr } = await admin
    .from("ai_image_jobs")
    .insert({
      id: jobId,
      user_id: user.id,
      status: "pending",
      player_name: playerName,
      player_team: playerTeam,
      face_paint: facePaint,
      selfie_paths: selfiePaths,
    })
    .select("id, status, created_at")
    .single();

  if (insErr || !job) {
    return NextResponse.json({ error: "No se pudo crear el job" }, { status: 500 });
  }

  return NextResponse.json({ job_id: job.id, status: job.status });
}

// GET: últimos jobs del usuario (para mostrar el historial / estado).
export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "Solo admin" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("ai_image_jobs")
    .select("id, status, player_name, face_paint, result_path, error, created_at, done_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(12);

  // adornar con signed URL del resultado (1h)
  const jobs = await Promise.all(
    (rows ?? []).map(async (r) => {
      let resultUrl: string | null = null;
      if (r.result_path) {
        const { data: signed } = await admin.storage
          .from(BUCKET)
          .createSignedUrl(r.result_path, 3600);
        resultUrl = signed?.signedUrl ?? null;
      }
      return {
        id: r.id,
        status: r.status,
        player_name: r.player_name,
        face_paint: r.face_paint,
        error: r.error,
        created_at: r.created_at,
        result_url: resultUrl,
      };
    }),
  );

  return NextResponse.json({ jobs });
}

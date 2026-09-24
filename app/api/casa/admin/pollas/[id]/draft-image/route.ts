import { getAuthenticatedUser } from "@/lib/auth/admin";
import { getPrivateCampaign } from "@/lib/casa/private-draft-query";
import { createAdminClient } from "@/lib/supabase/admin";
import { casaJson } from "@/lib/casa/operations";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getAuthenticatedUser();
  if (!actor?.is_admin) return casaJson({ error: "No disponible." }, 404);
  const { id } = await params;
  const result = await getPrivateCampaign(id, actor);
  const asset = new URL(request.url).searchParams.get("asset") ?? "poster";
  if (!["poster", "video", "animation"].includes(asset)) return casaJson({ error: "No disponible." }, 404);
  const path = asset === "video" ? result?.draft.motion?.video_path
    : asset === "animation" ? result?.draft.motion?.animation_path : result?.draft.image_path;
  const extension = asset === "video" ? /\.webm$/i : asset === "animation" ? /\.webp$/i : /\.(?:jpg|jpeg|png|webp)$/i;
  if (!path || !result || !path.startsWith(`${result.polla.id}/`) || !/^[a-z0-9][a-z0-9._-]*$/i.test(path.slice(result.polla.id.length + 1)) || !extension.test(path)) return casaJson({ error: "No disponible." }, 404);
  const { data, error } = await createAdminClient().storage.from("casa-private-drafts").download(path);
  if (error || !data) return casaJson({ error: "No disponible." }, 404);
  return new Response(data, { headers: {
    "Content-Type": asset === "video" ? "video/webm" : asset === "animation" ? "image/webp" : data.type || "image/png",
    "Content-Length": String(data.size),
    "Cache-Control": "private, no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "Vary": "Cookie",
  } });
}

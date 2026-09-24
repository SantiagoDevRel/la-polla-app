import { getAuthenticatedUser } from "@/lib/auth/admin";
import { getPrivateCampaign } from "@/lib/casa/private-draft-query";
import { createAdminClient } from "@/lib/supabase/admin";
import { casaJson } from "@/lib/casa/operations";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getAuthenticatedUser();
  if (!actor?.is_admin) return casaJson({ error: "No disponible." }, 404);
  const { id } = await params;
  const result = await getPrivateCampaign(id, actor);
  const path = result?.draft.image_path;
  if (!path || !path.startsWith(`${result.polla.id}/`) || !/^[a-zA-Z0-9/_-]+\.(?:jpg|jpeg|png|webp)$/.test(path)) return casaJson({ error: "No disponible." }, 404);
  const { data, error } = await createAdminClient().storage.from("casa-private-drafts").download(path);
  if (error || !data) return casaJson({ error: "No disponible." }, 404);
  return new Response(data, { headers: {
    "Content-Type": data.type || "image/jpeg",
    "Cache-Control": "private, no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "Vary": "Cookie",
  } });
}

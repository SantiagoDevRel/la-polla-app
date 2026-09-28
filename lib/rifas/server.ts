// lib/rifas/server.ts — acceso del servidor a las rifas de creadores (migración 157).
//
// Todo pasa por las RPC SECURITY DEFINER de la 157 con el cliente de servicio,
// DESPUÉS de validar la sesión: el actor que recibe SQL es siempre el uuid de
// la sesión, nunca un dato del cliente. La autorización (creador, admin,
// Privada, oculta) la decide SQL. Esto solo arma llamadas.
import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyRifaByTelegram } from "@/lib/telegram-player/notify";
import { redactId } from "@/lib/log";
import { rifaNumber, RIFA_SLUG_RE, type RifaCreatorView, type RifaMyList, type RifaPublicView, type RifaTeam } from "./shared";
import type { RpcError } from "./errors";

export const RIFA_PROOF_BUCKET = "rifa-proofs";
export const RIFA_MEDIA_BUCKET = "rifa-media";
/** lp_rifa: rifa abierta sin sesión (slug.timestamp). Base del embudo rifa → cuenta. */
export const RIFA_LINK_COOKIE = "lp_rifa";

/** Apagado por defecto. Sin RIFAS_ENABLED=true no existe ninguna pantalla ni ruta de rifas. */
export function rifasEnabled(): boolean {
  return process.env.RIFAS_ENABLED === "true";
}

export interface RifaViewer { id: string; is_admin: boolean; display_name: string | null }

/** Sesión validada con Supabase Auth; null sin sesión. */
export async function getRifaViewer(): Promise<RifaViewer | null> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  const { data } = await createAdminClient().from("users").select("id, is_admin, display_name").eq("id", user.id).maybeSingle();
  return data ? { id: data.id, is_admin: data.is_admin === true, display_name: data.display_name } : null;
}

export async function rifaRpc<T>(fn: string, args: Record<string, unknown>): Promise<{ data: T | null; error: RpcError | null }> {
  const { data, error } = await createAdminClient().rpc(fn, args);
  return { data: (data as T) ?? null, error: error ? { message: error.message, code: error.code, details: error.details } : null };
}

export function validSlug(slug: string): boolean {
  return RIFA_SLUG_RE.test(slug);
}

export function getPublicView(slug: string, viewerId: string | null) {
  return rifaRpc<RifaPublicView>("rifa_public_view_v1", { p_slug: slug, p_viewer: viewerId });
}

/** Panel de la rifa + su equipo (creador y coadministradores, migración 158). */
export async function getCreatorView(slug: string, actorId: string) {
  const [view, team] = await Promise.all([
    rifaRpc<RifaCreatorView>("rifa_creator_view_v1", { p_actor: actorId, p_slug: slug }),
    rifaRpc<RifaTeam>("rifa_team_v1", { p_actor: actorId, p_slug: slug }),
  ]);
  if (view.error || !view.data) return view;
  return { data: { ...view.data, team: team.data ?? { is_owner: false, owner_name: null, managers: [] } }, error: null };
}

/** ¿Opera la rifa? El creador o un coadministrador (SQL: rifa_is_manager). */
export async function isRifaManager(rifaId: string, userId: string): Promise<boolean> {
  const { data } = await rifaRpc<boolean>("rifa_is_manager", { p_rifa: rifaId, p_user: userId });
  return data === true;
}

export function getMyRifas(userId: string) {
  return rifaRpc<RifaMyList>("rifa_my_list_v1", { p_user: userId });
}

export async function rifaIdBySlug(slug: string): Promise<string | null> {
  if (!validSlug(slug)) return null;
  const { data } = await createAdminClient().from("rifas").select("id").eq("slug", slug).maybeSingle();
  return data?.id ?? null;
}

/** «Prellenado con lo último que usó»: la cuenta de la rifa más reciente del creador. */
export async function lastPaymentAccount(creatorId: string) {
  const { data } = await createAdminClient().from("rifas")
    .select("payment_method, payment_account, payment_holder")
    .eq("creator_id", creatorId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data ?? null;
}

/** Imagen de un bucket privado de rifas por 5 minutos. Quién puede pedirla lo decide la ruta con SQL. */
export async function signedRifaFile(bucket: string, path: string, seconds = 300): Promise<string | null> {
  const { data, error } = await createAdminClient().storage.from(bucket).createSignedUrl(path, seconds);
  return error || !data ? null : data.signedUrl;
}

function appUrl(path: string): string {
  return `${process.env.NEXT_PUBLIC_APP_URL ?? "https://lapollacolombiana.com"}${path}`;
}

/** Aviso al comprador. Mejor esfuerzo: sin Telegram vinculado, lo ve al abrir la rifa. WhatsApp sigue apagado. */
export async function notifyBuyerReview(n: { buyerId: string; rifaName: string; slug: string; numbers: number[]; approved: boolean; reason?: string | null }) {
  const numeros = n.numbers.map(rifaNumber).join(", ");
  const text = n.approved
    ? `Tu pago en la rifa «${n.rifaName}» quedó confirmado. Tus números: ${numeros}.`
    : `El creador de la rifa «${n.rifaName}» rechazó tu comprobante${n.reason ? `: ${n.reason}` : "."} Los números ${numeros} quedaron libres.`;
  await notifyRifaByTelegram(createAdminClient(), n.buyerId, text, { text: "Ver la rifa", url: appUrl(`/rifa/${n.slug}`) })
    .catch(() => console.warn("[rifas] aviso al comprador no enviado:", redactId(n.buyerId)));
}

/** Aviso al creador de que tiene un comprobante por revisar. */
export async function notifyCreatorNewProof(n: { creatorId: string; rifaName: string; slug: string; numbers: number[] }) {
  const text = `Tienes un comprobante por revisar en la rifa «${n.rifaName}»: números ${n.numbers.map(rifaNumber).join(", ")}.`;
  await notifyRifaByTelegram(createAdminClient(), n.creatorId, text, { text: "Revisar", url: appUrl(`/rifa/${n.slug}/gestionar`) })
    .catch(() => console.warn("[rifas] aviso al creador no enviado:", redactId(n.creatorId)));
}

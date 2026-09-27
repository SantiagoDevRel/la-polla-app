import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPollaById, getPots, listPublicPollas } from "@/lib/casa/queries";
import { colombiaDateKey, colombiaDateTimeToIso } from "@/lib/time/colombia";
import { PAISES_SMS } from "../paises";
import { audienceUser, selectAudience, smsSize, type AudienceUser, type CampaignInput, type CampaignPolla } from "./shared";
import { assertCampaignTime, nextCampaignTime } from "./schedule";
import { dispatchCampaign, quoteCampaign } from "./provider";

const ids = z.array(z.uuid()).max(10000);
export const campaignSchema = z.object({
  pollaId: z.uuid(), template: z.enum(["opening", "closing"]), days: z.number().int().min(0).max(60),
  message: z.string().trim().min(1).max(1500), scheduledAt: z.string().max(30).nullable(),
  audience: z.object({ countries: z.array(z.enum(PAISES_SMS)).min(1).max(PAISES_SMS.length), selectedIds: ids.nullable(), excludedPollaIds: z.array(z.uuid()).max(100), exceptionIds: ids }),
});

/** Every paginated data source is ordered; never silently cap the audience at 1000. */
export async function campaignUsers() {
  const users: AudienceUser[] = []; let invalid = 0;
  for (let start = 0; ; start += 1000) {
    const { data, error } = await createAdminClient().from("users").select("id,display_name,whatsapp_number").order("id").range(start, start + 999);
    if (error) throw new Error("No se pudo leer el directorio.");
    for (const row of data ?? []) { const user = audienceUser(row); if (user) users.push(user); else invalid++; }
    if ((data?.length ?? 0) < 1000) break;
  }
  return { users, invalid };
}

async function suppressedPhones() {
  const phones = new Set<string>();
  for (let start = 0; ; start += 1000) {
    const { data, error } = await createAdminClient().from("sms_marketing_suppressions").select("phone").order("phone").range(start, start + 999);
    if (error) throw new Error("No se pudo comprobar la lista de bajas.");
    for (const row of data ?? []) phones.add(row.phone);
    if ((data?.length ?? 0) < 1000) break;
  }
  return phones;
}

async function membershipUsers(pollaIds: string[]) {
  const members = new Set<string>();
  if (!pollaIds.length) return members;
  for (const table of ["polla_participants", "casa_entries"] as const) {
    for (let start = 0; ; start += 1000) {
      let query = createAdminClient().from(table).select("id,user_id").in("polla_id", pollaIds).order("id").range(start, start + 999);
      query = table === "polla_participants" ? query.eq("status", "approved") : query.in("status", ["pagada", "pendiente"]);
      const { data, error } = await query;
      if (error) throw new Error("No se pudieron comprobar las exclusiones.");
      for (const row of data ?? []) members.add(row.user_id);
      if ((data?.length ?? 0) < 1000) break;
    }
  }
  return members;
}

export async function resolveAudience(filter: CampaignInput["audience"]) {
  const [{ users, invalid }, members, suppressed] = await Promise.all([campaignUsers(), membershipUsers(filter.excludedPollaIds), suppressedPhones()]);
  const recipients = selectAudience(users, filter, members, suppressed);
  if (!recipients.length) throw new Error("Selecciona al menos un destinatario válido.");
  if (recipients.length > 10000) throw new Error("El máximo por campaña es 10.000 números.");
  return { recipients, invalid, excluded: users.length - recipients.length };
}

export async function campaignCatalog(ownerId: string) {
  const [allPollas, directory, suppressions] = await Promise.all([listPublicPollas(), campaignUsers(), suppressedPhones()]);
  const open = allPollas.filter(p => p.status === "abierta" && new Date(p.closes_at) > new Date());
  const pots = await getPots(open.filter(p => p.prize_kind === "pozo").map(p => p.id));
  const pollas: CampaignPolla[] = open.map(p => ({
    id: p.id, slug: p.slug, name: p.name, entry: p.entry_price_cop, closesAt: p.closes_at,
    prize: p.prize_kind === "objeto" ? (p.prize_object || "el premio publicado") : `${p.pot_mode === "fijo" ? "un premio mínimo garantizado" : "un pozo actual"} de $${Number(p.pot_mode === "fijo" ? p.fixed_prize_cop : pots[p.id].prize_cop).toLocaleString("es-CO")} COP`,
    game: p.kind === "rifa" ? "Elige tu boleta" : p.kind === "manual" ? "Responde las preguntas" : p.scoring_mode === "1x2" ? "Acierta los resultados (1X2)" : "Acierta los marcadores",
  }));
  const exclusions: { id: string; name: string }[] = allPollas.map(p => ({ id: p.id, name: p.name }));
  for (let start = 0; ; start += 1000) {
    const { data, error } = await createAdminClient().from("pollas").select("id,name").order("id").range(start, start + 999);
    if (error) throw new Error("No se pudo cargar la lista de pollas.");
    exclusions.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) break;
  }
  return { pollas, users: directory.users.map(u => ({ ...u, suppressed: suppressions.has(u.phone) })), invalid: directory.invalid, exclusions, ownerId, nextTime: nextCampaignTime() };
}

export async function campaignHistory(ownerId: string) {
  const { data, error } = await createAdminClient().rpc("sms_campaign_history", { p_owner: ownerId });
  if (error) throw new Error("No se pudo leer el historial.");
  return data ?? [];
}

function fingerprint(message: string, scheduledAt: string | null, phones: string[]) {
  // Immediate sends are deduplicated per Colombia day, even with a new preview ID.
  return createHash("sha256").update(JSON.stringify([message, scheduledAt ?? colombiaDateKey(new Date()), [...phones].sort()])).digest("hex");
}

async function validatePolla(input: CampaignInput, scheduledAt: string | null) {
  const polla = await getPollaById(input.pollaId);
  if (!polla || polla.status !== "abierta") throw new Error("La polla no está abierta y publicada.");
  const sendAt = scheduledAt ?? new Date().toISOString();
  assertCampaignTime(sendAt, polla.closes_at);
  if (!input.message.includes(`https://lapollacolombiana.com/polla/${polla.slug}`)) throw new Error("El mensaje debe incluir el enlace de la polla elegida.");
  if (input.template === "closing") {
    const days = Math.round((Date.parse(`${colombiaDateKey(polla.closes_at)}T00:00Z`) - Date.parse(`${colombiaDateKey(sendAt)}T00:00Z`)) / 86400000);
    if (days !== input.days) throw new Error(`En la fecha del envío, esta polla se cierra ${days === 0 ? "hoy" : days === 1 ? "mañana" : `en ${days} días`}. Ajusta el plazo de la plantilla.`);
  }
}

export async function previewCampaign(ownerId: string, input: CampaignInput) {
  const scheduledAt = input.scheduledAt ? colombiaDateTimeToIso(input.scheduledAt) : null;
  if (scheduledAt && Date.parse(scheduledAt) < Date.now() + 5 * 60000) throw new Error("Programa con al menos 5 minutos de anticipación.");
  await validatePolla(input, scheduledAt);
  const { recipients, invalid, excluded } = await resolveAudience(input.audience);
  const size = smsSize(input.message);
  if (size.segments > 10) throw new Error("El mensaje supera 10 segmentos por persona.");
  const quote = await quoteCampaign([...new Set(recipients.map(u => u.country))]);
  const credits = Math.ceil(recipients.reduce((sum, u) => sum + quote.rates[u.country] * size.segments, 0) * 1e6) / 1e6;
  const db = createAdminClient();
  const { data: pending, error: pendingError } = await db.from("sms_campaigns").select("credits").eq("state", "scheduled").gt("scheduled_at", new Date().toISOString());
  if (pendingError) throw new Error("No se pudieron consultar los créditos reservados.");
  const reserved = (pending ?? []).reduce((sum, c) => sum + Number(c.credits), 0);
  if (quote.balance < credits + reserved + 10) throw new Error("Saldo insuficiente: conservamos créditos para programados y códigos de acceso.");
  const id = randomUUID();
  const { error } = await db.from("sms_campaigns").insert({
    id, created_by: ownerId, polla_id: input.pollaId, template: input.template, message: input.message, scheduled_at: scheduledAt,
    subid: `sc${id.replace(/-/g, "").slice(0, 18)}`, fingerprint: fingerprint(input.message, scheduledAt, recipients.map(u => u.phone)),
    audience: input, recipient_count: recipients.length, segments: size.segments, credits,
  });
  if (error) throw new Error("No se pudo guardar la revisión.");
  for (let start = 0; start < recipients.length; start += 500) {
    const { error: insertError } = await db.from("sms_campaign_recipients").insert(recipients.slice(start, start + 500).map(u => ({ campaign_id: id, user_id: u.id, phone: u.phone, country: u.country })));
    if (insertError) throw new Error("No se pudo guardar la lista completa. No se envió ningún SMS.");
  }
  return { id, message: input.message, scheduledAt, count: recipients.length, segments: size.segments, unicode: size.unicode, credits, balance: quote.balance, reserved, invalid, excluded, recipients: recipients.map(u => ({ id: u.id, name: u.name, tail: u.phone.slice(-4) })) };
}

export async function sendCampaign(ownerId: string, id: string) {
  const db = createAdminClient();
  const { data: campaign, error } = await db.from("sms_campaigns").select("id,message,scheduled_at,subid,state,audience,credits,expires_at,recipient_count").eq("id", id).eq("created_by", ownerId).maybeSingle();
  if (error || !campaign) throw new Error("No se encontró la campaña.");
  if (campaign.state !== "ready") throw new Error("La campaña ya se procesó. Consulta su estado en el historial; no la repitas.");
  if (new Date(campaign.expires_at) <= new Date()) throw new Error("La revisión venció. Revisa la campaña nuevamente.");
  if (!process.env.SMS_ACK_SECRET || process.env.LABSMOBILE_DRY_RUN === "1") throw new Error("Envío real no habilitado.");
  const input = campaignSchema.parse(campaign.audience);
  await validatePolla(input, campaign.scheduled_at);
  if (campaign.scheduled_at && Date.parse(campaign.scheduled_at) < Date.now() + 60_000) throw new Error("El horario está demasiado cerca. Revisa la programación.");
  const { recipients } = await resolveAudience(input.audience);
  const saved: { phone: string }[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error: readError } = await db.from("sms_campaign_recipients").select("phone").eq("campaign_id", id).order("phone").range(start, start + 999);
    if (readError) throw new Error("No se pudo verificar la lista aprobada.");
    saved.push(...(data ?? [])); if ((data?.length ?? 0) < 1000) break;
  }
  if (JSON.stringify(saved.map(u => u.phone).sort()) !== JSON.stringify(recipients.map(u => u.phone).sort())) throw new Error("Los destinatarios cambiaron. Revisa la campaña nuevamente.");
  const quote = await quoteCampaign([...new Set(recipients.map(u => u.country))]);
  const cost = recipients.reduce((sum, u) => sum + quote.rates[u.country] * smsSize(campaign.message).segments, 0);
  if (cost > Number(campaign.credits) + 0.000001) throw new Error("La tarifa cambió. Revisa el costo nuevamente.");
  const { data: claimed, error: claimError } = await db.rpc("claim_sms_campaign", { p_id: id, p_owner: ownerId, p_balance: quote.balance });
  if (claimError || !claimed) throw new Error("No se reservó el envío: ya se procesó, hay otro pendiente o falta saldo. Consulta el historial.");
  let result: { state: string; code: string };
  try { result = await dispatchCampaign({ message: campaign.message, phones: saved.map(u => u.phone), subid: campaign.subid, scheduledAt: campaign.scheduled_at }); }
  catch { result = { state: "unknown", code: "dispatch_configuration" }; }
  const { error: saveError } = await db.from("sms_campaigns").update({ state: result.state, provider_code: result.code, acknowledged_at: new Date().toISOString() }).eq("id", id).eq("created_by", ownerId).eq("state", "dispatching");
  if (saveError) throw new Error("El proveedor pudo recibir el envío. No lo repitas: quedó pendiente de conciliación.");
  return result;
}

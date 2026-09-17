import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { acceptsCasaMatchPicks, canEditCasaMatch } from "./match-rules";
import { getPollaTournamentSlugs } from "./tournaments";
import type { CasaPollaStatus, MyCasaPolla } from "./types";

type PollaSummary = Omit<MyCasaPolla, "entry_status" | "tournaments" | "entries">;
type Membership = {
  id: string;
  status: "pendiente" | "pagada";
  entry_number: number | null;
  origin: "compra" | "invitacion" | null;
  polla: PollaSummary | PollaSummary[] | null;
};

/** Caller must validate the session; every page is explicitly scoped to that user. */
export async function listMyPollas(userId: string): Promise<MyCasaPolla[]> {
  if (!userId) throw new Error("Authenticated user required");
  const db = createAdminClient();
  const byId = new Map<string, MyCasaPolla>();
  const entryIds = new Map<string, { pollaId: string; number: number }>();
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.from("casa_entries")
      .select("id, status, entry_number, origin, polla:casa_pollas!inner(id, slug, name, kind, tournament, status, closes_at)")
      .eq("user_id", userId)
      .in("status", ["pagada", "pendiente"])
      .in("polla.status", ["abierta", "cerrada", "resuelta"])
      .is("polla.archived_at", null)
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as Membership[];
    for (const row of rows) {
      const polla = Array.isArray(row.polla) ? row.polla[0] : row.polla;
      if (!polla || polla.status === "borrador" || polla.status === "anulada") continue;
      // One polla, several entries: raffle tickets or numbered cupos (migration
      // 131). A paid entry gives the polla its headline status.
      const existing = byId.get(polla.id);
      const item = existing ?? { ...polla, entry_status: row.status, tournaments: [], entries: [] };
      if (existing && row.status === "pagada") item.entry_status = "pagada";
      if (row.entry_number != null) {
        // Un regalo en pausa es `anulada` y ya quedó fuera del filtro de estado.
        item.entries.push({ number: row.entry_number, status: row.status, ...(row.origin === "invitacion" ? { gift: true } : {}) });
        if (row.id) entryIds.set(row.id, { pollaId: polla.id, number: row.entry_number });
      }
      byId.set(polla.id, item);
    }
    if (rows.length < pageSize) break;
  }
  const pollas = [...byId.values()];
  for (const polla of pollas) polla.entries.sort((a, b) => a.number - b.number);
  await addPendingPicks(pollas, entryIds);
  const tournaments = await getPollaTournamentSlugs(pollas);
  const priority = (p: MyCasaPolla) => p.status === "resuelta" || p.status === "anulada" ? 2 : p.entry_status === "pagada" ? 0 : 1;
  return pollas.map(p => ({ ...p, tournaments: tournaments[p.id] ?? [] }))
    .sort((a, b) => priority(a) - priority(b) || b.closes_at.localeCompare(a.closes_at) || a.id.localeCompare(b.id));
}

/**
 * Cuántos partidos todavía pronosticables le faltan a cada cupo, para marcar en
 * rojo el cupo olvidado. Mismo criterio que la pantalla (canEditCasaMatch). Si
 * falla, la lista sale sin ese aviso en vez de caerse.
 */
async function addPendingPicks(pollas: MyCasaPolla[], entryIds: Map<string, { pollaId: string; number: number }>) {
  const open = pollas.filter((p) => p.kind === "partidos" && acceptsCasaMatchPicks(p.status as CasaPollaStatus) && p.entries.length > 0);
  if (open.length === 0) return;
  try {
    const db = createAdminClient();
    const ids = open.map((p) => p.id);
    const entries = [...entryIds.entries()].filter(([, e]) => ids.includes(e.pollaId)).map(([id]) => id);
    const [{ data: links, error: linksError }, { data: picks, error: picksError }] = await Promise.all([
      db.from("casa_polla_matches").select("polla_id, match_id, voided_at").in("polla_id", ids),
      entries.length ? db.from("casa_picks").select("entry_id, match_id").in("entry_id", entries).not("match_id", "is", null) : Promise.resolve({ data: [], error: null }),
    ]);
    if (linksError || picksError) return;
    const matchIds = [...new Set((links ?? []).map((l) => l.match_id))];
    if (matchIds.length === 0) return;
    const { data: matches, error } = await db.from("matches").select("id, status, elapsed, scheduled_at, final_verified_at").in("id", matchIds);
    if (error) return;
    const byMatch = new Map((matches ?? []).map((m) => [m.id, m]));
    const done = new Set((picks ?? []).map((p) => `${p.entry_id}:${p.match_id}`));
    const now = Date.now();
    for (const [entryId, { pollaId, number }] of entryIds) {
      const polla = open.find((p) => p.id === pollaId);
      const target = polla?.entries.find((e) => e.number === number);
      if (!polla || !target) continue;
      target.pending = (links ?? []).filter((l) => {
        const match = byMatch.get(l.match_id);
        return l.polla_id === pollaId && match && canEditCasaMatch({ ...match, voided_at: l.voided_at }, now) && !done.has(`${entryId}:${l.match_id}`);
      }).length;
    }
  } catch {
    // Sin el aviso de pendientes; la lista de pollas sigue.
  }
}

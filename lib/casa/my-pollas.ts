import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPollaTournamentSlugs } from "./tournaments";
import type { MyCasaPolla } from "./types";

type PollaSummary = Omit<MyCasaPolla, "entry_status" | "tournaments" | "entries">;
type Membership = {
  status: "pendiente" | "pagada";
  entry_number: number | null;
  polla: PollaSummary | PollaSummary[] | null;
};

/** Caller must validate the session; every page is explicitly scoped to that user. */
export async function listMyPollas(userId: string): Promise<MyCasaPolla[]> {
  if (!userId) throw new Error("Authenticated user required");
  const db = createAdminClient();
  const byId = new Map<string, MyCasaPolla>();
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.from("casa_entries")
      .select("status, entry_number, polla:casa_pollas!inner(id, slug, name, kind, tournament, status, closes_at)")
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
      // One polla, several entries: raffle tickets or numbered participations
      // (migration 131). A paid entry gives the polla its headline status.
      const existing = byId.get(polla.id);
      const item = existing ?? { ...polla, entry_status: row.status, tournaments: [], entries: [] };
      if (existing && row.status === "pagada") item.entry_status = "pagada";
      if (row.entry_number != null) item.entries.push({ number: row.entry_number, status: row.status });
      byId.set(polla.id, item);
    }
    if (rows.length < pageSize) break;
  }
  const pollas = [...byId.values()];
  for (const polla of pollas) polla.entries.sort((a, b) => a.number - b.number);
  const tournaments = await getPollaTournamentSlugs(pollas);
  const priority = (p: MyCasaPolla) => p.status === "resuelta" || p.status === "anulada" ? 2 : p.entry_status === "pagada" ? 0 : 1;
  return pollas.map(p => ({ ...p, tournaments: tournaments[p.id] ?? [] }))
    .sort((a, b) => priority(a) - priority(b) || b.closes_at.localeCompare(a.closes_at) || a.id.localeCompare(b.id));
}

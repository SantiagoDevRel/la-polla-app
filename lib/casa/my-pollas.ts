import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPollaTournamentSlugs } from "./tournaments";
import type { MyCasaPolla } from "./types";

type PollaSummary = Omit<MyCasaPolla, "entry_status" | "tournaments">;
type Membership = { status: "pendiente" | "pagada"; polla: PollaSummary | PollaSummary[] | null };

/** Caller must validate the session; every page is explicitly scoped to that user. */
export async function listMyPollas(userId: string): Promise<MyCasaPolla[]> {
  if (!userId) throw new Error("Authenticated user required");
  const db = createAdminClient();
  const byId = new Map<string, MyCasaPolla>();
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.from("casa_entries")
      .select("status, polla:casa_pollas!inner(id, slug, name, kind, tournament, status, closes_at)")
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
      // Raffles allow multiple entries. Show one card; a paid ticket takes priority.
      const existing = byId.get(polla.id);
      if (!existing || row.status === "pagada") {
        byId.set(polla.id, { ...polla, entry_status: row.status, tournaments: [] });
      }
    }
    if (rows.length < pageSize) break;
  }
  const pollas = [...byId.values()];
  const tournaments = await getPollaTournamentSlugs(pollas);
  const priority = (p: MyCasaPolla) => p.status === "resuelta" || p.status === "anulada" ? 2 : p.entry_status === "pagada" ? 0 : 1;
  return pollas.map(p => ({ ...p, tournaments: tournaments[p.id] ?? [] }))
    .sort((a, b) => priority(a) - priority(b) || b.closes_at.localeCompare(a.closes_at) || a.id.localeCompare(b.id));
}

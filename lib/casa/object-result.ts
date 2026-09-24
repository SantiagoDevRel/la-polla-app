/** Read-only result calculated by SQL; ready does not mean the prize was awarded. */
export type CasaObjectResult =
  | { state: "waiting" | "no_winner" | "settled" }
  | { state: "ready"; tied: boolean; winner: {
    user_id: string; entry_id: string; display_name: string | null; avatar_url: string | null;
    points: number; registered_at: string;
  } };

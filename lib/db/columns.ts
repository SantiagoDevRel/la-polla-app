// lib/db/columns.ts — Explicit column lists for the most-queried tables.
//
// We avoid `select("*")` so that adding a new sensitive column later
// (think `users.email_internal` or `pollas.admin_secret_key`) does not
// auto-leak into client responses. Every API route that hands its
// payload to the browser should pick from these baselines.
//
// String-literal `as const` is required so @supabase/postgrest-js can
// parse the column list at the type level and infer the row shape.
// A runtime-built string (array.join, template with vars) would degrade
// to GenericStringError.

export const POLLA_COLUMNS =
  "id, slug, name, description, created_by, type, status, tournament, scope, match_ids, buy_in_amount, currency, platform_fee_pct, prize_pool, points_exact, points_winner, points_one_team, points_goal_diff, points_correct_result, payment_mode, admin_payment_instructions, invite_token, join_code, prize_distribution, created_at, starts_at, ends_at" as const;

// Subset for /inicio enriched-polla aggregation: the page only needs
// progress + ranking inputs, no pricing/payment fields. Trimming the row
// keeps the SSR payload small.
export const POLLA_COLUMNS_LITE =
  "id, slug, name, tournament, status, type, match_ids, buy_in_amount, created_at" as const;

export const POLLA_PARTICIPANT_COLUMNS =
  "id, polla_id, user_id, role, status, paid, paid_at, paid_amount, payment_note, payment_proof_url, payment_mode_note, payment_status, total_points, rank, joined_at" as const;

export const MATCH_COLUMNS =
  "id, external_id, tournament, match_day, phase, home_team, away_team, home_team_flag, away_team_flag, scheduled_at, venue, home_score, away_score, status, elapsed, notified_closing, created_at" as const;

export const PREDICTION_COLUMNS =
  "id, polla_id, user_id, match_id, predicted_home, predicted_away, submitted_at, locked, visible, points_earned" as const;

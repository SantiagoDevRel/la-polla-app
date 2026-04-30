// lib/vision/log-usage.ts
// Wrapper para insertar una row en claude_api_usage. Se llama después
// de cada invocación al Anthropic API. Best-effort — si falla, log
// console pero no rompe el flujo del request principal.

import { createAdminClient } from "@/lib/supabase/admin";

export interface UsageLog {
  userId: string | null;
  pollaId?: string | null;
  endpoint: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  imageBytes?: number | null;
  costUSD: number;
  success: boolean;
  errorMessage?: string | null;
}

export async function logClaudeUsage(args: UsageLog): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("claude_api_usage").insert({
      user_id: args.userId,
      polla_id: args.pollaId ?? null,
      endpoint: args.endpoint,
      model: args.model,
      tokens_in: args.tokensIn,
      tokens_out: args.tokensOut,
      image_bytes: args.imageBytes ?? null,
      cost_usd: args.costUSD,
      success: args.success,
      error_message: args.errorMessage ?? null,
    });
    if (error) {
      console.error("[claude-usage-log] insert failed:", error.message);
    }
  } catch (err) {
    console.error("[claude-usage-log] unexpected:", err);
  }
}

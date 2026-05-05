// app/api/admin/twilio-usage/route.ts — Pulls Twilio Verify usage + cost
// for the admin dashboard. Hits the Twilio Usage API directly with the
// account credentials we configured for OTP. Falls back to a graceful
// "not configured" payload when the env vars are absent (dev / preview).
//
// Twilio Usage API: https://www.twilio.com/docs/usage/api/usage-record
import { NextResponse } from "next/server";
import { isCurrentUserAdmin } from "@/lib/auth/admin";

export const runtime = "nodejs";

interface TwilioUsageRecord {
  category: string;
  description: string;
  count: string;
  count_unit: string;
  usage: string;
  usage_unit: string;
  price: string;
  price_unit: string;
  start_date: string;
  end_date: string;
}

interface TwilioUsageResponse {
  usage_records: TwilioUsageRecord[];
}

export async function GET() {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    return NextResponse.json({
      configured: false,
      message:
        "Configurá TWILIO_ACCOUNT_SID y TWILIO_AUTH_TOKEN en Vercel para ver el uso real.",
    });
  }

  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const headers = { Authorization: `Basic ${auth}` };

  const today = new Date();
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
  const endOfMonth = today.toISOString().slice(0, 10);

  const url = (path: string, qs: Record<string, string>) => {
    const params = new URLSearchParams(qs);
    return `https://api.twilio.com/2010-04-01/Accounts/${sid}/${path}?${params.toString()}`;
  };

  try {
    // Pull SMS y totalprice. NOT pulling Category="verify" — Twilio Usage
    // API no acepta "verify" como categoría (los OTP via Verify se
    // dividen en sub-products: verify-sms, verify-totp, verify-push, etc.,
    // y para nuestro caso de SMS OTP los costos ya quedan capturados en
    // `sms` + `totalprice`). totalprice es el budget number más confiable.
    const [
      smsMonthRes,
      smsAllRes,
      totalMonthRes,
    ] = await Promise.all([
      fetch(url("Usage/Records.json", { Category: "sms", StartDate: startOfMonth, EndDate: endOfMonth }), { headers, cache: "no-store" }),
      fetch(url("Usage/Records/AllTime.json", { Category: "sms" }), { headers, cache: "no-store" }),
      fetch(url("Usage/Records.json", { Category: "totalprice", StartDate: startOfMonth, EndDate: endOfMonth }), { headers, cache: "no-store" }),
    ]);

    const ok = [smsMonthRes, smsAllRes, totalMonthRes].every(r => r.ok);
    if (!ok) {
      const failed = [smsMonthRes, smsAllRes, totalMonthRes].find(r => !r.ok);
      // Leemos el body del error de Twilio para que el admin vea el motivo
      // exacto (ej. "Authentication Error: invalid credentials").
      let body = "";
      try {
        body = (await failed?.text()) ?? "";
      } catch {
        // ignore body read failure
      }
      const detail = body.slice(0, 240).replace(/\s+/g, " ");
      console.error("[twilio-usage] Twilio API error:", failed?.status, detail);
      return NextResponse.json(
        {
          configured: true,
          error: `Twilio API ${failed?.status} ${failed?.statusText}${detail ? ` — ${detail}` : ""}`,
        },
        { status: 502 },
      );
    }

    const [smsMonth, smsAll, totalMonth] = await Promise.all(
      [smsMonthRes, smsAllRes, totalMonthRes].map(r => r.json() as Promise<TwilioUsageResponse>)
    );

    const sumPrice = (d: TwilioUsageResponse) =>
      d.usage_records.reduce((s, r) => s + (parseFloat(r.price) || 0), 0);
    const sumCount = (d: TwilioUsageResponse) =>
      d.usage_records.reduce((s, r) => s + (parseInt(r.count, 10) || 0), 0);

    const monthlyCap = parseFloat(process.env.TWILIO_MONTHLY_BUDGET_USD ?? "50");
    const monthCost = sumPrice(totalMonth);
    const pctOfBudget = monthlyCap > 0 ? (monthCost / monthlyCap) * 100 : 0;

    return NextResponse.json({
      configured: true,
      currency: totalMonth.usage_records[0]?.price_unit?.toUpperCase() ?? "USD",
      monthly_budget_usd: monthlyCap,
      pct_of_budget: Math.round(pctOfBudget * 10) / 10,
      this_month: {
        total_cost: monthCost,
        sms: { count: sumCount(smsMonth), cost: sumPrice(smsMonth) },
        period: { start: startOfMonth, end: endOfMonth },
      },
      all_time: {
        sms: { count: sumCount(smsAll), cost: sumPrice(smsAll) },
      },
    });
  } catch (e) {
    return NextResponse.json(
      { configured: true, error: e instanceof Error ? e.message : "fetch failed" },
      { status: 500 },
    );
  }
}

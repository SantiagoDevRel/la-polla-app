// app/api/admin/polla-health/route.ts
//
// GET → checks de salud sobre las pollas. La lógica vive en
// lib/admin/polla-health.ts para que el cron de email diario pueda
// reusarla sin que Next.js 14 rechace el build (route.ts solo permite
// exports HTTP / metadata; ver fix en lib/admin/polla-health.ts).

import { NextResponse } from "next/server";
import { isCurrentUserAdmin } from "@/lib/auth/admin";
import { collectPollaHealth } from "@/lib/admin/polla-health";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const result = await collectPollaHealth();
  return NextResponse.json(result);
}

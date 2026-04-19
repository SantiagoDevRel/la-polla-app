// app/(app)/dashboard/page.tsx — Permanent redirect to /inicio.
// Hard cutover from Phase 3c: /inicio is the single home surface. This
// stub keeps old bookmarks and WhatsApp links working.
import { redirect } from "next/navigation";

export default function DashboardPage() {
  redirect("/inicio");
}

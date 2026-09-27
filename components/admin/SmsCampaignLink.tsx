"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { MessageSquare } from "lucide-react";

export default function SmsCampaignLink() {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/sms-campaigns?access=1", { cache: "no-store", signal: controller.signal })
      .then(r => r.ok ? r.json() : null).then(data => setAllowed(data?.allowed === true)).catch(() => {});
    return () => controller.abort();
  }, []);
  return allowed ? <Link href="/admin/sms" className="lp-btn lp-btn-ghost mt-2 w-full"><MessageSquare className="h-5 w-5 shrink-0" aria-hidden="true" />Campañas SMS</Link> : null;
}

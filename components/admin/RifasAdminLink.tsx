"use client";
// components/admin/RifasAdminLink.tsx — enlace a /admin/rifas en el panel.
// Solo aparece con RIFAS_ENABLED (/api/rifas responde { enabled:false } si no).
import { useEffect, useState } from "react";
import Link from "next/link";

export function RifasAdminLink() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/rifas", { cache: "no-store", signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null)).then((d) => setOn(Boolean(d?.enabled))).catch(() => {});
    return () => controller.abort();
  }, []);
  if (!on) return null;
  return <Link href="/admin/rifas" className="lp-btn lp-btn-ghost mt-2 w-full">Rifas de creadores</Link>;
}

"use client";

import Link from "next/link";
import { CircleAlert } from "lucide-react";

export default function AdminPollasError({ retry }: { retry: () => void }) {
  return (
    <div className="px-4 pb-28 pt-8">
      <div role="alert" className="lp-card p-5 text-center">
        <CircleAlert className="mx-auto h-8 w-8 text-red-alert" aria-hidden="true" />
        <h1 className="lp-display mt-3 text-[28px]">No se pudieron cargar las pollas</h1>
        <p className="mt-2 text-[14px] text-text-secondary">Intenta nuevamente para consultar la información actualizada.</p>
        <button type="button" onClick={retry} className="lp-btn lp-btn-primary mt-5 w-full">Reintentar</button>
        <Link href="/admin" className="lp-btn lp-btn-ghost mt-3 w-full">Volver a administración</Link>
      </div>
    </div>
  );
}

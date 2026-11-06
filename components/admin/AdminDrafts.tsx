// components/admin/AdminDrafts.tsx — borradores y pollas ocultas, al final del panel.
//
// (2026-11-06, pedido del dueño) Salieron del inicio: allá estorbaban entre las
// pollas de la gente. Aquí van como filas simples. Una polla normal abre el
// editor; una de campaña (private_draft) abre su página, igual que antes.
import Link from "next/link";
import { ChevronRight, EyeOff } from "lucide-react";
import { SectionHead } from "@/components/street";
import { timeLeft } from "@/lib/casa/format";
import { editorHref } from "@/lib/casa/editor";
import type { CasaPolla } from "@/lib/casa/types";

export function AdminDrafts({ pollas }: { pollas: CasaPolla[] }) {
  return (
    <section aria-label="Borradores privados" className="px-4 pt-9">
      <SectionHead title="Borradores privados" meta={String(pollas.length)} />
      {pollas.length === 0 ? (
        <div className="bg-bg-card p-4 text-center">
          <EyeOff aria-hidden="true" className="mx-auto mb-2 h-6 w-6 text-text-secondary" />
          <p className="text-[14px] text-text-primary">No hay pollas ocultas</p>
        </div>
      ) : (
        <ul className="space-y-px">
          {pollas.map((p) => (
            <li key={p.id}>
              <Link href={p.private_draft ? `/polla/${p.slug}` : editorHref(p.id)}
                className="flex min-h-16 items-center gap-3 bg-bg-card p-4 transition-colors hover:bg-bg-elevated">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-text-primary">{p.name}</span>
                  <span className="block text-[13px] text-text-secondary">
                    {p.status === "borrador" ? "Borrador" : "Oculta"} · cierra en {timeLeft(p.closes_at)}
                  </span>
                </span>
                <ChevronRight aria-hidden="true" className="h-5 w-5 shrink-0 text-text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

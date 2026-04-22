// app/(app)/avisos/page.tsx — Avisos placeholder
//
// Real implementation lands in PR 4 (notifications table + triggers + feed).
// For now this is a stub so the BottomNav tab does not 404. No data access,
// no business logic — just static copy + pollito illustration.

import Image from "next/image";
import { Bell } from "lucide-react";
import { getPollitoBase, DEFAULT_POLLITO } from "@/lib/pollitos";

export const metadata = { title: "Avisos · La Polla" };

export default function AvisosPage() {
  return (
    <main className="min-h-[100dvh] px-5 pt-10 pb-24 flex flex-col">
      <header className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-full bg-bg-elevated border border-border-subtle grid place-items-center">
          <Bell className="w-5 h-5 text-gold" strokeWidth={2} aria-hidden="true" />
        </div>
        <h1 className="font-display text-[26px] tracking-[0.06em] uppercase text-text-primary leading-none">
          Avisos
        </h1>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
        <div className="relative w-32 h-32">
          <Image
            src={getPollitoBase(DEFAULT_POLLITO)}
            alt=""
            fill
            sizes="128px"
            className="object-contain"
          />
        </div>
        <h2 className="font-display text-[22px] tracking-[0.04em] uppercase text-text-primary leading-none">
          Muy pronto
        </h2>
        <p className="text-text-secondary text-[14px] max-w-[260px]">
          Aquí vas a ver cuando un parcero se te acerque, cuando le clavés un
          resultado o cuando arranque una polla nueva.
        </p>
      </div>
    </main>
  );
}

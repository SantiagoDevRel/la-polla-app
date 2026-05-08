// components/inicio/ActivePollasEmpty.tsx
//
// Empty-state for /inicio when the user has zero active pollas. Owns the
// JoinByCodeSheet state because PollitoMoment exposes a single cta slot
// and we need two actions (Crear polla / Unirme con código). Built as a
// client component so the Server /inicio page can pass serializable
// props (userPollitoType) without attaching any handlers.
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { PollitoMoment } from "@/components/pollito/PollitoMoment";
import { JoinByCodeSheet } from "@/components/pollas/JoinByCodeSheet";
import { useToast } from "@/components/ui/Toast";

export interface ActivePollasEmptyProps {
  userPollitoType: string;
}

export function ActivePollasEmpty({ userPollitoType }: ActivePollasEmptyProps) {
  const t = useTranslations("Inicio");
  const tNav = useTranslations("Nav");
  const router = useRouter();
  const { showToast } = useToast();
  const [joinOpen, setJoinOpen] = useState(false);

  return (
    <>
      <PollitoMoment
        moment="M1"
        estado="base"
        userPollitoType={userPollitoType}
        forceDisplay="inline"
        forceShow
        cta={{
          label: t("createPolla"),
          onClick: () => router.push("/pollas/crear"),
        }}
      />
      <p className="mt-4 font-body text-[14px] text-text-secondary text-center">
        {t("emptyMessage")}
      </p>
      <div className="mt-3 flex justify-center">
        <button
          type="button"
          onClick={() => setJoinOpen(true)}
          className="inline-flex items-center gap-2 font-body text-[14px] font-semibold text-gold hover:text-amber transition-colors"
        >
          <KeyRound className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
          {tNav("joinWithCode")}
        </button>
      </div>

      <JoinByCodeSheet
        open={joinOpen}
        onOpenChange={setJoinOpen}
        onSuccess={(polla) => {
          setJoinOpen(false);
          showToast(tNav("joinedToast", { name: polla.name }), "success");
          router.push(`/pollas/${polla.slug}`);
        }}
      />
    </>
  );
}

export default ActivePollasEmpty;

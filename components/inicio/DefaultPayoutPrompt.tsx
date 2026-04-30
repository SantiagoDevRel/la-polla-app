// components/inicio/DefaultPayoutPrompt.tsx
//
// Wrapper client-only que mira si el viewer tiene users.default_payout_*
// seteado y, si NO, abre el DefaultPayoutPromptModal una vez por
// sesión. Saltable — al saltar queda una flag de session para no
// nag-ear de nuevo en esta visita; próxima visita vuelve a aparecer
// hasta que lo guarden o lo descarten desde /perfil.
//
// Persiste vía PATCH /api/users/me con {default_payout_method,
// default_payout_account} — ya seteado en route.ts.
"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import DefaultPayoutPromptModal, {
  type PayoutMethod,
} from "@/components/onboarding/DefaultPayoutPromptModal";

const SESSION_KEY = "default-payout-prompt-skipped";

interface MeResponse {
  profile: {
    default_payout_method: PayoutMethod | null;
    default_payout_account: string | null;
  } | null;
}

export default function DefaultPayoutPrompt() {
  const [open, setOpen] = useState(false);
  const [hasDefault, setHasDefault] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get<MeResponse>("/api/users/me");
      const has =
        !!data.profile?.default_payout_method && !!data.profile?.default_payout_account;
      setHasDefault(has);
      if (!has && typeof window !== "undefined") {
        const skipped = window.sessionStorage.getItem(SESSION_KEY) === "1";
        if (!skipped) setOpen(true);
      }
    } catch {
      setHasDefault(true); // si falla el fetch, no nag — defensive
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(method: PayoutMethod, account: string) {
    try {
      await axios.patch("/api/users/me", {
        default_payout_method: method,
        default_payout_account: account,
      });
      setHasDefault(true);
      setOpen(false);
    } catch {
      /* swallow — modal queda abierto para reintento */
    }
  }

  function skip() {
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage.setItem(SESSION_KEY, "1");
      } catch {
        /* sessionStorage unavailable */
      }
    }
    setOpen(false);
  }

  if (hasDefault !== false) return null;
  return (
    <DefaultPayoutPromptModal
      open={open}
      onSubmit={save}
      onSkip={skip}
    />
  );
}

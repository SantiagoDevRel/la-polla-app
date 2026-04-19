// components/inicio/EmptyStateM1.tsx
//
// Client wrapper around PollitoMoment M1 used by the Inicio empty state.
// PollitoMoment's `cta.onClick` prop is a function, which cannot cross the
// RSC boundary from a Server Component. This wrapper owns the handler so
// the parent page (server) only needs to pass serializable props
// (userPollitoType, nextHref).
"use client";

import { useRouter } from "next/navigation";
import { PollitoMoment } from "@/components/pollito/PollitoMoment";

export interface EmptyStateM1Props {
  userPollitoType: string;
  nextHref: string;
}

export function EmptyStateM1({ userPollitoType, nextHref }: EmptyStateM1Props) {
  const router = useRouter();
  return (
    <PollitoMoment
      moment="M1"
      estado="base"
      userPollitoType={userPollitoType}
      forceDisplay="inline"
      forceShow
      cta={{
        label: "Crear mi primera polla",
        onClick: () => router.push(nextHref),
      }}
    />
  );
}

export default EmptyStateM1;

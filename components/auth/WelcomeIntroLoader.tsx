"use client";

import dynamic from "next/dynamic";

const WelcomeIntro = dynamic(
  () => import("@/components/auth/WelcomeIntro").then((module) => module.WelcomeIntro),
  { ssr: false },
);

/** Keeps the animation client-only while the auth layout remains a Server Component. */
export function WelcomeIntroLoader() {
  return <WelcomeIntro />;
}

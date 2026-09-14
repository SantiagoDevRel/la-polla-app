"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { isLoginLinkPath } from "@/lib/auth/telegram-login/link-path";

const WelcomeIntro = dynamic(
  () => import("@/components/auth/WelcomeIntro").then((module) => module.WelcomeIntro),
  { ssr: false },
);

/** Keeps the animation client-only while the auth layout remains a Server Component. */
export function WelcomeIntroLoader() {
  // La página del enlace de Telegram suele abrirse en el navegador de Telegram
  // (almacenamiento nuevo): la bienvenida taparía la confirmación de ingreso.
  const pathname = usePathname();
  if (isLoginLinkPath(pathname)) return null;
  return <WelcomeIntro />;
}

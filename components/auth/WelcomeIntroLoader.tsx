"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { isLoginLinkPath } from "@/lib/auth/telegram-login/link-path";

const WelcomeIntro = dynamic(
  () => import("@/components/auth/WelcomeIntro").then((module) => module.WelcomeIntro)
    .catch(() => UnavailableIntro),
  { ssr: false },
);

function UnavailableIntro() { return null; }

/** Keeps the animation client-only while the auth layout remains a Server Component. */
export function WelcomeIntroLoader() {
  // La página del enlace de Telegram suele abrirse en el navegador de Telegram
  // (almacenamiento nuevo): la bienvenida taparía la confirmación de ingreso.
  const pathname = usePathname();
  const [needed, setNeeded] = useState(false);
  useEffect(() => {
    try { setNeeded(window.localStorage.getItem("lp_welcome_seen_v1") !== "1"); }
    catch { setNeeded(false); }
  }, []);
  if (isLoginLinkPath(pathname)) return null;
  if (!needed) return null;
  return <WelcomeIntro />;
}

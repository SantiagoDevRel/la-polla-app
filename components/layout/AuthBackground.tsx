"use client";

import { usePathname } from "next/navigation";
import { AppBackground } from "./AppBackground";

/**
 * Login historically remained on the CSS smoke because unauthenticated video
 * requests were redirected. Onboarding is authenticated and keeps the ambient
 * video it already had.
 */
export function AuthBackground() {
  const pathname = usePathname();
  return <AppBackground video={pathname === "/onboarding"} />;
}

// components/platform/PlatformProvider.tsx
//
// React Context que expone si la app está corriendo dentro del wrapper iOS
// Capacitor. Lo setea el layout (server) leyendo `isIOSAppRequest()` y lo
// consumen los componentes client via `useIsIOSApp()`.
//
// Esto NO toca el web ni Android. Solo cambia qué se renderiza cuando el
// User-Agent es el de la app iOS (o, para preview local, cuando hay
// cookie `lp_ios_preview=1`).
"use client";

import { createContext, useContext, type ReactNode } from "react";

const PlatformContext = createContext<{ isIOSApp: boolean }>({ isIOSApp: false });

export function PlatformProvider({
  isIOSApp,
  children,
}: {
  isIOSApp: boolean;
  children: ReactNode;
}) {
  return (
    <PlatformContext.Provider value={{ isIOSApp }}>{children}</PlatformContext.Provider>
  );
}

export function useIsIOSApp(): boolean {
  return useContext(PlatformContext).isIOSApp;
}

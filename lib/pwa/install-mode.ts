// lib/pwa/install-mode.ts
//
// Que ofrecerle a cada telefono cuando le proponemos dejar la app en su
// pantalla. Vive aparte del componente (components/shared/InstallAppBubble)
// porque es la unica parte con reglas de verdad, y asi se puede probar sin
// browser — el repo no tiene testing-library.
//
//   · apk     Android descarga el APK firmado desde la publicación oficial.
//             Tiene prioridad incluso si Chrome ofrece instalar la PWA.
//   · prompt  En otros sistemas, el evento `beforeinstallprompt` abre el
//             diálogo de instalación de la PWA.
//   · ios     Safari NUNCA emitio ese evento y Apple no expone ninguna otra
//             via: en iPhone no existe forma de instalar con un clic. Lo unico
//             honesto es ensenar "Compartir > Agregar a pantalla de inicio".
//
// Dentro de la app instalada o del wrapper no se ofrece instalar otra vez.
// El APK no depende de que el navegador emita el evento de la PWA.

export type InstallMode = "hidden" | "apk" | "prompt" | "ios";

export interface InstallEnvironment {
  userAgent: string;
  /** display-mode standalone/fullscreen, o navigator.standalone en iOS. */
  standalone: boolean;
  /** Corriendo dentro del WebView de Capacitor. */
  nativeShell: boolean;
  /** navigator.maxTouchPoints — delata al iPad, que se presenta como Mac. */
  maxTouchPoints: number;
  /** Ya capturamos el evento `beforeinstallprompt` de Chrome. */
  hasInstallPrompt: boolean;
}

export function isIOSDevice(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPad|iPhone|iPod/.test(userAgent)) return true;
  // iPadOS 13+ manda un UA de Mac; el touch es lo que lo distingue.
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

// Navegador embebido de una red social. En iPhone importa: ahi no aparece
// "Agregar a pantalla de inicio", asi que el primer paso es abrirlo en Safari.
export function isInAppBrowser(userAgent: string): boolean {
  return /FBAN|FBAV|FB_IAB|Instagram|Line\/|Twitter|TikTok/i.test(userAgent);
}

export function resolveInstallMode(env: InstallEnvironment): InstallMode {
  // Ofrecer instalar lo que ya esta instalado es ruido.
  if (env.standalone || env.nativeShell) return "hidden";
  if (/Android/i.test(env.userAgent)) return "apk";
  // Los otros sistemas conservan su instalación PWA cuando está disponible.
  if (env.hasInstallPrompt) return "prompt";
  if (isIOSDevice(env.userAgent, env.maxTouchPoints)) return "ios";
  return "hidden";
}

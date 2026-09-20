// lib/pwa/install-mode.ts
//
// Que ofrecerle a cada telefono cuando le proponemos dejar la app en su
// pantalla. Vive aparte del componente (components/shared/InstallAppBubble)
// porque es la unica parte con reglas de verdad, y asi se puede probar sin
// browser — el repo no tiene testing-library.
//
// Solo hay dos ofertas posibles, y la diferencia la pone Apple:
//   · prompt  Chrome (Android y escritorio) emite `beforeinstallprompt`, asi
//             que UN toque abre su dialogo y la app queda instalada de verdad
//             (WebAPK: icono en el cajon de apps, sin barra de navegador).
//             No hay tutorial porque no hace falta.
//   · ios     Safari NUNCA emitio ese evento y Apple no expone ninguna otra
//             via: en iPhone no existe forma de instalar con un clic. Lo unico
//             honesto es ensenar "Compartir > Agregar a pantalla de inicio".
//
// Y si no hay ninguna de las dos (ya instalada, wrapper Capacitor, o un
// Android cuyo navegador no ofrece instalar — el caso tipico es el navegador
// interno de WhatsApp) no se muestra nada: decision del dueno, 2026-09-20.
// Un boton que no puede cumplir es peor que ningun boton.

export type InstallMode = "hidden" | "prompt" | "ios";

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
  // El evento manda sobre el sistema operativo: si Chrome lo dio, hay un toque
  // y se acabo. Tambien cubre Chrome/Edge de escritorio.
  if (env.hasInstallPrompt) return "prompt";
  if (isIOSDevice(env.userAgent, env.maxTouchPoints)) return "ios";
  return "hidden";
}

// capacitor.config.ts
// Config de Capacitor para envolver la PWA como app Android nativa.
//
// Estrategia: la app corre desde lapollacolombiana.com (deploy de Vercel)
// — el APK es un thin wrapper WebView apuntando a la URL de produccion.
// Esto:
//  - Evita mantener `next export` static (la app usa server routes:
//    /auth/callback, middleware, API routes, Supabase SSR).
//  - Cada feature nueva se deploya a Vercel y la app mobile la "hereda"
//    sin rebuilder el APK ni subir a Play Store.
//  - Requiere conexion para consultar la cuenta y jugar. Ante un fallo de
//    carga muestra una pagina local sin datos de sesion, con reintento.
// Capacitor documenta server.url para live reload; este wrapper remoto es
// una decision explicita del proyecto porque Next necesita su servidor.

import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.lapollacolombiana.app",
  appName: "La Polla Colombiana",
  // webDir apunta a un stub minimo (index.html offline-fallback).
  // NO usar "public" porque empaquetaria iconos, logos de equipos,
  // pollitos, etc. inflando el tamano del APK innecesariamente
  // (la app real corre desde server.url).
  webDir: "android-www-stub",

  // Wrapper de la PWA deployada a Vercel.
  server: {
    url: "https://lapollacolombiana.com",
    cleartext: false,
    errorPath: "index.html",
    // El origen principal ya esta permitido por server.url. Los demas
    // destinos abren fuera de la WebView; fetch/imagenes no necesitan
    // allowNavigation ni acceso al puente nativo.
    allowNavigation: ["www.lapollacolombiana.com"],
  },

  android: {
    allowMixedContent: false,
    zoomEnabled: true,
    appendUserAgent: "LaPollaAndroid/1.0.9",
    backgroundColor: "#080c10", // matchea --bg-base del design system
  },

  ios: {
    // El WebView ocupa todo el viewport (incluido detrás del notch / status bar).
    // El layout de la PWA ya tiene safe-area-insets en CSS via env(safe-area-inset-*),
    // así que no necesitamos que iOS reserve espacio.
    contentInset: "never",
    // Deshabilita el "preview" al hold-press sobre links (estilo Safari)
    // — molesta en una app y dispara navegaciones raras dentro del WebView.
    allowsLinkPreview: false,
    // Permite zoom (accesibilidad). El layout es responsive y aguanta.
    limitsNavigationsToAppBoundDomains: false,
    backgroundColor: "#080c10",
    // scheme: nombre del custom URL scheme que iOS usa internamente para
    // servir la app (no afecta deep links externos). "App" es el default.
    scheme: "App",
    // Marker en el User-Agent del WKWebView para que el server (middleware
    // + lib/platform/ios-app.ts) detecte la request como iOS-app y
    // renderice la UI iOS-mode (sin logos/nombres de ligas, solo Mundial
    // + disclaimer a la web). SIN este marker, Apple ve la versión web
    // con todo el branding -> rechazo Guideline 4.1(a)/5.2.1.
    appendUserAgent: "LaPollaIOS/1.0",
  },

  plugins: {
    SystemBars: {
      style: "DARK",
      // MainActivity reserves bars, cutouts and IME once for every WebView.
      insetsHandling: "disable",
    },
    SplashScreen: {
      // React lo oculta al montar. El limite nativo tambien lo oculta
      // si falla la red o JavaScript: la pagina local de error no tiene
      // plugins Capacitor y no podria llamar SplashScreen.hide().
      launchShowDuration: 3000,
      launchAutoHide: true,
      backgroundColor: "#080c10",
      androidSplashResourceName: "splash",
      // Fullscreen teardown resets decorFitsSystemWindows when leaving the
      // app, competing with MainActivity's persistent inset handling.
      splashFullScreen: false,
      splashImmersive: false,
    },
    Keyboard: {
      // resize/style are iOS-only. resizeOnFullScreen es el unico que
      // aplica en Android — es un workaround del bug donde el teclado
      // no resizea la WebView cuando el StatusBar plugin esta activo.
      resizeOnFullScreen: true,
      // iOS-only: el teclado redimensiona el WebView (la app se acomoda).
      // "native" es default; "body"/"ionic" cambian comportamiento.
      resize: "native",
      // Dark keyboard match con el tema oscuro de la app.
      style: "dark",
    },
  },
};

export default config;

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
//  - Desventaja: sin conexion al primer arranque, queda en el splash.
//    Pero como es PWA con Service Worker (Serwist), despues del primer
//    uso funciona offline normal.
//
// Para BUILD LOCAL (dev en emulador sin red), comentar `server.url`
// y usar `webDir: "out"` despues de `npx next build && next export`.

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
    allowNavigation: [
      "lapollacolombiana.com",
      "*.lapollacolombiana.com",
      // Supabase: phone OTP verify, sessions, postgrest.
      "*.supabase.co",
      // WhatsApp deep links — algunos botones del app abren chat con bot.
      "wa.me",
      "api.whatsapp.com",
      // Cloudflare Turnstile — si se reactiva como anti-bot en login.
      "challenges.cloudflare.com",
    ],
  },

  android: {
    allowMixedContent: false,
    backgroundColor: "#080c10", // matchea --bg-base del design system
  },

  plugins: {
    SplashScreen: {
      // Native splash queda visible hasta que React monta y llama
      // SplashScreen.hide() (ver components/layout/CapacitorReady.tsx).
      // Evita el "flash blanco" durante cold start de Vercel + WebView
      // load + bundle download. Si por algun motivo React nunca monta
      // (ej. crash JS), el launchShowDuration funciona como timeout
      // hard.
      launchShowDuration: 30000,
      launchAutoHide: false,
      backgroundColor: "#080c10",
      androidSplashResourceName: "splash",
      splashFullScreen: true,
      splashImmersive: true,
    },
  },
};

export default config;

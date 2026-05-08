// app/layout.tsx — Layout raíz de la aplicación La Polla App con configuración PWA
import type { Metadata, Viewport } from "next";
import { Bebas_Neue, Outfit } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import "./globals.css";
import { SplashScreen } from "@/components/layout/SplashScreen";
import { CapacitorReady } from "@/components/layout/CapacitorReady";
import { CapacitorBackButton } from "@/components/layout/CapacitorBackButton";
import { CapacitorAppUpdate } from "@/components/layout/CapacitorAppUpdate";
import { CapacitorDeepLinks } from "@/components/layout/CapacitorDeepLinks";
import { OfflineBanner } from "@/components/layout/OfflineBanner";

const bebas = Bebas_Neue({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display",
  display: "swap",
});

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App");
  return {
    title: t("title"),
    description: t("description"),
    manifest: "/manifest.json",
    // Icons resolved via Next.js file convention: app/icon.png and
    // app/apple-icon.png. No explicit metadata.icons needed.
  };
}

export const viewport: Viewport = {
  themeColor: "#FCD116",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} className={`${bebas.variable} ${outfit.variable}`}>
      <body className="antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <CapacitorReady />
          <CapacitorBackButton />
          <CapacitorDeepLinks />
          <CapacitorAppUpdate />
          <OfflineBanner />
          <SplashScreen />
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

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
import { getSiteFromHeaders, SITES } from "@/lib/seo/sites";
import { isIOSAppRequest } from "@/lib/platform/ios-app";
import { PlatformProvider } from "@/components/platform/PlatformProvider";
import { PostHogProvider } from "./providers";
import { AgentationDev } from "@/components/dev/AgentationDev";

// Tribuna Caliente — las dos familias de siempre, de vuelta (2026-09-02).
//
// Anton + Barlow eran el registro de afiche fotocopiado: gritaban parejo y
// aplanaban la pantalla. Bebas Neue tiene la misma condensada deportiva pero
// con hombros redondeados, que es lo que deja que el dorado se lea como premio
// y no como advertencia. Outfit es geometrica y respira: aguanta los tamanos
// chicos en telefonos de gama media sin volverse rigida.
// Siguen siendo DOS familias, como manda el design system.
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
  const site = await getSiteFromHeaders();
  const title = t("title");
  const description = t("description");
  return {
    metadataBase: new URL(site.origin),
    title: {
      default: title,
      template: `%s · ${site.name}`,
    },
    description,
    manifest: "/manifest.json",
    applicationName: site.name,
    keywords:
      site.locale === "es"
        ? [
            "polla deportiva",
            "polla del fin de semana",
            "polla premier league",
            "polla champions league",
            "polla copa libertadores",
            "polla liga betplay",
            "quiniela futbol",
            "pronosticos futbol colombia",
          ]
        : [
            "football pool",
            "weekend football pool",
            "premier league pool",
            "champions league pool",
            "copa libertadores pool",
            "liga betplay pool",
            "soccer predictions",
          ],
    alternates: {
      canonical: "/",
      languages: {
        "es-CO": SITES.ES.origin,
        en: SITES.EN.origin,
        "x-default": SITES.ES.origin,
      },
    },
    openGraph: {
      type: "website",
      url: site.origin,
      siteName: site.name,
      title,
      description,
      locale: site.locale === "es" ? "es_CO" : "en_US",
      alternateLocale: site.locale === "es" ? "en_US" : "es_CO",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
      },
    },
    verification: {
      ...(site.verification.google ? { google: site.verification.google } : {}),
      ...(site.verification.bing
        ? { other: { "msvalidate.01": site.verification.bing } }
        : {}),
    },
    // Icons resolved via Next.js file convention: app/icon.png and
    // app/apple-icon.png. No explicit metadata.icons needed.
  };
}

export const viewport: Viewport = {
  themeColor: "#FCD116",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();
  const site = await getSiteFromHeaders();
  const isIOSApp = await isIOSAppRequest();
  const orgJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: site.name,
    url: site.origin,
    logo: `${site.origin}/icons/icon-512x512.png`,
    description: site.description,
    sameAs: [SITES.ES.origin, SITES.EN.origin],
  };
  const siteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: site.name,
    url: site.origin,
    inLanguage: site.lang,
    description: site.description,
  };

  return (
    <html lang={locale} className={`${bebas.variable} ${outfit.variable}`}>
      <head>
        <script
          id="organization-jsonld"
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
        />
        <script
          id="website-jsonld"
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd) }}
        />
      </head>
      <body className="antialiased lp-concrete">
        <PostHogProvider>
          <NextIntlClientProvider locale={locale} messages={messages}>
            <PlatformProvider isIOSApp={isIOSApp}>
              <CapacitorReady />
              <CapacitorBackButton />
              <CapacitorDeepLinks />
              <CapacitorAppUpdate />
              <OfflineBanner />
              <SplashScreen />
              {children}
            </PlatformProvider>
          </NextIntlClientProvider>
        </PostHogProvider>
        <AgentationDev />
      </body>
    </html>
  );
}

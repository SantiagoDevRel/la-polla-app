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
  const site = getSiteFromHeaders();
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
            "polla mundial 2026",
            "polla champions league",
            "polla copa libertadores",
            "polla liga betplay",
            "quiniela futbol",
            "pronosticos futbol colombia",
            "crear polla con amigos",
          ]
        : [
            "football pool",
            "world cup 2026 pool",
            "champions league pool",
            "copa libertadores pool",
            "liga betplay pool",
            "soccer predictions",
            "create pool with friends",
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
  const site = getSiteFromHeaders();
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
      <body className="antialiased">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd) }}
        />
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

// app/soporte/page.tsx — Página de soporte público (Apple/Play requirement)
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Soporte");
  return {
    title: t("metadataTitle"),
    description: t("metadataDescription"),
  };
}

export default async function SoportePage() {
  const t = await getTranslations("Soporte");
  return (
    <div
      style={{
        background: "#080c10",
        minHeight: "100vh",
        color: "#f0f4ff",
        fontFamily: "'Outfit', sans-serif",
      }}
    >
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "48px 20px" }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
          {t("title")}
        </h1>
        <p style={{ fontSize: 13, color: "#7a8499", marginBottom: 32 }}>
          {t("subtitle")}
        </p>

        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8, color: "#FFD700" }}>
            {t("contactSection")}
          </h2>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#b0b8c8" }}>
            {t("contactBodyBefore")}
            <a
              href="mailto:santiagotrujillozuluaga@gmail.com"
              style={{ color: "#FFD700", textDecoration: "underline" }}
            >
              santiagotrujillozuluaga@gmail.com
            </a>
            {t("contactBodyAfter")}
          </p>
        </section>

        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8, color: "#FFD700" }}>
            {t("reportSection")}
          </h2>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#b0b8c8" }}>
            {t("reportBody")}
          </p>
        </section>

        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8, color: "#FFD700" }}>
            {t("faqSection")}
          </h2>

          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div key={n}>
              <h3 style={{ fontSize: 15, fontWeight: 600, marginTop: 18, marginBottom: 6, color: "#f0f4ff" }}>
                {t(`q${n}`)}
              </h3>
              <p style={{ fontSize: 14, lineHeight: 1.7, color: "#b0b8c8" }}>
                {n === 6 ? (
                  <>
                    {t("a6Before")}
                    <a
                      href="mailto:santiagotrujillozuluaga@gmail.com"
                      style={{ color: "#FFD700", textDecoration: "underline" }}
                    >
                      santiagotrujillozuluaga@gmail.com
                    </a>
                    {t("a6After")}
                  </>
                ) : (
                  t(`a${n}`)
                )}
              </p>
            </div>
          ))}
        </section>

        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8, color: "#FFD700" }}>
            {t("privacySection")}
          </h2>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#b0b8c8" }}>
            {t("privacyBodyBefore")}
            <a
              href="/privacy"
              style={{ color: "#FFD700", textDecoration: "underline" }}
            >
              /privacy
            </a>
            {t("privacyBodyAfter")}
          </p>
        </section>
      </div>
    </div>
  );
}

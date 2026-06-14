// app/privacy/page.tsx — Política de Privacidad / Privacy Policy
import { getTranslations } from "next-intl/server";

export default async function PrivacyPage() {
  const t = await getTranslations("Privacy");
  return (
    <div style={{ background: "#080c10", minHeight: "100vh", color: "#f0f4ff", fontFamily: "'Outfit', sans-serif" }}>
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "48px 20px" }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
          {t("title")}
        </h1>
        <p style={{ fontSize: 13, color: "#7a8499", marginBottom: 32 }}>
          {t("subtitle")}
        </p>

        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8, color: "#FFD700" }}>
            {t("section1Title")}
          </h2>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#b0b8c8" }}>
            {t("section1Body")}
          </p>
        </section>

        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8, color: "#FFD700" }}>
            {t("section2Title")}
          </h2>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#b0b8c8" }}>
            {t("section2Body")}
          </p>
        </section>

        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8, color: "#FFD700" }}>
            {t("section3Title")}
          </h2>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#b0b8c8" }}>
            {t("section3Body")}
          </p>
        </section>

        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8, color: "#FFD700" }}>
            {t("section4Title")}
          </h2>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#b0b8c8" }}>
            {t("section4Body")}
          </p>
        </section>

        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8, color: "#FFD700" }}>
            {t("section5Title")}
          </h2>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#b0b8c8" }}>
            {t("section5BodyBefore")}
            <a href="mailto:santiagotrujillozuluaga@gmail.com" style={{ color: "#FFD700", textDecoration: "underline" }}>
              santiagotrujillozuluaga@gmail.com
            </a>
            {t("section5BodyAfter")}
          </p>
        </section>

        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8, color: "#FFD700" }}>
            {t("section6Title")}
          </h2>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#b0b8c8" }}>
            {t("section6BodyBefore")}
            <a href="mailto:santiagotrujillozuluaga@gmail.com" style={{ color: "#FFD700", textDecoration: "underline" }}>
              santiagotrujillozuluaga@gmail.com
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}

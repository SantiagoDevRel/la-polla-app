// app/delete-account/page.tsx — Solicitud de eliminacion de cuenta.
// Requerido por Google Play (data deletion URL para el store listing).
// Linkeado desde Play Console > App content > Data safety.
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("DeleteAccount");
  return {
    title: t("metadataTitle"),
    description: t("metadataDescription"),
  };
}

export default async function DeleteAccountPage() {
  const t = await getTranslations("DeleteAccount");
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
            {t("section1BodyBefore")}
            <a
              href="mailto:santiagotrujillozuluaga@gmail.com?subject=Eliminar%20cuenta"
              style={{ color: "#FFD700", textDecoration: "underline" }}
            >
              santiagotrujillozuluaga@gmail.com
            </a>
            {t("section1BodyMid")}
            <strong>{t("section1Subject")}</strong>
            {t("section1BodyAfter")}
          </p>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#b0b8c8", marginTop: 12 }}>
            {t("section1Footer")}
          </p>
        </section>

        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8, color: "#FFD700" }}>
            {t("section2Title")}
          </h2>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#b0b8c8" }}>
            {t("section2Intro")}
          </p>
          <ul style={{ fontSize: 14, lineHeight: 1.8, color: "#b0b8c8", paddingLeft: 20, marginTop: 8 }}>
            <li>{t("section2List1")}</li>
            <li>{t("section2List2")}</li>
            <li>{t("section2List3")}</li>
            <li>{t("section2List4")}</li>
            <li>{t("section2List5")}</li>
            <li>{t("section2List6")}</li>
            <li>{t("section2List7")}</li>
            <li>{t("section2List8")}</li>
          </ul>
        </section>

        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8, color: "#FFD700" }}>
            {t("section3Title")}
          </h2>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#b0b8c8" }}>
            {t("section3Intro")}
            <strong>{t("section3IntroAnon")}</strong>
            {t("section3IntroAfter")}
          </p>
          <ul style={{ fontSize: 14, lineHeight: 1.8, color: "#b0b8c8", paddingLeft: 20, marginTop: 8 }}>
            <li>{t("section3List1")}</li>
            <li>{t("section3List2")}</li>
            <li>{t("section3List3")}</li>
          </ul>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#b0b8c8", marginTop: 12 }}>
            {t("section3FooterBefore")}
            <strong>{t("section3FooterStrong")}</strong>
            {t("section3FooterAfter")}
          </p>
        </section>

        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8, color: "#FFD700" }}>
            {t("section4Title")}
          </h2>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#b0b8c8" }}>
            {t("section4Body")}
            <strong>{t("section4BodyStrong")}</strong>
            {t("section4BodyAfter")}
          </p>
        </section>

        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8, color: "#FFD700" }}>
            {t("section5Title")}
          </h2>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#b0b8c8" }}>
            {t("section5BodyBefore")}
            <a
              href="mailto:santiagotrujillozuluaga@gmail.com"
              style={{ color: "#FFD700", textDecoration: "underline" }}
            >
              santiagotrujillozuluaga@gmail.com
            </a>
            {t("section5BodyAfter")}
          </p>
        </section>
      </div>
    </div>
  );
}

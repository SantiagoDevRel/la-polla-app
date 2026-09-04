// app/privacy/page.tsx — Política de Privacidad / Privacy Policy
import { getTranslations } from "next-intl/server";

export default async function PrivacyPage() {
  const t = await getTranslations("Privacy");
  return (
    <main className="min-h-screen bg-bg-base font-body text-text-primary">
      <div className="mx-auto max-w-[680px] px-[20px] py-[48px]">
        <h1 className="mb-[4px] text-[24px] font-bold">
          {t("title")}
        </h1>
        <p className="mb-[32px] text-[13px] text-text-muted">
          {t("subtitle")}
        </p>

        <section className="mb-[28px]">
          <h2 className="mb-[8px] text-[17px] font-semibold text-gold">
            {t("section1Title")}
          </h2>
          <p className="text-[14px] leading-[1.7] text-text-secondary">
            {t("section1Body")}
          </p>
        </section>

        <section className="mb-[28px]">
          <h2 className="mb-[8px] text-[17px] font-semibold text-gold">
            {t("section2Title")}
          </h2>
          <p className="text-[14px] leading-[1.7] text-text-secondary">
            {t("section2Body")}
          </p>
        </section>

        <section className="mb-[28px]">
          <h2 className="mb-[8px] text-[17px] font-semibold text-gold">
            {t("section3Title")}
          </h2>
          <p className="text-[14px] leading-[1.7] text-text-secondary">
            {t("section3Body")}
          </p>
        </section>

        <section className="mb-[28px]">
          <h2 className="mb-[8px] text-[17px] font-semibold text-gold">
            {t("section4Title")}
          </h2>
          <p className="text-[14px] leading-[1.7] text-text-secondary">
            {t("section4Body")}
          </p>
        </section>

        <section className="mb-[28px]">
          <h2 className="mb-[8px] text-[17px] font-semibold text-gold">
            {t("section5Title")}
          </h2>
          <p className="text-[14px] leading-[1.7] text-text-secondary">
            {t("section5BodyBefore")}
            <a
              href="mailto:santiagotrujillozuluaga@gmail.com"
              className="text-gold underline underline-offset-2 transition-colors hover:text-amber"
            >
              santiagotrujillozuluaga@gmail.com
            </a>
            {t("section5BodyAfter")}
          </p>
        </section>

        <section className="mb-[28px]">
          <h2 className="mb-[8px] text-[17px] font-semibold text-gold">
            {t("section6Title")}
          </h2>
          <p className="text-[14px] leading-[1.7] text-text-secondary">
            {t("section6BodyBefore")}
            <a
              href="mailto:santiagotrujillozuluaga@gmail.com"
              className="text-gold underline underline-offset-2 transition-colors hover:text-amber"
            >
              santiagotrujillozuluaga@gmail.com
            </a>
          </p>
        </section>
      </div>
    </main>
  );
}

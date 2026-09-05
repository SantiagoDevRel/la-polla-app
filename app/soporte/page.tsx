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
            {t("contactSection")}
          </h2>
          <p className="text-[14px] leading-[1.7] text-text-secondary">
            {t("contactBodyBefore")}
            <a
              href="mailto:santiagotrujillozuluaga@gmail.com"
              className="text-gold underline underline-offset-2 transition-colors hover:text-amber"
            >
              santiagotrujillozuluaga@gmail.com
            </a>
            {t("contactBodyAfter")}
          </p>
        </section>

        <section className="mb-[28px]">
          <h2 className="mb-[8px] text-[17px] font-semibold text-gold">
            {t("reportSection")}
          </h2>
          <p className="text-[14px] leading-[1.7] text-text-secondary">
            {t("reportBody")}
          </p>
        </section>

        <section className="mb-[28px]">
          <h2 className="mb-[8px] text-[17px] font-semibold text-gold">
            {t("faqSection")}
          </h2>

          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div key={n}>
              <h3 className="mb-[6px] mt-[18px] text-[15px] font-semibold text-text-primary">
                {t(`q${n}`)}
              </h3>
              <p className="text-[14px] leading-[1.7] text-text-secondary">
                {n === 6 ? (
                  <>
                    {t("a6Before")}
                    <a
                      href="mailto:santiagotrujillozuluaga@gmail.com"
                      className="text-gold underline underline-offset-2 transition-colors hover:text-amber"
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

        <section className="mb-[28px]">
          <h2 className="mb-[8px] text-[17px] font-semibold text-gold">
            {t("privacySection")}
          </h2>
          <p className="text-[14px] leading-[1.7] text-text-secondary">
            {t("privacyBodyBefore")}
            <a
              href="/privacy"
              className="text-gold underline underline-offset-2 transition-colors hover:text-amber"
            >
              /privacy
            </a>
            {t("privacyBodyAfter")}
          </p>
        </section>
      </div>
    </main>
  );
}

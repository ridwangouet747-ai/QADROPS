import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/landing-page";
import { getRequestLocale } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";

/*
 * Page publique de présentation (mission 16). Elle remplace l'ancienne page d'accueil, qui affichait une
 * maquette fictive en français seulement (historique Git). La langue vient du cookie `qadr-locale`, comme
 * pour le reste de l'application ; une URL par langue (`/en`, `/ar`) reste une décision du propriétaire
 * (D3 de docs/product/landing-page-plan.md).
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const t = createTranslator(locale);
  return {
    title: t("landing.meta.title"),
    description: t("landing.meta.description"),
    openGraph: { type: "website", siteName: "Qadr Ops", title: t("landing.meta.title"), description: t("landing.meta.description"), locale: { fr: "fr_FR", en: "en_US", ar: "ar" }[locale] },
  };
}

export default async function HomePage() {
  const locale = await getRequestLocale();
  const t = createTranslator(locale);
  // Données structurées factuelles : ni note, ni avis, ni prix (aucun prix n'est encore publié).
  const structuredData = {
    "@context": "https://schema.org", "@type": "SoftwareApplication", name: "Qadr Ops",
    applicationCategory: "BusinessApplication", operatingSystem: "Web", inLanguage: ["fr", "en", "ar"],
    description: t("landing.meta.description"), publisher: { "@type": "Organization", name: "Qadr Agency" },
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
      <LandingPage t={t} locale={locale} />
    </>
  );
}

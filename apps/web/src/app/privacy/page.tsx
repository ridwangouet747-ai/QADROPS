import Link from "next/link";
import { getRequestLocale, localizedPageMetadata } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import { PRIVACY_POLICY_UPDATED_AT, privacyPolicyFr } from "@/lib/legal/privacy-policy";

/*
 * Politique de confidentialité publique (mission 13). Projet à valider juridiquement : le bandeau le dit.
 * Le texte n'existe qu'en français ; en anglais ou en arabe, l'interface l'annonce et le texte reste
 * marqué `lang="fr" dir="ltr"` pour être lu correctement dans une page RTL.
 */
export const generateMetadata = () => localizedPageMetadata("meta.privacy");

export default async function PrivacyPage() {
  const locale = await getRequestLocale();
  const t = createTranslator(locale);
  return (
    <main className="min-h-dvh bg-canvas px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <Link href="/login" className="text-sm font-semibold text-brand-strong no-underline">{t("privacy.back")}</Link>
        <h1 className="mt-4 mb-2 text-3xl font-bold tracking-[-0.02em] text-ink">{t("privacy.title")}</h1>
        <p className="m-0 text-sm text-fg-subtle">{t("privacy.updated")} : <span dir="ltr">{PRIVACY_POLICY_UPDATED_AT}</span></p>
        <p role="note" className="mt-5 rounded-[14px] border border-warn-line bg-warn-soft p-4 text-sm font-semibold text-warn">{t("privacy.draft")}</p>
        {locale !== "fr" && <p className="mt-3 rounded-[14px] bg-surface p-4 text-sm text-ink">{t("privacy.frenchOnly")}</p>}
        <article lang="fr" dir="ltr" className="mt-6 grid gap-6 rounded-[20px] bg-surface p-5 text-start text-[0.95rem] leading-relaxed text-ink shadow-sm sm:p-8">
          {privacyPolicyFr.map((section) => (
            <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`}>
              <h2 id={`${section.id}-title`} className="m-0 mb-2 text-lg font-bold">{section.title}</h2>
              {section.paragraphs.map((paragraph) => <p key={paragraph} className="m-0 mb-2">{paragraph}</p>)}
              {section.items && <ul className="m-0 grid gap-1 ps-5">{section.items.map((item) => <li key={item}>{item}</li>)}</ul>}
            </section>
          ))}
        </article>
      </div>
    </main>
  );
}

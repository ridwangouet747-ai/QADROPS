import Link from "next/link";
import { cn } from "@/components/ui/cn";
import { Icon } from "@/components/ui/icon";
import { getPublicPlans, type PublicPlan } from "@/lib/domain/public-plans";
import { intlLocale, type Locale } from "@/lib/i18n/config";
import { formatXof } from "@/lib/i18n/format";
import type { Translate } from "@/lib/i18n/translate";
import { whatsappHref, whatsappNumber } from "@/lib/commercial/mode";
import { readContactChannel, type ContactChannel } from "@/lib/landing/contact";

/*
 * Tarifs lus dans `subscription_plan` (formules actives en XOF), jamais écrits dans le code : le prix affiché
 * est celui qui sera facturé. Modèle commercial du 2026-11-16 : seule la formule STANDARD est montrée ; on la
 * commande auprès de Qadr Agency (WhatsApp, numéro `QADR_WHATSAPP_NUMBER`), qui remet un code d'accès vérifié sur
 * /redeem-code. Aucun lien n'ouvre l'inscription sans code. Sans numéro configuré, aucun lien WhatsApp n'est inventé.
 *
 * L'offre Business (« sur devis ») n'est pas une formule facturée : elle ne vient pas de la base et n'a pas de
 * prix. Son bouton ouvre le canal de contact de `QADR_CONTACT_URL` ; sans ce canal, l'offre n'est pas montrée
 * en production (hors production elle reste visible, avec la mention du réglage manquant).
 */
function PlanCard({ plan, t, locale, whatsapp }: { plan: PublicPlan; t: Translate; locale: Locale; whatsapp: string | null }) {
  const count = (value: number) => new Intl.NumberFormat(intlLocale[locale]).format(value);
  return (
    <li className="flex min-w-0 flex-col rounded-[1.75rem] border border-line bg-surface p-6 text-ink sm:p-7">
      <h3 className="m-0 font-display text-[1.35rem] font-bold">{plan.name}</h3>
      <p className="m-0 mt-5 flex flex-wrap items-baseline gap-x-2">
        <span className="font-display text-[2.4rem] leading-none font-bold tracking-tight">{plan.priceXof === "0" ? t("landing.pricing.free") : formatXof(plan.priceXof, locale)}</span>
        <span className="text-fg-muted">{t("landing.pricing.period", { days: count(plan.durationDays) })}</span>
      </p>
      {plan.description && <p className="m-0 mt-4 leading-relaxed text-fg-muted">{plan.description}</p>}
      <ul className="m-0 mt-5 grid list-none gap-2.5 p-0">
        <li className="flex items-start gap-2"><Icon name="check" className="mt-0.5 size-4 shrink-0 text-ok" />{plan.productLimit ? t("landing.pricing.products", { count: count(plan.productLimit) }) : t("landing.pricing.unlimitedProducts")}</li>
        <li className="flex items-start gap-2"><Icon name="check" className="mt-0.5 size-4 shrink-0 text-ok" />{plan.userLimit ? t("landing.pricing.users", { count: count(plan.userLimit) }) : t("landing.pricing.unlimitedUsers")}</li>
      </ul>
      <div className="mt-auto pt-7">
        {whatsapp
          ? <a href={whatsappHref(whatsapp, t("landing.access.whatsappMessage")) ?? undefined} target="_blank" rel="noopener noreferrer" className="flex min-h-12 items-center justify-center rounded-full bg-brand px-5 font-semibold text-white no-underline transition-colors hover:bg-brand-strong">{t("landing.pricing.order")}</a>
          : <Link href="/redeem-code" className="flex min-h-12 items-center justify-center rounded-full bg-brand px-5 font-semibold text-white no-underline transition-colors hover:bg-brand-strong">{t("landing.haveCode")}</Link>}
        <p className="m-0 mt-3 text-[0.86rem] leading-relaxed text-fg-muted">{t("landing.access.steps")}</p>
      </div>
    </li>
  );
}

/** Offre Business : solution personnalisée, sur devis, discutée directement avec Qadr Agency. */
function BusinessCard({ t, contact }: { t: Translate; contact: ContactChannel | null }) {
  const external = contact?.kind === "web" || contact?.kind === "whatsapp";
  return (
    <li className="flex min-w-0 flex-col rounded-[1.75rem] bg-qadr-950 p-6 text-white shadow-raised sm:p-7">
      <h3 className="m-0 font-display text-[1.35rem] font-bold">{t("landing.pricing.businessName")}</h3>
      <p className="m-0 mt-1 font-semibold text-qadr-200">{t("landing.pricing.businessTag")}</p>
      <p className="m-0 mt-5 font-display text-[2.4rem] leading-none font-bold tracking-tight rtl:leading-snug rtl:tracking-normal">{t("landing.pricing.businessPrice")}</p>
      <p className="m-0 mt-4 leading-relaxed text-qadr-100">{t("landing.pricing.businessBody")}</p>
      <ul className="m-0 mt-5 grid list-none gap-2.5 p-0">
        {(["businessCustom", "businessFit", "businessSupport"] as const).map((key) => (
          <li key={key} className="flex items-start gap-2"><Icon name="check" className="mt-0.5 size-4 shrink-0 text-qadr-300" />{t(`landing.pricing.${key}`)}</li>
        ))}
      </ul>
      <div className="mt-auto pt-7">
        {contact ? (
          <a href={contact.href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className="flex min-h-12 items-center justify-center rounded-full bg-white px-5 font-semibold text-qadr-900 no-underline transition-colors hover:bg-qadr-100 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-qadr-300">{t("landing.pricing.businessCta")}</a>
        ) : (
          <p className="m-0 flex items-start gap-2 rounded-2xl border border-dashed border-qadr-300/60 p-3 text-[0.86rem] leading-relaxed text-qadr-100"><Icon name="info" className="mt-0.5 size-4 shrink-0" />{t("landing.pricing.businessNoContact")}</p>
        )}
      </div>
    </li>
  );
}

export async function PricingSection({ t, locale, container }: { t: Translate; locale: Locale; container: string }) {
  const result = await getPublicPlans();
  // Une seule formule publique (2026-11-16) : les autres restent en base, invisibles ici.
  const plans = result.status === "ok" ? result.plans.filter((plan) => plan.code === "STANDARD") : [];
  const whatsapp = whatsappNumber();
  const contact = readContactChannel();
  // Sans canal de contact, l'offre Business ne promet rien de joignable : elle est retirée en production.
  const showBusiness = contact !== null || process.env.NODE_ENV !== "production";
  const cards = plans.length + (showBusiness ? 1 : 0);
  // Jusqu'à deux cartes, l'encart du code tient à côté ; au-delà il passe dessous pour laisser leur largeur aux prix.
  const wide = cards > 2;
  return (
    <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-20 py-20 sm:py-28">
      <div className={container}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <h2 id="pricing-title" className="landing-h2">{t("landing.pricing.title")}</h2>
            <p className="m-0 mt-4 text-[1.05rem] leading-relaxed text-fg-muted">{t("landing.pricing.intro")}</p>
          </div>
          {result.preview && plans.length > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-warn-line bg-warn-soft px-3 py-1 text-[0.82rem] font-semibold text-warn"><Icon name="info" className="size-3.5" />{t("landing.pricing.previewBadge")}</span>
          )}
        </div>

        <div className={cn("mt-12 grid gap-5", !wide && "lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]")}>
          <div className="grid min-w-0 content-start gap-5">
            {plans.length === 0 && (
              <div className="relative isolate flex min-w-0 flex-col justify-center overflow-hidden rounded-[1.75rem] bg-qadr-50 p-7 sm:p-10">
                <span aria-hidden="true" className="qadr-links absolute inset-0 -z-10 text-qadr-200/60" />
                <h3 className="m-0 font-display text-[1.6rem] leading-tight font-bold text-ink">{result.status === "ok" ? t("landing.pricing.emptyTitle") : t("landing.pricing.unavailable")}</h3>
                {result.status === "ok" && <p className="m-0 mt-3 max-w-lg leading-relaxed text-fg-muted">{t("landing.pricing.emptyBody")}</p>}
                {whatsapp
                  ? <a href={whatsappHref(whatsapp, t("landing.access.whatsappMessage")) ?? undefined} target="_blank" rel="noopener noreferrer" className="mt-7 inline-flex min-h-12 w-fit items-center justify-center rounded-full bg-brand px-6 font-semibold text-white no-underline transition-colors hover:bg-brand-strong">{t("landing.access.whatsapp")}</a>
                  : <Link href="/redeem-code" className="mt-7 inline-flex min-h-12 w-fit items-center justify-center rounded-full bg-brand px-6 font-semibold text-white no-underline transition-colors hover:bg-brand-strong">{t("landing.haveCode")}</Link>}
              </div>
            )}
            {cards > 0 && (
              <ul className={cn("m-0 grid list-none gap-5 p-0", cards > 1 && "md:grid-cols-2", wide && "lg:grid-cols-3")}>
                {plans.map((plan) => <PlanCard key={plan.code} plan={plan} t={t} locale={locale} whatsapp={whatsapp} />)}
                {showBusiness && <BusinessCard t={t} contact={contact} />}
              </ul>
            )}
            {plans.length > 0 && <p className="m-0 text-[0.9rem] text-fg-muted">{t("landing.pricing.currency")}</p>}
          </div>
          <aside aria-labelledby="promo-title" className={cn("flex min-w-0 flex-col rounded-[1.75rem] border border-dashed border-qadr-300 bg-surface p-6 sm:p-7", wide && "lg:max-w-xl")}>
            <span className="grid size-11 place-items-center rounded-2xl bg-brand-soft text-brand"><Icon name="tag" /></span>
            <h3 id="promo-title" className="m-0 mt-5 font-display text-[1.25rem] font-bold text-ink">{t("landing.pricing.promoTitle")}</h3>
            <p className="m-0 mt-2 leading-relaxed text-fg-muted">{t("landing.pricing.promoBody")}</p>
            <Link href="/redeem-code" className="mt-6 inline-flex min-h-11 w-fit items-center gap-1.5 rounded-full px-1 font-semibold text-brand-strong underline decoration-qadr-300 decoration-2 underline-offset-4 hover:decoration-brand">{t("landing.pricing.promoCta")}</Link>
          </aside>
        </div>
      </div>
    </section>
  );
}

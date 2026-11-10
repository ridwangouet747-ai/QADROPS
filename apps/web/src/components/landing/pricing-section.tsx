import Link from "next/link";
import { cn } from "@/components/ui/cn";
import { Icon } from "@/components/ui/icon";
import { getPublicPlans, type PublicPlan } from "@/lib/domain/public-plans";
import { intlLocale, type Locale } from "@/lib/i18n/config";
import { formatXof } from "@/lib/i18n/format";
import type { Translate } from "@/lib/i18n/translate";

/*
 * Tarifs lus dans `subscription_plan` (formules actives en XOF), jamais écrits dans le code. Sans formule
 * publiée, la section le dit et renvoie vers l'inscription. Le code Qadr Agency se saisit pendant la création
 * du commerce (assistant d'inscription, `/api/public/campaigns/check`) : la page n'en simule pas la validation.
 */
function PlanCard({ plan, t, locale, featured }: { plan: PublicPlan; t: Translate; locale: Locale; featured: boolean }) {
  const count = (value: number) => new Intl.NumberFormat(intlLocale[locale]).format(value);
  return (
    <li className={cn("flex min-w-0 flex-col rounded-[1.75rem] border p-6 sm:p-7", featured ? "border-transparent bg-qadr-950 text-white shadow-raised" : "border-line bg-surface text-ink")}>
      <h3 className="m-0 font-display text-[1.35rem] font-bold">{plan.name}</h3>
      <p className="m-0 mt-5 flex flex-wrap items-baseline gap-x-2">
        <span className="font-display text-[2.4rem] leading-none font-bold tracking-tight">{plan.priceXof === "0" ? t("landing.pricing.free") : formatXof(plan.priceXof, locale)}</span>
        <span className={featured ? "text-qadr-200" : "text-fg-muted"}>{t("landing.pricing.period", { days: count(plan.durationDays) })}</span>
      </p>
      {plan.description && <p className={cn("m-0 mt-4 leading-relaxed", featured ? "text-qadr-100" : "text-fg-muted")}>{plan.description}</p>}
      <ul className="m-0 mt-5 grid list-none gap-2.5 p-0">
        <li className="flex items-start gap-2"><Icon name="check" className={cn("mt-0.5 size-4 shrink-0", featured ? "text-qadr-300" : "text-ok")} />{plan.productLimit ? t("landing.pricing.products", { count: count(plan.productLimit) }) : t("landing.pricing.unlimitedProducts")}</li>
        <li className="flex items-start gap-2"><Icon name="check" className={cn("mt-0.5 size-4 shrink-0", featured ? "text-qadr-300" : "text-ok")} />{plan.userLimit ? t("landing.pricing.users", { count: count(plan.userLimit) }) : t("landing.pricing.unlimitedUsers")}</li>
      </ul>
      <div className="mt-auto pt-7">
        <Link href="/register" className={cn("flex min-h-12 items-center justify-center rounded-full px-5 font-semibold no-underline transition-colors", featured ? "bg-white text-qadr-900 hover:bg-qadr-100" : "bg-brand text-white hover:bg-brand-strong")}>{t("landing.pricing.start")}</Link>
      </div>
    </li>
  );
}

export async function PricingSection({ t, locale, container }: { t: Translate; locale: Locale; container: string }) {
  const result = await getPublicPlans();
  const plans = result.status === "ok" ? result.plans : [];
  return (
    <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-20 bg-surface py-20 sm:py-28">
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

        <div className="mt-12 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          {plans.length > 0 ? (
            <div className="min-w-0">
              <ul className={cn("m-0 grid list-none gap-5 p-0", plans.length > 1 && "md:grid-cols-2", plans.length > 2 && "xl:grid-cols-3")}>
                {plans.map((plan, index) => <PlanCard key={plan.code} plan={plan} t={t} locale={locale} featured={plans.length > 1 && index === plans.length - 1} />)}
              </ul>
              <p className="m-0 mt-4 text-[0.9rem] text-fg-subtle">{t("landing.pricing.currency")}</p>
            </div>
          ) : (
            <div className="relative isolate flex min-w-0 flex-col justify-center overflow-hidden rounded-[1.75rem] bg-qadr-50 p-7 sm:p-10">
              <span aria-hidden="true" className="qadr-links absolute inset-0 -z-10 text-qadr-200/60" />
              <h3 className="m-0 font-display text-[1.6rem] leading-tight font-bold text-ink">{result.status === "ok" ? t("landing.pricing.emptyTitle") : t("landing.pricing.unavailable")}</h3>
              {result.status === "ok" && <p className="m-0 mt-3 max-w-lg leading-relaxed text-fg-muted">{t("landing.pricing.emptyBody")}</p>}
              <Link href="/register" className="mt-7 inline-flex min-h-12 w-fit items-center justify-center rounded-full bg-brand px-6 font-semibold text-white no-underline transition-colors hover:bg-brand-strong">{t("landing.pricing.start")}</Link>
            </div>
          )}
          <aside aria-labelledby="promo-title" className="flex min-w-0 flex-col rounded-[1.75rem] border border-dashed border-qadr-300 bg-surface p-6 sm:p-7">
            <span className="grid size-11 place-items-center rounded-2xl bg-brand-soft text-brand"><Icon name="tag" /></span>
            <h3 id="promo-title" className="m-0 mt-5 font-display text-[1.25rem] font-bold text-ink">{t("landing.pricing.promoTitle")}</h3>
            <p className="m-0 mt-2 leading-relaxed text-fg-muted">{t("landing.pricing.promoBody")}</p>
            <Link href="/register" className="mt-6 inline-flex min-h-11 w-fit items-center gap-1.5 rounded-full px-1 font-semibold text-brand-strong underline decoration-qadr-300 decoration-2 underline-offset-4 hover:decoration-brand">{t("landing.pricing.promoCta")}</Link>
          </aside>
        </div>
      </div>
    </section>
  );
}

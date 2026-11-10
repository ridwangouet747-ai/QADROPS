import Image from "next/image";
import Link from "next/link";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Icon, type IconName } from "@/components/ui/icon";
import type { Locale } from "@/lib/i18n/config";
import type { Translate } from "@/lib/i18n/translate";

/*
 * Page publique de présentation (mission 16, cahier des charges docs/product/landing-page-plan.md).
 * Composant serveur, sans donnée de commerce ni session. Les captures sont de vraies captures de l'application
 * (mode aperçu, données de démonstration, voir docs/product/landing-page.md) et sont marquées comme telles.
 */

const container = "mx-auto w-full max-w-6xl px-4 sm:px-6";
const sectionTitle = "m-0 font-heading text-[1.65rem] leading-tight font-extrabold tracking-tight text-ink rtl:leading-snug rtl:tracking-normal sm:text-[2.1rem]";

function SectionHeading({ id, title, intro }: { id: string; title: string; intro?: string }) {
  return (
    <div className="max-w-2xl">
      <h2 id={id} className={sectionTitle}>{title}</h2>
      {intro && <p className="m-0 mt-3 text-base leading-relaxed text-fg-muted">{intro}</p>}
    </div>
  );
}

function Wordmark({ t }: { t: Translate }) {
  return (
    <Link href="/" aria-label={t("landing.home")} className="inline-flex min-h-11 items-center gap-2.5 font-heading text-[1.05rem] font-extrabold tracking-tight text-ink no-underline">
      <span className="grid size-9 place-items-center rounded-md bg-brand-gradient text-sm font-black text-white shadow-brand" aria-hidden="true">Q</span>
      <span dir="ltr" className="whitespace-nowrap">QADR OPS</span>
    </Link>
  );
}

function Screens({ t, locale }: { t: Translate; locale: Locale }) {
  return (
    <figure className="relative m-0 mx-auto w-full max-w-xl lg:max-w-none" aria-label={t("landing.hero.shotsLabel")}>
      {/* Ordinateur : capture de la vue d'ensemble (chargée seulement à partir de la tablette). */}
      <div className="ms-auto hidden w-[88%] overflow-hidden rounded-xl border border-line bg-surface shadow-overlay md:block">
        <div className="flex h-7 items-center gap-1.5 border-b border-line bg-surface-muted px-3" aria-hidden="true">
          <i className="size-2.5 rounded-full bg-line-strong" /><i className="size-2.5 rounded-full bg-line-strong" /><i className="size-2.5 rounded-full bg-line-strong" />
        </div>
        <Image src={`/landing/dashboard-desktop-${locale}.png`} alt={t("landing.hero.desktopAlt")} width={1280} height={800} loading="eager" sizes="(min-width: 1024px) 560px, 88vw" className="block h-auto w-full" />
      </div>
      {/* Téléphone : capture de la caisse, toujours visible (premier plan sur ordinateur). */}
      <div className="relative mx-auto w-[62%] max-w-[260px] md:absolute md:bottom-[-8%] md:start-0 md:w-[34%]">
        <div className="overflow-hidden rounded-[1.6rem] border-[6px] border-night bg-night shadow-overlay">
          <Image src={`/landing/pos-phone-${locale}.png`} alt={t("landing.hero.phoneAlt")} width={390} height={844} priority sizes="(min-width: 768px) 200px, 62vw" className="block h-auto w-full rounded-[1.1rem]" />
        </div>
      </div>
      <figcaption className="mt-4 flex justify-center md:mt-14 md:justify-end">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-warn-line bg-warn-soft px-3 py-1 text-xs font-semibold text-warn">
          <Icon name="info" className="size-3.5" />{t("landing.hero.demo")}
        </span>
      </figcaption>
    </figure>
  );
}

const problems = ["stock", "credit", "cash", "team"] as const;
const problemIcons: Record<(typeof problems)[number], IconName> = { stock: "box", credit: "users", cash: "wallet", team: "shield" };
const features = ["pos", "payments", "stock", "credit", "cash", "reports"] as const;
const featureIcons: Record<(typeof features)[number], IconName> = { pos: "cart", payments: "receipt", stock: "layers", credit: "users", cash: "wallet", reports: "chart" };
const more = ["suppliers", "inventory", "imports", "receipts", "team", "notifications", "install", "languages", "dataExport", "isolation"] as const;
const sectors = ["hardware", "phones", "general", "clothing"] as const;
const sectorIcons: Record<(typeof sectors)[number], IconName> = { hardware: "tag", phones: "activity", general: "store", clothing: "grid" };
const steps = ["step1", "step2", "step3"] as const;
const honest = ["online", "payments", "imports"] as const;
const honestIcons: Record<(typeof honest)[number], IconName> = { online: "cloudOff", payments: "wallet", imports: "clipboard" };
const faq = ["devices", "barcode", "staff", "data", "languages"] as const;

export function LandingPage({ t, locale }: { t: Translate; locale: Locale }) {
  const year = new Date().getFullYear();
  return (
    <div className="min-h-dvh bg-canvas text-fg">
      <a href="#contenu" className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-surface focus:px-4 focus:py-2 focus:font-semibold focus:text-ink focus:shadow-raised">{t("landing.skip")}</a>

      <header className="sticky top-0 z-40 border-b border-line/70 bg-canvas/85 backdrop-blur-md">
        <div className={cn(container, "flex min-h-16 items-center gap-3")}>
          <Wordmark t={t} />
          <nav aria-label={t("landing.nav.label")} className="ms-6 hidden lg:block">
            <ul className="m-0 flex list-none gap-1 p-0">
              {(["features", "sectors", "how", "faq"] as const).map((key) => (
                <li key={key}><a href={`#${key}`} className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-fg-muted no-underline hover:bg-surface hover:text-ink">{t(`landing.nav.${key}`)}</a></li>
              ))}
            </ul>
          </nav>
          <div className="ms-auto flex items-center gap-2">
            <LanguageSwitcher />
            <Link href="/login" className="hidden min-h-11 items-center rounded-full px-3 text-sm font-semibold whitespace-nowrap text-brand-strong no-underline hover:bg-brand-soft sm:inline-flex">{t("landing.login")}</Link>
            <span className="hidden sm:inline-flex"><Link href="/register" className={buttonClasses({ variant: "cta", className: "whitespace-nowrap no-underline" })}>{t("landing.register")}</Link></span>
          </div>
        </div>
      </header>

      <main id="contenu" tabIndex={-1} className="outline-none">
        {/* Présentation */}
        <section aria-labelledby="hero-title" className="relative overflow-hidden">
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[36rem] bg-[radial-gradient(60%_60%_at_80%_10%,rgb(91_77_242/16%),transparent_70%)]" />
          <div className={cn(container, "relative grid items-center gap-12 pt-10 pb-20 sm:pt-14 lg:grid-cols-[1.05fr_1fr] lg:gap-10 lg:pt-20 lg:pb-28")}>
            <div>
              <p className="m-0 inline-flex items-center gap-2 rounded-2xl border border-brand-tint bg-surface px-3 py-1.5 text-[0.8rem] leading-snug font-semibold text-brand-strong">
                <span className="size-1.5 shrink-0 rounded-full bg-brand" aria-hidden="true" />{t("landing.hero.kicker")}
              </p>
              <h1 id="hero-title" className="m-0 mt-5 font-heading text-[2.15rem] leading-[1.08] font-extrabold tracking-tight text-ink rtl:leading-[1.3] rtl:tracking-normal sm:text-5xl lg:text-[3.4rem]">{t("landing.hero.title")}</h1>
              <p className="m-0 mt-5 max-w-xl text-[1.05rem] leading-relaxed text-fg-muted sm:text-lg">{t("landing.hero.lede")}</p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href="/register" className={buttonClasses({ variant: "cta", size: "lg", className: "no-underline" })}>
                  {t("landing.register")}<Icon name="forward" className="size-4.5" />
                </Link>
                <Link href="/login" className={buttonClasses({ variant: "secondary", size: "lg", className: "no-underline" })}>{t("landing.login")}</Link>
              </div>
              <p className="m-0 mt-5 flex items-start gap-2 text-sm text-fg-subtle"><Icon name="check" className="mt-0.5 size-4 text-ok" />{t("landing.hero.note")}</p>
            </div>
            <Screens t={t} locale={locale} />
          </div>
        </section>

        {/* Problèmes résolus */}
        <section aria-labelledby="problems-title" className="bg-surface py-16 sm:py-24">
          <div className={container}>
            <SectionHeading id="problems-title" title={t("landing.problems.title")} intro={t("landing.problems.intro")} />
            <ul className="m-0 mt-10 grid list-none gap-4 p-0 sm:grid-cols-2">
              {problems.map((key) => (
                <li key={key} className="flex gap-4 rounded-xl border border-line bg-paper p-5 sm:p-6">
                  <span className="grid size-11 shrink-0 place-items-center rounded-md bg-brand-soft text-brand-strong"><Icon name={problemIcons[key]} /></span>
                  <div>
                    <h3 className="m-0 text-[1.05rem] font-bold text-ink">{t(`landing.problems.${key}.q`)}</h3>
                    <p className="m-0 mt-2 leading-relaxed text-fg-muted">{t(`landing.problems.${key}.a`)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Fonctions */}
        <section id="features" aria-labelledby="features-title" className="scroll-mt-20 py-16 sm:py-24">
          <div className={container}>
            <SectionHeading id="features-title" title={t("landing.features.title")} intro={t("landing.features.intro")} />
            <ul className="m-0 mt-10 grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((key) => (
                <li key={key} className="rounded-xl border border-line bg-surface p-6 shadow-card">
                  <span className="grid size-11 place-items-center rounded-md bg-brand-gradient text-white shadow-brand"><Icon name={featureIcons[key]} /></span>
                  <h3 className="m-0 mt-5 text-lg font-bold text-ink">{t(`landing.features.${key}.title`)}</h3>
                  <p className="m-0 mt-2 leading-relaxed text-fg-muted">{t(`landing.features.${key}.body`)}</p>
                </li>
              ))}
            </ul>
            <div className="mt-10 rounded-xl border border-line bg-paper p-6 sm:p-8">
              <h3 className="m-0 text-lg font-bold text-ink">{t("landing.features.moreTitle")}</h3>
              <ul className="m-0 mt-4 grid list-none gap-x-8 gap-y-3 p-0 sm:grid-cols-2">
                {more.map((key) => (
                  <li key={key} className="flex items-start gap-2.5 leading-relaxed text-fg"><Icon name="check" className="mt-1 size-4 text-ok" />{t(`landing.features.more.${key}`)}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Secteurs */}
        <section id="sectors" aria-labelledby="sectors-title" className="scroll-mt-20 bg-night-gradient py-16 text-night-fg sm:py-24">
          <div className={container}>
            <div className="max-w-2xl">
              <h2 id="sectors-title" className={cn(sectionTitle, "text-white")}>{t("landing.sectors.title")}</h2>
              <p className="m-0 mt-3 text-base leading-relaxed">{t("landing.sectors.intro")}</p>
            </div>
            <ul className="m-0 mt-10 grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
              {sectors.map((key) => (
                <li key={key} className="rounded-xl border border-night-line bg-night-soft p-6">
                  <span className="grid size-11 place-items-center rounded-md bg-night text-brand-tint"><Icon name={sectorIcons[key]} /></span>
                  <h3 className="m-0 mt-5 text-lg font-bold text-white">{t(`landing.sectors.${key}.title`)}</h3>
                  <p className="m-0 mt-2 leading-relaxed">{t(`landing.sectors.${key}.body`)}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Démarrer */}
        <section id="how" aria-labelledby="how-title" className="scroll-mt-20 py-16 sm:py-24">
          <div className={container}>
            <SectionHeading id="how-title" title={t("landing.how.title")} />
            <ol className="m-0 mt-10 grid list-none gap-4 p-0 lg:grid-cols-3">
              {steps.map((key, index) => (
                <li key={key} className="relative rounded-xl border border-line bg-surface p-6 shadow-card">
                  <span className="grid size-10 place-items-center rounded-full bg-brand-soft font-heading text-base font-extrabold text-brand-strong" aria-hidden="true">{index + 1}</span>
                  <h3 className="m-0 mt-4 text-lg font-bold text-ink">{t(`landing.how.${key}.title`)}</h3>
                  <p className="m-0 mt-2 leading-relaxed text-fg-muted">{t(`landing.how.${key}.body`)}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Limites dites clairement */}
        <section aria-labelledby="honest-title" className="pb-16 sm:pb-24">
          <div className={container}>
            <div className="rounded-2xl border border-line bg-paper p-6 sm:p-10">
              <h2 id="honest-title" className="m-0 font-heading text-xl font-extrabold text-ink sm:text-2xl">{t("landing.honest.title")}</h2>
              <ul className="m-0 mt-6 grid list-none gap-6 p-0 lg:grid-cols-3">
                {honest.map((key) => (
                  <li key={key} className="flex gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-md bg-surface text-fg-muted ring-1 ring-line"><Icon name={honestIcons[key]} /></span>
                    <div>
                      <h3 className="m-0 font-bold text-ink">{t(`landing.honest.${key}.title`)}</h3>
                      <p className="m-0 mt-1.5 text-[0.95rem] leading-relaxed text-fg-muted">{t(`landing.honest.${key}.body`)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Questions fréquentes */}
        <section id="faq" aria-labelledby="faq-title" className="scroll-mt-20 bg-surface py-16 sm:py-24">
          <div className={cn(container, "max-w-3xl")}>
            <h2 id="faq-title" className={sectionTitle}>{t("landing.faq.title")}</h2>
            <div className="mt-8 divide-y divide-line border-y border-line">
              {faq.map((key) => (
                <details key={key} className="group">
                  <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 text-start text-[1.02rem] font-bold text-ink [&::-webkit-details-marker]:hidden">
                    {t(`landing.faq.${key}.q`)}
                    <Icon name="chevronDown" className="text-fg-subtle transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" />
                  </summary>
                  <p className="m-0 pb-5 leading-relaxed text-fg-muted">{t(`landing.faq.${key}.a`)}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Appel final */}
        <section aria-labelledby="cta-title" className="py-16 sm:py-24">
          <div className={container}>
            <div className="rounded-2xl bg-brand-glow px-6 py-12 text-center text-white shadow-raised sm:px-12">
              <h2 id="cta-title" className="m-0 font-heading text-[1.65rem] leading-tight font-extrabold sm:text-[2.1rem]">{t("landing.cta.title")}</h2>
              <p className="m-0 mx-auto mt-3 max-w-xl text-white/90">{t("landing.cta.body")}</p>
              <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                <Link href="/register" className="inline-flex min-h-13 items-center justify-center gap-2 rounded-full bg-white px-6 font-semibold text-brand-strong no-underline hover:bg-brand-soft focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white">
                  {t("landing.cta.primary")}<Icon name="forward" className="size-4.5" />
                </Link>
                <Link href="/login" className="inline-flex min-h-13 items-center justify-center rounded-full border border-white/50 px-6 font-semibold text-white no-underline hover:bg-white/10 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white">{t("landing.cta.secondary")}</Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-surface py-10">
        <div className={cn(container, "flex flex-col gap-4 text-sm text-fg-muted sm:flex-row sm:items-center sm:justify-between")}>
          <div>
            <Wordmark t={t} />
            <p className="m-0 mt-1">{t("landing.footer.tagline")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-x-4">
            <Link href="/privacy" className="inline-flex min-h-11 items-center font-semibold text-fg-muted no-underline hover:text-ink">{t("landing.footer.privacy")}</Link>
            <Link href="/login" className="inline-flex min-h-11 items-center font-semibold text-fg-muted no-underline hover:text-ink">{t("landing.login")}</Link>
            <span>{t("landing.footer.rights", { year })}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

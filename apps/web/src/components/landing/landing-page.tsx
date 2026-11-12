import type { CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import { cn } from "@/components/ui/cn";
import { Icon, type IconName } from "@/components/ui/icon";
import { intlLocale, type Locale } from "@/lib/i18n/config";
import { formatXof } from "@/lib/i18n/format";
import type { Translate } from "@/lib/i18n/translate";
import { DaySection } from "./day-section";
import { displayFont } from "./fonts";
import { LandingHeader } from "./landing-header";
import { LandingMotion } from "./landing-motion";
import { BrandLogo, BrandMascot } from "@/components/brand/brand-logo";
import { VideoEmbed } from "@/components/video/video-embed";
import { readDemoVideo } from "@/lib/landing/demo-video";
import { providerName } from "@/lib/video/source";
import { PricingSection } from "./pricing-section";
import type { ReceiptData } from "./receipt";
import { ReceiptStage } from "./receipt-stage";
import "./landing.css";

/* Nom de la marque dans la page publique : police des titres (Rubik), casse de titre. */
const landingName = "font-display text-[1.2rem] font-bold tracking-[-0.02em] whitespace-nowrap";

/*
 * Page publique officielle (2026-11-10). Direction artistique : docs/design/direction-artistique.md ;
 * état livré, preuves et limites : docs/product/landing-page.md.
 * Composant serveur ; seuls l'en-tête, le ticket 3D et le mouvement sont des composants client isolés.
 * Captures : vraies captures de l'application en mode aperçu (données de démonstration, marquées comme telles).
 */

const container = "mx-auto w-full max-w-[76rem] px-5 sm:px-8";

/* Délai d'entrée d'un élément du hero, lu par landing.css. L'entrée est une animation CSS : elle part
   dès le premier affichage, sans attendre le JavaScript, et ne retarde donc pas le LCP. */
const delay = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

function receiptData(t: Translate, locale: Locale): ReceiptData {
  const n = (value: number) => new Intl.NumberFormat(intlLocale[locale]).format(value);
  const strip = (value: string) => value.replace(/[⁦-⁩]/g, "");
  return {
    dir: locale === "ar" ? "rtl" : "ltr",
    shop: t("landing.receipt.shop"),
    sale: t("landing.receipt.sale"),
    lines: [
      { label: t("landing.receipt.cement"), detail: `2 × ${n(6500)}`, amount: n(13000) },
      { label: t("landing.receipt.cable"), detail: `${locale === "fr" ? "1,5" : "1.5"} m × ${n(900)}`, amount: n(1350) },
    ],
    totals: [
      { label: t("landing.receipt.total"), amount: strip(formatXof("14350", locale)), strong: true },
      { label: t("landing.receipt.wave"), amount: n(12000) },
      { label: t("landing.receipt.credit"), amount: n(2350) },
    ],
    thanks: t("landing.receipt.thanks"),
  };
}

function Hero({ t, locale }: { t: Translate; locale: Locale }) {
  const points = [["devices", "grid"], ["languages", "globe"], ["barcode", "search"]] as const satisfies readonly (readonly [string, IconName])[];
  return (
    <section id="hero" aria-labelledby="hero-title" className="relative isolate overflow-hidden bg-qadr-950 text-white">
      <div aria-hidden="true" className="absolute inset-0 -z-20 bg-[radial-gradient(70%_60%_at_78%_35%,var(--color-qadr-800),transparent_72%),radial-gradient(60%_50%_at_10%_100%,var(--color-qadr-900),transparent_70%)]" />
      <div aria-hidden="true" className="qadr-curves qadr-curves-hero absolute inset-0 -z-10 text-qadr-500" />
      <div className={cn(container, "grid items-center gap-14 pt-32 pb-24 sm:pt-36 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)] lg:gap-8 lg:pt-40 lg:pb-32")}>
        <div className="min-w-0">
          <h1 id="hero-title" className="m-0 font-display text-[clamp(2.8rem,8.4vw,6rem)] leading-[0.94] font-extrabold tracking-[-0.04em] rtl:leading-[1.22] rtl:tracking-normal">
            <span className="block overflow-hidden pb-[0.08em]"><span data-hero-line style={delay(0)} className="block">{t("landing.hero.line1")}</span></span>{" "}
            <span className="block overflow-hidden pb-[0.08em]"><span data-hero-line style={delay(90)} className="block">{t("landing.hero.line2")}</span></span>{" "}
            <span className="block overflow-hidden pb-[0.08em]"><span data-hero-line style={delay(180)} className="block">{t("landing.hero.line3")}</span></span>
          </h1>
          <p data-hero-fade style={delay(380)} className="m-0 mt-7 max-w-[34rem] text-[1.08rem] leading-relaxed text-night-fg sm:text-[1.15rem]">{t("landing.hero.lede")}</p>
          <div data-hero-fade style={delay(460)} className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link href="/register" className="inline-flex min-h-13 items-center justify-center gap-2 rounded-full bg-white px-7 font-semibold text-qadr-900 no-underline shadow-[0_14px_30px_-12px_rgb(0_0_0/0.45)] transition-colors hover:bg-qadr-100 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-qadr-300">
              {t("landing.register")}<Icon name="forward" className="size-4.5 rtl:-scale-x-100" />
            </Link>
            <Link href="/login" className="inline-flex min-h-13 items-center justify-center rounded-full border border-white/35 px-7 font-semibold text-white no-underline transition-colors hover:bg-white/10 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-qadr-300">{t("landing.login")}</Link>
          </div>
          <ul data-hero-fade style={delay(540)} className="m-0 mt-9 flex list-none flex-wrap gap-x-6 gap-y-2.5 p-0 text-[0.92rem] text-qadr-100">
            {points.map(([key, icon]) => <li key={key} className="inline-flex items-center gap-2"><Icon name={icon} className="size-4 text-qadr-300" />{t(`landing.hero.points.${key}`)}</li>)}
          </ul>
        </div>

        {/* Scène : vraie caisse sur téléphone, ticket (3D si possible), mascotte, questions du commerçant. */}
        <div className="relative mx-auto aspect-[1/1.08] w-full max-w-[33rem] min-w-0 sm:aspect-[1.05/1]">
          <div data-hero-device style={delay(150)} className="absolute start-[21%] top-0 w-[43%] -rotate-[5deg] rtl:rotate-[5deg]">
            <div className="rounded-[2.3rem] bg-ink p-[4.5%] shadow-[0_40px_70px_-30px_rgb(0_0_0/0.65)] ring-1 ring-white/10">
              <Image src={`/landing/pos-phone-${locale}.png`} alt={t("landing.hero.phoneAlt")} width={390} height={844} priority fetchPriority="high" sizes="(min-width: 1024px) 230px, 40vw" className="block h-auto w-full rounded-[1.85rem]" />
            </div>
          </div>
          <div data-hero-device style={delay(300)} className="absolute end-[0%] top-[17%] w-[42%] sm:top-[21%] sm:w-[35%] rotate-[7deg] rtl:-rotate-[7deg]">
            <ReceiptStage data={receiptData(t, locale)} label={t("landing.hero.receiptLabel")} />
          </div>
          <div data-hero-device style={delay(450)} className="absolute start-[-4%] bottom-[-3%] w-[40%] sm:start-[-2%]">
            <BrandMascot priority className="h-auto w-full drop-shadow-[0_22px_24px_rgb(0_0_0/0.35)]" />
          </div>
          <p aria-hidden="true" data-bubble style={delay(950)} className="hero-bubble end-[0%] top-[4%]">{t("landing.hero.bubbles.stock")}</p>
          <p aria-hidden="true" data-bubble style={delay(1150)} className="hero-bubble start-[-2%] top-[30%] hidden sm:block">{t("landing.hero.bubbles.credit")}</p>
          <p aria-hidden="true" data-bubble style={delay(1350)} className="hero-bubble end-[2%] bottom-[-5%]">{t("landing.hero.bubbles.cash")}</p>
          <p data-hero-fade style={delay(1100)} className="absolute start-0 -bottom-14 m-0 inline-flex w-full justify-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[0.78rem] font-semibold whitespace-nowrap text-qadr-100"><Icon name="info" className="size-3.5" />{t("landing.hero.demo")}</span>
          </p>
        </div>
      </div>
    </section>
  );
}

function Benefits({ t }: { t: Translate }) {
  const items = ["stock", "credit", "cash"] as const;
  return (
    <section aria-labelledby="benefits-title" className="bg-surface py-20 sm:py-28">
      <div className={container}>
        <h2 id="benefits-title" className="landing-h2 max-w-xl">{t("landing.benefits.title")}</h2>
        <ul className="m-0 mt-12 list-none border-t border-line p-0">
          {items.map((key) => (
            <li key={key} className="grid gap-3 border-b border-line py-8 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:items-baseline md:gap-12 md:py-10">
              <h3 className="m-0 font-display text-[clamp(1.6rem,3.4vw,2.6rem)] leading-[1.1] font-bold tracking-[-0.02em] text-ink rtl:leading-snug rtl:tracking-normal">{t(`landing.benefits.${key}.title`)}</h3>
              <p className="m-0 max-w-lg text-[1.05rem] leading-relaxed text-fg-muted">{t(`landing.benefits.${key}.body`)}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/*
 * Démonstration vidéo. L'adresse vient de QADR_DEMO_VIDEO_URL ; sans elle, la section n'existe pas en production
 * (aucune vidéo fictive) et montre un emplacement vide marqué comme tel hors production. Le lecteur n'est chargé
 * qu'au clic : la section ne coûte qu'une image de couverture, elle-même différée.
 */
function Demo({ t, locale }: { t: Translate; locale: Locale }) {
  const demo = readDemoVideo();
  if (demo.status === "hidden") return null;
  const source = demo.status === "ready" ? demo.source : null;
  const provider = source && source.kind !== "file" ? providerName[source.kind] : null;
  return (
    <section id="demo" aria-labelledby="demo-title" className="scroll-mt-20 bg-canvas py-20 sm:py-28">
      <div className={cn(container, "grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)] lg:items-center")}>
        <div className="min-w-0">
          <h2 id="demo-title" className="landing-h2">{t("landing.video.title")}</h2>
          <p className="m-0 mt-4 max-w-md text-[1.05rem] leading-relaxed text-fg-muted">{t("landing.video.intro")}</p>
          {!source && <p className="m-0 mt-5 flex max-w-md items-start gap-2 rounded-2xl border border-warn-line bg-warn-soft p-3 text-[0.86rem] leading-relaxed text-warn"><Icon name="info" className="mt-0.5 size-4 shrink-0" />{t("landing.video.placeholderNote")}</p>}
        </div>
        <VideoEmbed source={source} title={t("landing.video.videoTitle")} poster={`/landing/dashboard-desktop-${locale}.png`} className="min-w-0"
          labels={{
            play: t("landing.video.play"), placeholder: t("landing.video.placeholder"), error: t("landing.video.error"), retry: t("landing.video.retry"),
            openExternal: t("landing.video.openExternal"), privacy: provider ? t("landing.video.privacy", { provider }) : undefined,
          }} />
      </div>
    </section>
  );
}

function Sectors({ t }: { t: Translate }) {
  const items = [["hardware", "tag"], ["phones", "activity"], ["general", "store"], ["clothing", "grid"]] as const satisfies readonly (readonly [string, IconName])[];
  return (
    <section id="sectors" aria-labelledby="sectors-title" className="scroll-mt-20 bg-canvas py-20 sm:py-28">
      <div className={container}>
        <div className="max-w-2xl">
          <h2 id="sectors-title" className="landing-h2">{t("landing.sectors.title")}</h2>
          <p className="m-0 mt-4 text-[1.05rem] leading-relaxed text-fg-muted">{t("landing.sectors.intro")}</p>
        </div>
        <ul className="m-0 mt-12 grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
          {items.map(([key, icon]) => (
            <li key={key} className="flex min-w-0 flex-col rounded-[1.75rem] border border-line bg-surface p-6">
              <p className="m-0 flex items-center gap-2 text-[0.95rem] font-semibold text-fg-muted"><Icon name={icon} className="size-4.5 text-brand" />{t(`landing.sectors.${key}.title`)}</p>
              <p className="m-0 mt-8 font-display text-[clamp(1.7rem,2.6vw,2.15rem)] leading-[1.05] font-bold tracking-[-0.02em] break-words text-brand rtl:leading-snug rtl:tracking-normal">{t(`landing.sectors.${key}.example`)}</p>
              <p className="m-0 mt-4 leading-relaxed text-fg-muted">{t(`landing.sectors.${key}.body`)}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Features({ t, locale }: { t: Translate; locale: Locale }) {
  const groups = [
    { key: "sell", items: ["landing.features.sell.pos", "landing.features.sell.split", "landing.features.sell.receipt", "landing.features.sell.receiptLang"] },
    { key: "stock", items: ["landing.features.stock.opening", "landing.features.stock.moves", "landing.features.stock.count", "landing.features.stock.import"] },
    { key: "money", items: ["landing.features.money.credit", "landing.features.money.debts", "landing.features.money.till", "landing.features.money.suppliers"] },
    { key: "team", items: ["landing.features.team.roles", "landing.features.team.reports", "landing.features.team.export", "landing.features.team.isolation"] },
  ] as const;
  return (
    <section id="features" aria-labelledby="features-title" className="scroll-mt-20 bg-surface py-20 sm:py-28">
      <div className={container}>
        <div className="max-w-2xl">
          <h2 id="features-title" className="landing-h2">{t("landing.features.title")}</h2>
          <p className="m-0 mt-4 text-[1.05rem] leading-relaxed text-fg-muted">{t("landing.features.intro")}</p>
        </div>
        <div className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {groups.map((group) => (
            <div key={group.key} className="min-w-0 border-t-2 border-qadr-950 pt-5">
              <h3 className="m-0 font-display text-[1.3rem] font-bold text-ink">{t(`landing.features.${group.key}.title`)}</h3>
              <ul className="m-0 mt-4 grid list-none gap-3 p-0">
                {group.items.map((item) => <li key={item} className="flex items-start gap-2.5 leading-relaxed text-fg"><Icon name="check" className="mt-1 size-4 shrink-0 text-brand" />{t(item)}</li>)}
              </ul>
            </div>
          ))}
        </div>
        <figure className="m-0 mt-16">
          <div className="overflow-hidden rounded-[1.4rem] border border-line bg-surface shadow-overlay">
            <div className="flex h-8 items-center gap-1.5 border-b border-line bg-surface-muted px-4" aria-hidden="true">
              <i className="size-2.5 rounded-full bg-line-strong" /><i className="size-2.5 rounded-full bg-line-strong" /><i className="size-2.5 rounded-full bg-line-strong" />
            </div>
            <Image src={`/landing/dashboard-desktop-${locale}.png`} alt={t("landing.features.shotAlt")} width={1280} height={800} sizes="(min-width: 1216px) 1152px, 92vw" className="block h-auto w-full" />
          </div>
          <figcaption className="mt-3 flex justify-end">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-warn-line bg-warn-soft px-3 py-1 text-[0.78rem] font-semibold text-warn"><Icon name="info" className="size-3.5" />{t("landing.hero.demo")}</span>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

/** Témoignages : aucun témoignage réel n'a été recueilli. La liste est vide et la section ne s'affiche pas.
    N'ajouter ici que des propos réels, avec l'accord écrit du commerçant (docs/product/landing-page.md). */
type Testimonial = { quote: string; name: string; business: string; city: string };
const testimonials: Testimonial[] = [];

function Testimonials({ t }: { t: Translate }) {
  if (testimonials.length === 0) return null;
  return (
    <section aria-labelledby="testimonials-title" className="bg-surface pb-20 sm:pb-28">
      <div className={container}>
        <h2 id="testimonials-title" className="landing-h2">{t("landing.testimonials.title")}</h2>
        <ul className="m-0 mt-10 grid list-none gap-5 p-0 md:grid-cols-2">
          {testimonials.map((item) => (
            <li key={item.name} className="rounded-[1.75rem] bg-qadr-50 p-7">
              <blockquote className="m-0 font-display text-[1.3rem] leading-snug text-ink">{item.quote}</blockquote>
              <p className="m-0 mt-4 text-fg-muted"><span className="font-semibold text-ink">{item.name}</span>, {item.business}, {item.city}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Integrations({ t }: { t: Translate }) {
  const columns = [
    { key: "live", dot: "bg-ok", items: ["landing.integrations.live.mobile", "landing.integrations.live.files", "landing.integrations.live.pdf", "landing.integrations.live.print", "landing.integrations.live.install"] },
    { key: "testing", dot: "bg-warn", items: ["landing.integrations.testing.geniuspay", "landing.integrations.testing.thermal", "landing.integrations.testing.push"] },
    { key: "planned", dot: "border-2 border-fg-subtle bg-transparent", items: ["landing.integrations.planned.offline", "landing.integrations.planned.photos", "landing.integrations.planned.operators"] },
  ] as const;
  return (
    <section aria-labelledby="integrations-title" className="bg-canvas py-20 sm:py-28">
      <div className={container}>
        <div className="max-w-2xl">
          <h2 id="integrations-title" className="landing-h2">{t("landing.integrations.title")}</h2>
          <p className="m-0 mt-4 text-[1.05rem] leading-relaxed text-fg-muted">{t("landing.integrations.intro")}</p>
        </div>
        <div className="mt-12 grid gap-5 lg:grid-cols-3">
          {columns.map((column) => (
            <div key={column.key} className="min-w-0 rounded-[1.75rem] border border-line bg-surface p-6 sm:p-7">
              <h3 className="m-0 flex items-center gap-2.5 text-[1.05rem] font-bold text-ink"><span aria-hidden="true" className={cn("size-2.5 rounded-full", column.dot)} />{t(`landing.integrations.${column.key}.title`)}</h3>
              <ul className="m-0 mt-5 grid list-none gap-3.5 p-0">
                {column.items.map((item) => <li key={item} className="border-t border-line pt-3.5 leading-relaxed text-fg">{t(item)}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Faq({ t }: { t: Translate }) {
  const items = ["devices", "barcode", "staff", "offline", "payments", "imports", "data", "languages"] as const;
  return (
    <section id="faq" aria-labelledby="faq-title" className="scroll-mt-20 bg-canvas py-20 sm:py-28">
      <div className={cn(container, "grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16")}>
        <div className="lg:sticky lg:top-28 lg:self-start">
          <h2 id="faq-title" className="landing-h2">{t("landing.faq.title")}</h2>
          <BrandMascot className="mt-10 hidden h-auto w-36 lg:block" />
        </div>
        <div className="min-w-0 divide-y divide-line border-y border-line">
          {items.map((key) => (
            <details key={key} className="group">
              <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 py-4 text-start text-[1.08rem] font-semibold text-ink [&::-webkit-details-marker]:hidden">
                {t(`landing.faq.${key}.q`)}
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface text-brand ring-1 ring-line transition-transform duration-200 group-open:rotate-45 motion-reduce:transition-none" aria-hidden="true"><Icon name="plus" className="size-4" /></span>
              </summary>
              <p className="m-0 max-w-2xl pb-6 leading-relaxed text-fg-muted">{t(`landing.faq.${key}.a`)}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function Closing({ t }: { t: Translate }) {
  const year = new Date().getFullYear();
  const linkClass = "inline-flex min-h-11 items-center text-qadr-100 no-underline hover:text-white";
  return (
    <footer className="relative isolate overflow-hidden bg-qadr-950 text-white">
      <div aria-hidden="true" className="qadr-curves qadr-curves-footer absolute inset-0 -z-10 text-qadr-600" />
      <section aria-labelledby="cta-title" className={cn(container, "grid items-center gap-10 pt-24 pb-20 sm:pt-28 md:grid-cols-[minmax(0,1fr)_auto]")}>
        <div className="min-w-0">
          <h2 id="cta-title" className="m-0 max-w-3xl font-display text-[clamp(2.3rem,5.6vw,4.4rem)] leading-[1] font-extrabold tracking-[-0.035em] rtl:leading-[1.25] rtl:tracking-normal">{t("landing.cta.title")}</h2>
          <p className="m-0 mt-5 max-w-xl text-[1.08rem] leading-relaxed text-night-fg">{t("landing.cta.body")}</p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link href="/register" className="inline-flex min-h-13 items-center justify-center gap-2 rounded-full bg-white px-7 font-semibold text-qadr-900 no-underline transition-colors hover:bg-qadr-100 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-qadr-300">{t("landing.cta.primary")}<Icon name="forward" className="size-4.5 rtl:-scale-x-100" /></Link>
            <Link href="/login" className="inline-flex min-h-13 items-center justify-center rounded-full border border-white/35 px-7 font-semibold text-white no-underline transition-colors hover:bg-white/10 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-qadr-300">{t("landing.cta.secondary")}</Link>
          </div>
        </div>
        <BrandMascot className="mx-auto h-auto w-44 md:w-60" />
      </section>
      <div className={cn(container, "grid gap-10 border-t border-white/15 py-12 text-[0.95rem] sm:grid-cols-3 md:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]")}>
        <div className="min-w-0 sm:col-span-3 md:col-span-1">
          <BrandLogo casing="title" variant="compact" markClassName="h-9 w-auto shrink-0" nameClassName={landingName} />
          <p className="m-0 mt-3 max-w-xs leading-relaxed text-night-fg">{t("landing.footer.tagline")}</p>
        </div>
        <nav aria-labelledby="footer-product"><h2 id="footer-product" className="m-0 text-[0.95rem] font-semibold text-white">{t("landing.footer.product")}</h2>
          <ul className="m-0 mt-2 list-none p-0">{(["features", "day", "pricing", "faq"] as const).map((key) => <li key={key}><a href={`#${key}`} className={linkClass}>{t(`landing.nav.${key}`)}</a></li>)}</ul>
        </nav>
        <nav aria-labelledby="footer-account"><h2 id="footer-account" className="m-0 text-[0.95rem] font-semibold text-white">{t("landing.footer.account")}</h2>
          <ul className="m-0 mt-2 list-none p-0"><li><Link href="/register" className={linkClass}>{t("landing.register")}</Link></li><li><Link href="/login" className={linkClass}>{t("landing.login")}</Link></li></ul>
        </nav>
        <nav aria-labelledby="footer-info"><h2 id="footer-info" className="m-0 text-[0.95rem] font-semibold text-white">{t("landing.footer.info")}</h2>
          <ul className="m-0 mt-2 list-none p-0"><li><Link href="/privacy" className={linkClass}>{t("landing.footer.privacy")}</Link></li></ul>
        </nav>
      </div>
      <div className={cn(container, "flex flex-col gap-1 border-t border-white/15 py-6 text-[0.85rem] text-night-fg sm:flex-row sm:justify-between")}>
        <p className="m-0">{t("landing.footer.editor")}</p>
        <p className="m-0">{t("landing.footer.rights", { year })}</p>
      </div>
    </footer>
  );
}

export function LandingPage({ t, locale }: { t: Translate; locale: Locale }) {
  return (
    <div data-landing className={cn(displayFont.variable, "min-h-dvh bg-canvas text-fg")}>
      <a href="#contenu" className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-surface focus:px-4 focus:py-2 focus:font-semibold focus:text-ink focus:shadow-raised">{t("landing.skip")}</a>
      <LandingHeader />
      <main id="contenu" tabIndex={-1} className="outline-none">
        <Hero t={t} locale={locale} />
        <Benefits t={t} />
        <Demo t={t} locale={locale} />
        <Sectors t={t} />
        <DaySection t={t} locale={locale} container={container} />
        <Features t={t} locale={locale} />
        <Testimonials t={t} />
        <Integrations t={t} />
        <PricingSection t={t} locale={locale} container={container} />
        <Faq t={t} />
      </main>
      <Closing t={t} />
      <LandingMotion />
    </div>
  );
}

import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { Icon, type IconName } from "@/components/ui/icon";
import { intlLocale, type Locale } from "@/lib/i18n/config";
import { formatXof } from "@/lib/i18n/format";
import type { LandingMessages } from "@/lib/i18n/messages/landing";
import type { Translate } from "@/lib/i18n/translate";

/*
 * « Une journée à la boutique » : la seule séquence numérotée de la page, parce que c'est une vraie suite
 * d'heures. Chaque moment montre un fragment d'écran construit en HTML avec des données de démonstration
 * (marquées « Exemple »), cohérentes d'un moment à l'autre et avec le catalogue de démonstration : 2 sacs à 6 500 et 1,5 m de câble
 * à 900 font 14 350 F CFA, dont 12 000 par Wave et 2 350 à crédit.
 */
const moments = [
  { key: "receive", icon: "truck" },
  { key: "stock", icon: "box" },
  { key: "sale", icon: "cart" },
  { key: "payment", icon: "wallet" },
  { key: "expense", icon: "receipt" },
  { key: "close", icon: "chart" },
] as const satisfies readonly { key: string; icon: IconName }[];

type MomentKey = (typeof moments)[number]["key"];

function Fragment({ t, children }: { t: Translate; children: ReactNode }) {
  return (
    <div className="relative mt-5 max-w-md rounded-[1.4rem] border border-line bg-surface p-4 shadow-card sm:p-5">
      <span className="absolute end-4 top-4 rounded-full bg-warn-soft px-2 py-0.5 text-[0.7rem] font-semibold text-warn">{t("landing.day.example")}</span>
      {children}
    </div>
  );
}

function Row({ label, detail, value, className }: { label: string; detail?: string; value: string; className?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 py-2", className)}>
      <span className="min-w-0">
        <span className="block font-semibold text-ink">{label}</span>
        {detail && <span dir="ltr" className="block text-[0.82rem] text-fg-subtle">{detail}</span>}
      </span>
      <span dir="ltr" className="shrink-0 font-semibold text-ink tabular-nums">{value}</span>
    </div>
  );
}

function MomentUi({ id, t, locale }: { id: MomentKey; t: Translate; locale: Locale }) {
  const n = (value: number) => new Intl.NumberFormat(intlLocale[locale]).format(value);
  const ui = (key: keyof LandingMessages["day"]["ui"]) => t(`landing.day.ui.${key}`);
  const cement = t("landing.receipt.cement");
  const cable = t("landing.receipt.cable");
  switch (id) {
    case "receive":
      return (
        <Fragment t={t}>
          <p className="m-0 flex items-center gap-2 pe-16 text-[0.85rem] font-semibold text-fg-muted"><Icon name="truck" className="size-4" />{ui("supplier")}</p>
          <div className="mt-2 divide-y divide-line">
            <Row label={cement} value={`+${n(40)} ${ui("bags")}`} />
            <Row label={cable} value={`+${n(100)} ${ui("meters")}`} />
          </div>
          <p className="m-0 mt-3 inline-flex items-center gap-1.5 rounded-full bg-ok-soft px-3 py-1 text-[0.82rem] font-semibold text-ok"><Icon name="check" className="size-3.5" />{ui("received")}</p>
        </Fragment>
      );
    case "stock":
      return (
        <Fragment t={t}>
          <p className="m-0 pe-16 font-semibold text-ink">{cement}</p>
          <p className="m-0 mt-1 flex items-baseline gap-2"><span className="font-display text-[3.2rem] leading-none font-bold text-brand tabular-nums">{n(52)}</span><span className="text-fg-muted">{ui("bags")}, {ui("onHand").toLocaleLowerCase(intlLocale[locale])}</span></p>
          <div className="mt-3 divide-y divide-line border-t border-line text-[0.9rem]">
            <Row label={ui("yesterday")} value={n(12)} />
            <Row label={ui("reception")} value={`+${n(40)}`} className="text-ok" />
          </div>
        </Fragment>
      );
    case "sale":
      return (
        <Fragment t={t}>
          <p className="m-0 pe-16 text-[0.85rem] font-semibold text-fg-muted">{ui("cart")}</p>
          <div className="mt-1 divide-y divide-line">
            <Row label={cement} detail={`2 × ${n(6500)}`} value={n(13000)} />
            <Row label={cable} detail={`${locale === "fr" ? "1,5" : "1.5"} ${ui("meters")} × ${n(900)}`} value={n(1350)} />
          </div>
          <p className="m-0 mt-2 flex items-baseline justify-between rounded-xl bg-brand px-3.5 py-2.5 text-white"><span className="font-semibold">{ui("total")}</span><span className="font-display text-xl font-bold">{formatXof("14350", locale)}</span></p>
        </Fragment>
      );
    case "payment":
      return (
        <Fragment t={t}>
          <div className="me-16 flex h-3 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
            <span className="h-full w-[77%] bg-brand" /><span className="h-full flex-1 bg-[repeating-linear-gradient(45deg,var(--color-warn-line)_0_6px,var(--color-warn-soft)_6px_12px)]" />
          </div>
          <div className="mt-3 divide-y divide-line">
            <Row label={ui("wave")} value={formatXof("12000", locale)} />
            <Row label={ui("credit")} value={formatXof("2350", locale)} />
          </div>
          <p className="m-0 mt-2 flex items-center justify-between gap-3 rounded-xl bg-surface-muted px-3.5 py-2.5 text-[0.9rem]">
            <span><span className="block font-semibold text-ink">{ui("customer")}</span><span className="text-fg-muted">{ui("balance")}</span></span>
            <span className="font-semibold text-warn">{formatXof("2350", locale)}</span>
          </p>
        </Fragment>
      );
    case "expense":
      return (
        <Fragment t={t}>
          <span className="inline-flex rounded-full bg-surface-muted px-2.5 py-0.5 text-[0.78rem] font-semibold text-fg-muted">{ui("category")}</span>
          <p className="m-0 mt-2 pe-2 font-semibold text-ink">{ui("expense")}</p>
          <p className="m-0 mt-1 font-display text-[2rem] leading-tight font-bold text-ink"><bdi>−{formatXof("3000", locale)}</bdi></p>
          <p className="m-0 mt-1 flex items-center gap-1.5 text-[0.88rem] text-fg-muted"><Icon name="wallet" className="size-4" />{ui("cashOut")}</p>
        </Fragment>
      );
    case "close":
      return (
        <Fragment t={t}>
          <div className="me-14 divide-y divide-line">
            <Row label={ui("expected")} value={formatXof("84500", locale)} />
            <Row label={ui("counted")} value={formatXof("84000", locale)} />
          </div>
          <p className="m-0 mt-2 flex items-center justify-between rounded-xl border border-warn-line bg-warn-soft px-3.5 py-2.5 text-warn">
            <span className="font-semibold">{ui("difference")}</span><span className="font-display text-xl font-bold"><bdi>−{formatXof("500", locale)}</bdi></span>
          </p>
        </Fragment>
      );
  }
}

function Clock() {
  return (
    <svg viewBox="0 0 120 120" className="size-40 xl:size-48" aria-hidden="true">
      <circle cx="60" cy="60" r="56" className="fill-surface stroke-qadr-200" strokeWidth="2" />
      {Array.from({ length: 12 }, (_, index) => (
        <line key={index} x1="60" y1="10" x2="60" y2={index % 3 === 0 ? 19 : 15} transform={`rotate(${index * 30} 60 60)`} className="stroke-qadr-300" strokeWidth={index % 3 === 0 ? 3 : 2} strokeLinecap="round" />
      ))}
      <g data-clock-hour style={{ transform: "rotate(var(--hour, 225deg))", transformOrigin: "60px 60px" }}>
        <line x1="60" y1="60" x2="60" y2="33" className="stroke-qadr-950" strokeWidth="5" strokeLinecap="round" />
      </g>
      <g data-clock-minute style={{ transform: "rotate(var(--minute, 180deg))", transformOrigin: "60px 60px" }}>
        <line x1="60" y1="60" x2="60" y2="20" className="stroke-brand" strokeWidth="3" strokeLinecap="round" />
      </g>
      <circle cx="60" cy="60" r="4.5" className="fill-qadr-950" />
    </svg>
  );
}

export function DaySection({ t, locale, container }: { t: Translate; locale: Locale; container: string }) {
  return (
    <section id="day" aria-labelledby="day-title" className="scroll-mt-20 bg-qadr-50 py-20 sm:py-28">
      <div className={cn(container, "grid gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16")}>
        <div className="lg:sticky lg:top-28 lg:self-start">
          <h2 id="day-title" className="landing-h2">{t("landing.day.title")}</h2>
          <p className="m-0 mt-4 max-w-md text-[1.05rem] leading-relaxed text-fg-muted">{t("landing.day.intro")}</p>
          <div className="mt-10 hidden lg:block"><Clock /></div>
        </div>
        <ol data-day-track className="relative m-0 list-none p-0">
          <span aria-hidden="true" className="absolute start-[1.15rem] top-2 bottom-2 w-0.5 rounded-full bg-qadr-200" />
          <span aria-hidden="true" data-day-progress className="absolute start-[1.15rem] top-2 bottom-2 w-0.5 origin-top rounded-full bg-brand" />
          {moments.map(({ key, icon }) => (
            <li key={key} data-moment className="day-moment relative ps-14 pb-14 last:pb-0">
              <span className="absolute start-0 top-0 grid size-10 place-items-center rounded-full border-2 border-qadr-200 bg-surface text-brand"><Icon name={icon} className="size-[1.1rem]" /></span>
              <p className="m-0 flex flex-wrap items-baseline gap-x-3">
                <time dir="ltr" className="font-display text-[1.6rem] leading-none font-bold text-qadr-950 tabular-nums">{t(`landing.day.${key}.time`)}</time>
                <span className="text-[0.95rem] font-semibold text-brand">{t(`landing.day.${key}.label`)}</span>
              </p>
              <h3 className="m-0 mt-3 font-display text-[1.45rem] leading-snug font-semibold text-ink sm:text-[1.65rem] rtl:leading-relaxed">{t(`landing.day.${key}.question`)}</h3>
              <p className="m-0 mt-2 max-w-lg leading-relaxed text-fg-muted">{t(`landing.day.${key}.body`)}</p>
              <MomentUi id={key} t={t} locale={locale} />
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

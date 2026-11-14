import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { Icon, type IconName } from "@/components/ui/icon";
import type { LandingMessages } from "@/lib/i18n/messages/landing";
import type { Translate } from "@/lib/i18n/translate";

/*
 * « Une journée à la boutique » : la seule séquence numérotée de la page, parce que c'est une vraie suite
 * d'heures. Chaque moment montre un fragment d'écran schématique : les libellés sont ceux de l'application, les
 * valeurs sont figurées par des traits. Aucun montant, aucune quantité, aucun nom de client ou de fournisseur
 * inventé (mission CTO du 2026-11-14, `landing-content.test.ts`).
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

function Fragment({ children }: { children: ReactNode }) {
  return <div className="mt-5 max-w-md rounded-[1.4rem] border border-line bg-surface p-4 shadow-card sm:p-5">{children}</div>;
}

/** Valeur figurée : un trait, jamais un chiffre. */
function Bar({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("block h-2.5 shrink-0 rounded-full bg-qadr-100", className)} />;
}

function Field({ label, bar = "w-20", className }: { label: string; bar?: string; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 py-2", className)}>
      <span className="min-w-0 font-semibold text-ink">{label}</span>
      <Bar className={bar} />
    </div>
  );
}

function Status({ children, tone = "ok" }: { children: ReactNode; tone?: "ok" | "warn" }) {
  return (
    <p className={cn("m-0 mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[0.82rem] font-semibold", tone === "ok" ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn")}>
      <Icon name="check" className="size-3.5" />{children}
    </p>
  );
}

function MomentUi({ id, t }: { id: MomentKey; t: Translate }) {
  const ui = (key: keyof LandingMessages["day"]["ui"]) => t(`landing.day.ui.${key}`);
  switch (id) {
    case "receive":
      return (
        <Fragment>
          <p className="m-0 flex items-center gap-2 text-[0.85rem] font-semibold text-fg-muted"><Icon name="truck" className="size-4" />{ui("supplier")}<Bar className="w-24" /></p>
          <div className="mt-2 divide-y divide-line">
            <Field label={ui("item")} bar="w-28" />
            <Field label={ui("quantity")} bar="w-14" />
            <Field label={ui("cost")} bar="w-20" />
          </div>
          <Status>{ui("received")}</Status>
        </Fragment>
      );
    case "stock":
      return (
        <Fragment>
          <p className="m-0 flex items-center gap-2 font-semibold text-ink"><Icon name="box" className="size-4 text-brand" />{ui("item")}<Bar className="w-28" /></p>
          <p className="m-0 mt-3 flex items-center gap-3"><Bar className="h-9 w-20 rounded-xl bg-qadr-200" /><span className="text-fg-muted">{ui("onHand")}</span></p>
          <div className="mt-3 border-t border-line text-[0.9rem]"><Field label={ui("lastMove")} bar="w-24" /></div>
        </Fragment>
      );
    case "sale":
      return (
        <Fragment>
          <p className="m-0 text-[0.85rem] font-semibold text-fg-muted">{ui("cart")}</p>
          <div className="mt-1 divide-y divide-line">
            <Field label={ui("item")} bar="w-28" />
            <Field label={ui("lineTotal")} bar="w-16" />
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-brand px-3.5 py-2.5 text-white">
            <span><span className="block font-semibold">{ui("total")}</span><span className="block text-[0.8rem] text-qadr-100">{ui("serverTotal")}</span></span>
            <Bar className="w-20 bg-white/35" />
          </div>
        </Fragment>
      );
    case "payment":
      return (
        <Fragment>
          <div className="flex h-3 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
            <span className="h-full w-[60%] bg-brand" /><span className="h-full flex-1 bg-[repeating-linear-gradient(45deg,var(--color-warn-line)_0_6px,var(--color-warn-soft)_6px_12px)]" />
          </div>
          <div className="mt-3 divide-y divide-line">
            <Field label={ui("wave")} />
            <Field label={ui("credit")} bar="w-14" />
          </div>
          <p className="m-0 mt-2 flex items-center justify-between gap-3 rounded-xl bg-surface-muted px-3.5 py-2.5 text-[0.9rem]">
            <span><span className="block font-semibold text-ink">{ui("customer")}</span><span className="text-fg-muted">{ui("balance")}</span></span>
            <Bar className="w-14 bg-warn-line" />
          </p>
        </Fragment>
      );
    case "expense":
      return (
        <Fragment>
          <span className="inline-flex rounded-full bg-surface-muted px-2.5 py-0.5 text-[0.78rem] font-semibold text-fg-muted">{ui("category")}</span>
          <div className="mt-2 divide-y divide-line"><Field label={ui("amount")} bar="w-24" /></div>
          <p className="m-0 mt-1 flex items-center gap-1.5 text-[0.88rem] text-fg-muted"><Icon name="wallet" className="size-4" />{ui("cashOut")}</p>
        </Fragment>
      );
    case "close":
      return (
        <Fragment>
          <div className="divide-y divide-line">
            <Field label={ui("expected")} bar="w-24" />
            <Field label={ui("counted")} bar="w-24" />
          </div>
          <p className="m-0 mt-2 flex items-center justify-between gap-3 rounded-xl border border-warn-line bg-warn-soft px-3.5 py-2.5 text-warn">
            <span className="font-semibold">{ui("difference")}</span><Bar className="w-12 bg-warn-line" />
          </p>
          <Status>{ui("closed")}</Status>
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

export function DaySection({ t, container }: { t: Translate; container: string }) {
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
              <MomentUi id={key} t={t} />
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

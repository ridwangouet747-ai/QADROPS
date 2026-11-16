import { cn } from "@/components/ui/cn";
import { Icon } from "@/components/ui/icon";
import type { Locale } from "@/lib/i18n/config";
import type { Translate } from "@/lib/i18n/translate";
import { interfaceScreen, type InterfaceScreenKey } from "@/lib/landing/interface-screens";

/*
 * « Les vrais écrans de Qadr Ops » (mission du 2026-11-16) : captures de l'application réelle, prises sur l'aperçu
 * local (base en mémoire) dans un commerce de test. La section le dit en clair et chaque image le répète dans son texte
 * alternatif : rien n'y est présenté comme le résultat d'un client. Images et procédure : lib/landing/interface-screens.ts.
 * Composant serveur, sans JavaScript ; images chargées à la demande (la section est loin sous la ligne de flottaison).
 */

function Screen({ t, locale, screen, className, frame }: { t: Translate; locale: Locale; screen: InterfaceScreenKey; className?: string; frame: "window" | "phone" | "paper" }) {
  const image = interfaceScreen(locale, screen);
  const title = t(`landing.screens.items.${screen}.title`);
  return (
    <figure className={cn("m-0 flex min-w-0 flex-col", className)}>
      <div className={cn(
        "overflow-hidden",
        frame === "window" && "rounded-[1.1rem] border border-line bg-surface shadow-[0_24px_50px_-34px_rgb(3_16_142/0.45)]",
        frame === "phone" && "mx-auto w-full max-w-[17rem] rounded-[2.2rem] bg-ink p-[3.5%] shadow-[0_30px_60px_-34px_rgb(3_16_142/0.55)]",
        frame === "paper" && "mx-auto w-full max-w-[16rem] rounded-md bg-surface shadow-[0_18px_40px_-28px_rgb(3_16_142/0.5)]",
      )}>
        {frame === "window" && <div aria-hidden="true" className="flex gap-1.5 border-b border-line bg-canvas px-4 py-2.5"><span className="size-2.5 rounded-full bg-line" /><span className="size-2.5 rounded-full bg-line" /><span className="size-2.5 rounded-full bg-line" /></div>}
        {/* Images déjà redimensionnées et compressées (deux largeurs) : <img> natif avec srcset, sans optimiseur d'images. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image.src} srcSet={image.srcSet} sizes={image.sizes} width={image.width} height={image.height} loading="lazy" decoding="async"
          alt={t("landing.screens.alt", { screen: title })} className={cn("block h-auto w-full", frame === "phone" && "rounded-[1.85rem]")} />
      </div>
      <figcaption className={cn("mt-4", frame !== "window" && "text-center")}>
        <h3 className="m-0 font-display text-[1.15rem] font-bold text-ink">{title}</h3>
        <p className="m-0 mt-1 leading-relaxed text-fg-muted">{t(`landing.screens.items.${screen}.body`)}</p>
      </figcaption>
    </figure>
  );
}

export function InterfaceScreens({ t, locale, container }: { t: Translate; locale: Locale; container: string }) {
  return (
    <section id="screens" aria-labelledby="screens-title" className="scroll-mt-20 bg-canvas py-20 sm:py-28">
      <div className={container}>
        <div className="max-w-2xl">
          <h2 id="screens-title" className="landing-h2">{t("landing.screens.title")}</h2>
          <p className="m-0 mt-4 text-[1.05rem] leading-relaxed text-fg-muted">{t("landing.screens.intro")}</p>
          <p className="m-0 mt-5 inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-[0.85rem] font-semibold text-fg-muted">
            <Icon name="info" className="size-3.5 text-brand" />{t("landing.screens.badge")}
          </p>
        </div>
        <div className="mt-12 grid gap-x-8 gap-y-12 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)] lg:items-start">
          <Screen t={t} locale={locale} screen="dashboard" frame="window" />
          <Screen t={t} locale={locale} screen="mobile" frame="phone" />
        </div>
        <div className="mt-14 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {(["pos", "products", "stock", "customers", "reports"] as const).map((screen) => <Screen key={screen} t={t} locale={locale} screen={screen} frame="window" />)}
          <Screen t={t} locale={locale} screen="receipt" frame="paper" />
        </div>
      </div>
    </section>
  );
}

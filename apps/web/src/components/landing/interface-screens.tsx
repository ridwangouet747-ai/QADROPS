import type { CSSProperties } from "react";
import { cn } from "@/components/ui/cn";
import { Icon } from "@/components/ui/icon";
import type { Locale } from "@/lib/i18n/config";
import type { Translate } from "@/lib/i18n/translate";
import { interfaceScreen, type InterfaceScreenKey } from "@/lib/landing/interface-screens";

/*
 * « Les vrais écrans de Qadr Ops » (mission du 2026-11-16) : captures de l'application réelle, prises sur l'aperçu
 * local (base en mémoire) dans un commerce de test. La section le dit en clair et chaque image le répète dans son texte
 * alternatif : rien n'y est présenté comme le résultat d'un client. Images et procédure : lib/landing/interface-screens.ts.
 *
 * Mise en scène (2026-11-17) : les six écrans de bureau suivent le parcours du commerçant (vue d'ensemble → produits →
 * stock → caisse → clients → rapports) en pages superposées à partir de 1024 px (landing.css : `sticky`, chaque page
 * recouvre la précédente). La colonne de gauche reste visible et indique la page lue. En dessous de 1024 px : simple
 * liste, sans effet. Téléphone et ticket ferment la section. Composant serveur ; profondeur ajoutée par landing-motion.tsx.
 */

const deck = ["dashboard", "products", "stock", "pos", "customers", "reports"] as const satisfies readonly InterfaceScreenKey[];

function ScreenImage({ t, locale, screen, className }: { t: Translate; locale: Locale; screen: InterfaceScreenKey; className?: string }) {
  const image = interfaceScreen(locale, screen);
  return (
    // Images déjà redimensionnées et compressées (deux largeurs) : <img> natif avec srcset, sans optimiseur d'images.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={image.src} srcSet={image.srcSet} sizes={image.sizes} width={image.width} height={image.height} loading="lazy" decoding="async"
      alt={t("landing.screens.alt", { screen: t(`landing.screens.items.${screen}.title`) })} className={cn("block h-auto w-full", className)} />
  );
}

function DeckPage({ t, locale, screen, index }: { t: Translate; locale: Locale; screen: InterfaceScreenKey; index: number }) {
  return (
    <li data-deck-card style={{ "--i": index } as CSSProperties} className="min-w-0">
      <figure data-deck-page className="relative m-0 overflow-hidden rounded-[1.25rem] border border-line bg-surface shadow-[0_30px_70px_-40px_rgb(3_16_142/0.55)]">
        <div aria-hidden="true" className="flex items-center gap-1.5 border-b border-line bg-canvas px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-line" /><span className="size-2.5 rounded-full bg-line" /><span className="size-2.5 rounded-full bg-line" />
          <span className="ms-auto font-display text-[0.8rem] font-bold text-fg-muted tabular-nums">{String(index + 1).padStart(2, "0")}</span>
        </div>
        <ScreenImage t={t} locale={locale} screen={screen} />
        <figcaption className="border-t border-line px-5 py-4">
          <h3 className="m-0 font-display text-[1.15rem] font-bold text-ink">{t(`landing.screens.items.${screen}.title`)}</h3>
          <p className="m-0 mt-1 leading-relaxed text-fg-muted">{t(`landing.screens.items.${screen}.body`)}</p>
        </figcaption>
        {/* Voile de la page recouverte (opacité animée par landing-motion.tsx, nulle sinon). */}
        <span aria-hidden="true" data-deck-shade className="pointer-events-none absolute inset-0 bg-qadr-950 opacity-0" />
      </figure>
    </li>
  );
}

function Companion({ t, locale, screen, frame }: { t: Translate; locale: Locale; screen: "mobile" | "receipt"; frame: "phone" | "paper" }) {
  return (
    // Le visuel occupe la hauteur restante et y est centré : téléphone et ticket côte à côte gardent leurs légendes
    // sur la même ligne.
    <figure className="m-0 flex min-w-0 flex-col">
      <div className="flex flex-1 items-center">
        <div className={cn(
          "mx-auto w-full overflow-hidden",
          frame === "phone" && "max-w-[17rem] rounded-[2.2rem] bg-ink p-[3.5%] shadow-[0_30px_60px_-34px_rgb(3_16_142/0.55)]",
          frame === "paper" && "max-w-[16rem] rounded-md bg-surface shadow-[0_18px_40px_-28px_rgb(3_16_142/0.5)]",
        )}>
          <ScreenImage t={t} locale={locale} screen={screen} className={frame === "phone" ? "rounded-[1.85rem]" : undefined} />
        </div>
      </div>
      <figcaption className="mt-4 text-center">
        <h3 className="m-0 font-display text-[1.15rem] font-bold text-ink">{t(`landing.screens.items.${screen}.title`)}</h3>
        <p className="m-0 mx-auto mt-1 max-w-xs leading-relaxed text-fg-muted">{t(`landing.screens.items.${screen}.body`)}</p>
      </figcaption>
    </figure>
  );
}

export function InterfaceScreens({ t, locale, container }: { t: Translate; locale: Locale; container: string }) {
  return (
    <section id="screens" aria-labelledby="screens-title" className="scroll-mt-20 py-20 sm:py-28">
      <div className={container}>
        <div className="grid gap-12 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.55fr)] lg:gap-14">
          <div className="min-w-0 lg:sticky lg:top-28 lg:self-start">
            <h2 id="screens-title" className="landing-h2">{t("landing.screens.title")}</h2>
            <p className="m-0 mt-4 max-w-md text-[1.05rem] leading-relaxed text-fg-muted">{t("landing.screens.intro")}</p>
            <p className="m-0 mt-5 inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-[0.85rem] font-semibold text-fg-muted">
              <Icon name="info" className="size-3.5 text-brand" />{t("landing.screens.badge")}
            </p>
            {/* Repère de lecture (décoratif : les titres sont déjà sous chaque écran). */}
            <ol aria-hidden="true" className="screens-steps m-0 mt-10 hidden list-none gap-1 border-s-2 border-qadr-200 p-0 lg:grid">
              {deck.map((screen, index) => (
                <li key={screen} data-deck-step className="-ms-0.5 flex items-baseline gap-3 border-s-2 border-transparent py-1.5 ps-4 text-fg-muted [&.is-active]:border-brand [&.is-active]:text-ink">
                  <span className="font-display text-[0.85rem] font-bold text-brand tabular-nums">{String(index + 1).padStart(2, "0")}</span>
                  <span className="font-semibold">{t(`landing.screens.items.${screen}.title`)}</span>
                </li>
              ))}
            </ol>
          </div>
          <ol className="screens-deck m-0 grid list-none gap-10 p-0 lg:block">
            {deck.map((screen, index) => <DeckPage key={screen} t={t} locale={locale} screen={screen} index={index} />)}
          </ol>
        </div>
        <div className="mt-16 grid gap-12 sm:grid-cols-2 lg:mx-auto lg:mt-24 lg:max-w-3xl">
          <Companion t={t} locale={locale} screen="mobile" frame="phone" />
          <Companion t={t} locale={locale} screen="receipt" frame="paper" />
        </div>
      </div>
    </section>
  );
}

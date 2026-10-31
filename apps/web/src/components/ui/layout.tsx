import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

/** En-tête d'écran : titre fort, phrase courte, action principale à droite (à gauche en arabe). */
export function PageHeader({ kicker, title, children, actions, leading }: { kicker?: string; title: string; children?: ReactNode; actions?: ReactNode; leading?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-center justify-between gap-4 sm:mb-6">
      <div className="flex min-w-0 items-center gap-3">
        {leading}
        <div className="min-w-0 max-w-2xl">
          {kicker && <p className="m-0 mb-1 text-xs font-bold tracking-[0.08em] text-brand">{kicker}</p>}
          <h1 className="m-0 font-heading text-[1.9rem] leading-[1.1] font-bold tracking-[-0.035em] text-ink sm:text-[2.4rem]">{title}</h1>
          {children && <p className="m-0 mt-1.5 text-[0.95rem] text-fg-muted">{children}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export type CardTone = "surface" | "night" | "brand";
const cardTones: Record<CardTone, string> = {
  surface: "border-line bg-surface text-fg shadow-card",
  night: "border-night-line bg-night-gradient text-white shadow-raised",
  brand: "border-transparent bg-brand-glow text-white shadow-raised",
};

/** Carte arrondie : blanche par défaut, bleu nuit pour les panneaux forts, dégradé violet pour le détail sélectionné. */
export function Card({ className, tone = "surface", ...props }: HTMLAttributes<HTMLElement> & { tone?: CardTone }) {
  return <section className={cn("rounded-xl border p-4 sm:p-5", cardTones[tone], className)} {...props} />;
}

export function CardTitle({ eyebrow, title, id, aside, inverse = false }: { eyebrow?: string; title: ReactNode; id?: string; aside?: ReactNode; inverse?: boolean }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <p className={cn("m-0 text-xs font-semibold", inverse ? "text-white/70" : "text-fg-subtle")}>{eyebrow}</p>}
        <h2 id={id} className={cn("m-0 text-[1.05rem] font-bold tracking-[-0.01em]", inverse ? "text-white" : "text-ink")}>{title}</h2>
      </div>
      {aside}
    </div>
  );
}

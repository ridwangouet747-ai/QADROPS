import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

/** En-tête d'écran : sur-titre court, titre Calistoga, phrase d'explication. */
export function PageHeader({ kicker, title, children, actions }: { kicker?: string; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
      <div className="min-w-0 max-w-2xl">
        {kicker && <p className="m-0 mb-1 text-xs font-bold tracking-[0.08em] text-cta-strong">{kicker}</p>}
        <h1 className="m-0 font-heading text-[1.75rem] leading-tight font-normal text-ink sm:text-[2rem]">{title}</h1>
        {children && <p className="m-0 mt-1.5 text-[0.95rem] text-fg-muted">{children}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={cn("rounded-lg border border-line bg-surface p-4 shadow-card sm:p-5", className)} {...props} />;
}

export function CardTitle({ eyebrow, title, id, aside }: { eyebrow?: string; title: ReactNode; id?: string; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <p className="m-0 text-xs font-bold tracking-[0.08em] text-fg-subtle">{eyebrow}</p>}
        <h2 id={id} className="m-0 text-lg font-bold text-ink">{title}</h2>
      </div>
      {aside}
    </div>
  );
}

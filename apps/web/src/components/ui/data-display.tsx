import type { ReactNode } from "react";
import { cn } from "./cn";
import { Icon, type IconName } from "./icon";

const iconTones = {
  brand: "bg-brand-soft text-brand",
  danger: "bg-danger-soft text-danger",
  ok: "bg-ok-soft text-ok",
  info: "bg-info-soft text-info",
  warn: "bg-warn-soft text-warn",
} as const;

/**
 * Carte d'indicateur : libellé, pastille d'icône, montant très lisible, précision en dessous.
 * `children` accueille un mini-graphique facultatif placé en bas de carte.
 */
export function StatCard({ label, value, hint, icon, iconTone = "brand", children, className }: {
  label: string; value: ReactNode; hint?: ReactNode; icon?: IconName; iconTone?: keyof typeof iconTones; children?: ReactNode; className?: string;
}) {
  return (
    <article className={cn("flex min-w-0 flex-col rounded-xl border border-line bg-surface p-4 shadow-card sm:p-5", className)}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="m-0 text-[0.86rem] font-semibold text-fg">{label}</h3>
        {icon && <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", iconTones[iconTone])}><Icon name={icon} className="size-4" /></span>}
      </div>
      <p className="numeric m-0 mt-2 text-start text-[1.6rem] leading-tight font-bold tracking-[-0.03em] text-ink sm:text-[1.85rem] rtl:text-end">{value}</p>
      {hint && <p className="m-0 mt-1 text-[0.8rem] text-fg-subtle">{hint}</p>}
      {children && <div className="mt-auto pt-4">{children}</div>}
    </article>
  );
}

/**
 * Histogramme léger en CSS (aucune bibliothèque) : barres lavande, la dernière en violet.
 * Les valeurs sont des nombres d'affichage ; l'étiquette accessible porte le détail.
 */
export function BarChart({ data, label }: { data: { key: string; label: string; value: number; title: string }[]; label: string }) {
  const max = Math.max(1, ...data.map((entry) => entry.value));
  return (
    <figure className="m-0" aria-label={label}>
      <div className="flex h-28 items-end gap-1.5 sm:gap-2" dir="ltr">
        {data.map((entry, index) => (
          <div key={entry.key} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={entry.title}>
            <div
              className={cn("w-full rounded-t-[6px] rounded-b-[3px]", index === data.length - 1 ? "bg-brand-gradient" : "bg-brand-tint")}
              style={{ height: `${Math.max(4, (entry.value / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <figcaption className="mt-1.5 flex gap-1.5 text-[0.7rem] text-fg-subtle sm:gap-2" dir="ltr">
        {data.map((entry) => <span key={entry.key} className="min-w-0 flex-1 truncate text-center">{entry.label}</span>)}
      </figcaption>
      <ul className="sr-only">{data.map((entry) => <li key={entry.key}>{entry.title}</li>)}</ul>
    </figure>
  );
}

/** Bouton rond à icône, toujours accompagné d'un libellé accessible. */
export function IconButton({ icon, label, onClick, href, className }: { icon: IconName; label: string; onClick?: () => void; href?: string; className?: string }) {
  const classes = cn("grid size-11 shrink-0 cursor-pointer place-items-center rounded-full border border-line bg-surface text-ink transition-colors hover:border-brand-tint hover:text-brand", className);
  if (href) return <a href={href} aria-label={label} title={label} className={classes}><Icon name={icon} /></a>;
  return <button type="button" onClick={onClick} aria-label={label} title={label} className={classes}><Icon name={icon} /></button>;
}

/** Initiale sur pastille ronde, pour un commerce, un client ou un produit sans image. */
export function Monogram({ text, className }: { text: string; className?: string }) {
  return <span aria-hidden="true" className={cn("grid size-10 shrink-0 place-items-center rounded-full bg-brand-soft text-sm font-bold text-brand-strong", className)}>{text.trim().slice(0, 1).toUpperCase() || "?"}</span>;
}

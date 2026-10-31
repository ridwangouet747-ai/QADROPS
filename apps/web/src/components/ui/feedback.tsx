import type { ReactNode } from "react";
import { cn } from "./cn";
import { Icon, type IconName } from "./icon";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "brand" | "night";

const badgeTones: Record<Tone, string> = {
  neutral: "bg-surface-muted text-fg-muted border-line",
  info: "bg-info-soft text-info border-info-line",
  success: "bg-ok-soft text-ok border-ok-line",
  warning: "bg-warn-soft text-warn border-warn-line",
  danger: "bg-danger-soft text-danger border-danger-line",
  brand: "bg-brand-soft text-brand-strong border-brand-tint",
  night: "bg-night-soft text-white border-night-line",
};

/** Le statut est toujours écrit en toutes lettres : la couleur ne porte jamais seule l'information. */
export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold whitespace-nowrap", badgeTones[tone], className)}>{children}</span>;
}

const alertTones: Record<Exclude<Tone, "brand" | "neutral" | "night">, { box: string; icon: IconName }> = {
  info: { box: "bg-info-soft border-info-line text-info", icon: "info" },
  success: { box: "bg-ok-soft border-ok-line text-ok", icon: "success" },
  warning: { box: "bg-warn-soft border-warn-line text-warn", icon: "warning" },
  danger: { box: "bg-danger-soft border-danger-line text-danger", icon: "error" },
};

/** Les erreurs interrompent le lecteur d'écran (role=alert) ; les confirmations sont annoncées poliment. */
export function Alert({ tone = "info", children, onDismiss, dismissLabel, className }: {
  tone?: keyof typeof alertTones; children: ReactNode; onDismiss?: () => void; dismissLabel?: string; className?: string;
}) {
  const style = alertTones[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex items-start gap-3 rounded-[14px] border border-s-4 px-3.5 py-3 text-sm font-medium", style.box, className)}>
      <Icon name={style.icon} className="mt-0.5" />
      <div className="min-w-0 flex-1 text-fg">{children}</div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label={dismissLabel} className="-my-1.5 -me-1.5 grid size-11 shrink-0 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-fg-muted hover:bg-white/60">
          <Icon name="close" />
        </button>
      )}
    </div>
  );
}

export function EmptyState({ icon = "clipboard", title, children, action }: { icon?: IconName; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid justify-items-center gap-2 rounded-xl border border-dashed border-line-strong bg-paper px-4 py-8 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-brand-soft text-brand"><Icon name={icon} className="size-6" /></span>
      <p className="m-0 font-semibold text-ink">{title}</p>
      {children && <p className="m-0 max-w-sm text-sm text-fg-muted">{children}</p>}
      {action}
    </div>
  );
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const percent = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label} className="h-2 overflow-hidden rounded-full bg-surface-muted">
      <div className={cn("h-full rounded-full transition-[width] duration-300 ease-snappy", percent === 100 ? "bg-ok" : "bg-brand-gradient")} style={{ width: `${percent}%` }} />
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-md bg-surface-muted motion-reduce:animate-none", className)} />;
}

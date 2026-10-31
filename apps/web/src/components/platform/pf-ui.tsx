"use client";

/*
 * Composants de la console Qadr Ops Platform : identité monochrome (jetons pf-*), distincte des
 * composants Business (FINNOVA). Aucun composant Business n'importe ce fichier.
 */
import { useEffect, useId, useRef, useState, type ReactNode, type SelectHTMLAttributes, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/components/ui/cn";
import { Icon, type IconName } from "@/components/ui/icon";
import { useI18n } from "@/components/i18n/i18n-provider";
import type { MessageKey, Translate } from "@/lib/i18n/translate";

export const pfFocus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pf-ink";

/* ------------------------------------------------------------------ Boutons */

type ButtonVariant = "dark" | "light" | "ghost" | "danger";
const buttonVariants: Record<ButtonVariant, string> = {
  dark: "bg-pf-ink text-white hover:bg-pf-panel-soft border-transparent",
  light: "bg-pf-card text-pf-ink border-pf-line hover:border-pf-line-strong",
  ghost: "bg-transparent text-pf-ink border-transparent hover:bg-pf-chip",
  danger: "bg-pf-card text-pf-alert border-pf-line hover:border-pf-alert hover:bg-pf-alert-soft",
};

export function PfButton({ variant = "dark", size = "md", icon, loading, className, children, type = "button", ...props }: {
  variant?: ButtonVariant; size?: "sm" | "md"; icon?: IconName; loading?: boolean; children?: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} {...props} disabled={props.disabled || loading} aria-busy={loading || undefined}
      className={cn("inline-flex shrink-0 cursor-pointer appearance-none items-center justify-center gap-2 rounded-full border font-semibold transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "min-h-10 px-4 text-[0.82rem]" : "min-h-11 px-5 text-sm", buttonVariants[variant], pfFocus, className)}>
      {loading ? <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-current border-e-transparent" /> : icon ? <Icon name={icon} className="size-[18px]" /> : null}
      {children}
    </button>
  );
}

/** Bouton rond à icône seule : le libellé reste obligatoire pour les lecteurs d'écran. */
export function PfIconButton({ icon, label, variant = "dark", className, ...props }: { icon: IconName; label: string; variant?: "dark" | "light" } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...props} aria-label={label} title={label}
      className={cn("grid size-11 shrink-0 cursor-pointer appearance-none place-items-center rounded-full border transition-colors duration-200",
        variant === "dark" ? "border-transparent bg-pf-ink text-white hover:bg-pf-panel-soft" : "border-pf-line bg-pf-card text-pf-ink hover:border-pf-line-strong", pfFocus, className)}>
      <Icon name={icon} className="size-[18px]" />
    </button>
  );
}

/* ------------------------------------------------------------------ Surfaces */

export function PfCard({ tone = "white", className, children, as: Tag = "section", ...props }: { tone?: "white" | "dark" | "soft"; className?: string; children: ReactNode; as?: "section" | "div" | "article" } & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag {...props} className={cn("min-w-0 rounded-[28px] p-5 sm:p-6",
      tone === "white" && "border border-white bg-pf-card shadow-pf-card",
      tone === "soft" && "border border-pf-line bg-pf-raised",
      tone === "dark" && "bg-pf-panel text-white shadow-pf-panel", className)}>
      {children}
    </Tag>
  );
}

export function PfCardHeader({ title, caption, action, dark, id }: { title: string; caption?: ReactNode; action?: ReactNode; dark?: boolean; id?: string }) {
  return (
    <header className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 id={id} className={cn("m-0 text-[1rem] font-semibold tracking-[-0.01em]", dark ? "text-white" : "text-pf-ink")}>{title}</h2>
        {caption && <p className={cn("m-0 mt-1 text-[0.8rem]", dark ? "text-pf-panel-fg" : "text-pf-muted")}>{caption}</p>}
      </div>
      {action}
    </header>
  );
}

/** Grand chiffre mis en avant, à la manière d'un indicateur éditorial. */
export function PfStat({ label, value, hint, emphasis, icon }: { label: string; value: ReactNode; hint?: ReactNode; emphasis?: boolean; icon?: IconName }) {
  return (
    <div className={cn("flex min-w-0 flex-col justify-between gap-4 rounded-[24px] p-5", emphasis ? "bg-pf-ink text-white" : "border border-white bg-pf-card shadow-pf-card")}>
      <div className="flex items-center justify-between gap-2">
        <span className={cn("text-[0.8rem] font-medium", emphasis ? "text-pf-panel-fg" : "text-pf-muted")}>{label}</span>
        {icon && <span className={cn("grid size-8 place-items-center rounded-full", emphasis ? "bg-pf-panel-soft text-white" : "bg-pf-chip text-pf-ink")}><Icon name={icon} className="size-4" /></span>}
      </div>
      <div>
        <strong className={cn("numeric block text-[2.1rem] leading-none font-semibold tracking-[-0.04em]", emphasis ? "text-white" : "text-pf-ink")}>{value}</strong>
        {hint && <span className={cn("mt-2 block text-[0.78rem]", emphasis ? "text-pf-panel-fg" : "text-pf-muted")}>{hint}</span>}
      </div>
    </div>
  );
}

export function PfBadge({ tone = "muted", children, dot = true }: { tone?: "solid" | "muted" | "outline" | "alert" | "dark"; children: ReactNode; dot?: boolean }) {
  return (
    <span className={cn("inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.74rem] font-semibold whitespace-nowrap",
      tone === "solid" && "bg-pf-ink text-white", tone === "muted" && "bg-pf-chip text-pf-fg", tone === "outline" && "border border-pf-line-strong text-pf-muted",
      tone === "alert" && "bg-pf-alert-soft text-pf-alert", tone === "dark" && "bg-pf-panel-soft text-white")}>
      {dot && <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />}
      <span className="truncate">{children}</span>
    </span>
  );
}

export function PfAvatar({ name, dark, size = "md" }: { name: string; dark?: boolean; size?: "sm" | "md" | "lg" }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
  return (
    <span aria-hidden="true" className={cn("grid shrink-0 place-items-center rounded-full font-semibold",
      size === "sm" ? "size-8 text-[0.72rem]" : size === "lg" ? "size-14 text-base" : "size-10 text-[0.8rem]",
      dark ? "bg-pf-panel-soft text-white ring-1 ring-pf-panel-line" : "bg-pf-chip text-pf-ink ring-1 ring-white")}>{initials}</span>
  );
}

export function PfProgress({ value, dark, label }: { value: number; dark?: boolean; label?: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <span role="progressbar" aria-valuenow={Math.round(clamped)} aria-valuemin={0} aria-valuemax={100} aria-label={label}
      className={cn("block h-1.5 w-full overflow-hidden rounded-full", dark ? "bg-pf-panel-line" : "bg-pf-chip")}>
      <span className={cn("block h-full rounded-full", dark ? "bg-white" : "bg-pf-ink")} style={{ width: `${clamped}%` }} />
    </span>
  );
}

export function PfEmpty({ icon = "info", title, children, dark }: { icon?: IconName; title: string; children?: ReactNode; dark?: boolean }) {
  return (
    <div className={cn("grid place-items-center gap-2 rounded-[22px] border border-dashed px-4 py-8 text-center", dark ? "border-pf-panel-line text-pf-panel-fg" : "border-pf-line-strong text-pf-muted")}>
      <Icon name={icon} className="size-6" />
      <p className={cn("m-0 text-sm font-semibold", dark ? "text-white" : "text-pf-ink")}>{title}</p>
      {children && <p className="m-0 max-w-md text-[0.82rem]">{children}</p>}
    </div>
  );
}

export function PfSkeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("block animate-pulse rounded-[20px] bg-pf-chip motion-reduce:animate-none", className)} />;
}

export function PfNotice({ tone = "info", children, onDismiss }: { tone?: "info" | "alert" | "success"; children: ReactNode; onDismiss?: () => void }) {
  const { t } = useI18n();
  return (
    <div role={tone === "alert" ? "alert" : "status"} className={cn("flex items-start gap-3 rounded-[20px] px-4 py-3 text-sm",
      tone === "alert" ? "bg-pf-alert-soft text-pf-alert" : tone === "success" ? "bg-pf-ink text-white" : "border border-pf-line bg-pf-card text-pf-fg")}>
      <Icon name={tone === "alert" ? "warning" : tone === "success" ? "check" : "info"} className="mt-0.5 size-[18px]" />
      <div className="min-w-0 flex-1">{children}</div>
      {onDismiss && <button type="button" onClick={onDismiss} aria-label={t("platform.common.close")} className={cn("cursor-pointer appearance-none rounded-full border-0 bg-transparent p-0.5 text-current", pfFocus)}><Icon name="close" className="size-4" /></button>}
    </div>
  );
}

/* ------------------------------------------------------------------ Formulaires */

const controlBase = "w-full min-h-12 appearance-none rounded-[16px] border border-pf-line bg-pf-card px-4 text-[16px] text-pf-ink placeholder:text-pf-subtle hover:border-pf-line-strong focus:border-pf-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-pf-ink/15 disabled:opacity-60";

export function PfField({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string; children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode }) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="grid min-w-0 gap-1.5">
      <label htmlFor={id} className="text-[0.82rem] font-semibold text-pf-ink">{label}</label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {hint && <p id={`${id}-hint`} className="m-0 text-[0.76rem] text-pf-muted">{hint}</p>}
      {error && <p id={`${id}-error`} className="m-0 text-[0.78rem] font-semibold text-pf-alert">{error}</p>}
    </div>
  );
}

export function PfInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(controlBase, className)} />;
}

export function PfTextarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(controlBase, "min-h-24 py-3 leading-relaxed", className)} />;
}

export function PfSelect({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative block min-w-0">
      <select {...props} className={cn(controlBase, "cursor-pointer pe-10", className)}>{children}</select>
      <Icon name="chevronDown" className="pointer-events-none absolute end-3.5 top-1/2 size-4 -translate-y-1/2 text-pf-muted" />
    </span>
  );
}

/** Champ de recherche en pilule, comme dans la référence. */
export function PfSearch({ value, onChange, placeholder, label }: { value: string; onChange: (value: string) => void; placeholder: string; label: string }) {
  return (
    <label className="relative flex min-h-12 w-full min-w-0 items-center rounded-full border border-white bg-pf-card ps-12 pe-4 shadow-pf-card sm:w-72">
      <span className="sr-only">{label}</span>
      <span className="absolute start-1.5 grid size-9 place-items-center rounded-full bg-pf-ink text-white"><Icon name="search" className="size-4" /></span>
      <input type="search" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder}
        className="min-w-0 flex-1 appearance-none border-0 bg-transparent text-[16px] text-pf-ink outline-none placeholder:text-pf-subtle sm:text-[0.9rem]" />
    </label>
  );
}

/** Choix exclusif en pilules (période, filtres courts). */
export function PfSegmented<T extends string>({ label, value, options, onChange, dark }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; dark?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full p-1", dark ? "bg-pf-panel-soft" : "border border-white bg-pf-card shadow-pf-card")}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button key={option.value} type="button" role="radio" aria-checked={selected} onClick={() => onChange(option.value)}
            className={cn("min-h-9 shrink-0 cursor-pointer appearance-none rounded-full border-0 px-3.5 text-[0.8rem] font-semibold transition-colors duration-200", pfFocus,
              selected ? (dark ? "bg-white text-pf-ink" : "bg-pf-ink text-white") : (dark ? "bg-transparent text-pf-panel-fg hover:text-white" : "bg-transparent text-pf-muted hover:text-pf-ink"))}>
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ Dialogues */

/** Dialogue natif (piège du focus, Échap) ; fermé, il n'est pas rendu dans le DOM visible. */
export function PfDialog({ open, onClose, title, description, children, wide }: { open: boolean; onClose: () => void; title: string; description?: ReactNode; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { t } = useI18n();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={ref} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose(); }}
      className={cn("m-auto max-h-[min(92dvh,860px)] w-[calc(100vw-24px)] overflow-y-auto rounded-[28px] border border-white bg-pf-canvas p-0 text-pf-fg shadow-pf-panel backdrop:bg-pf-ink/40 backdrop:backdrop-blur-[2px]", wide ? "max-w-3xl" : "max-w-lg")}>
      {open && (
        <div className="grid gap-5 p-5 sm:p-7">
          <header className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 id={titleId} className="m-0 text-[1.35rem] leading-tight font-semibold tracking-[-0.03em] text-pf-ink">{title}</h2>
              {description && <p className="m-0 mt-1.5 text-sm text-pf-muted">{description}</p>}
            </div>
            <PfIconButton icon="close" label={t("platform.common.close")} variant="light" onClick={onClose} />
          </header>
          {children}
        </div>
      )}
    </dialog>
  );
}

/** Confirmation d'une action sensible, avec motif obligatoire (≥ 5 caractères) vérifié aussi côté serveur. */
export function PfReasonDialog({ open, onClose, title, body, confirmLabel, danger, busy, error, onConfirm, extra }: {
  open: boolean; onClose: () => void; title: string; body: ReactNode; confirmLabel: string; danger?: boolean; busy?: boolean; error?: string;
  onConfirm: (reason: string) => void; extra?: ReactNode;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (open) { setReason(""); setTouched(false); } }, [open]);
  const tooShort = reason.trim().length < 5;
  return (
    <PfDialog open={open} onClose={() => !busy && onClose()} title={title} description={body}>
      <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); setTouched(true); if (!tooShort) onConfirm(reason.trim()); }}>
        {extra}
        <PfField label={t("platform.common.reason")} hint={t("platform.common.reasonHint")} error={touched && tooShort ? t("platform.common.reasonShort") : undefined}>
          {(props) => <PfTextarea {...props} value={reason} maxLength={500} required onChange={(event) => setReason(event.target.value)} />}
        </PfField>
        {error && <PfNotice tone="alert">{error}</PfNotice>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <PfButton variant="light" onClick={onClose} disabled={busy}>{t("platform.common.cancel")}</PfButton>
          <PfButton type="submit" variant={danger ? "danger" : "dark"} loading={busy}>{confirmLabel}</PfButton>
        </div>
      </form>
    </PfDialog>
  );
}

/* ------------------------------------------------------------------ Graphiques */

/**
 * Courbe minimaliste (ligne fine + aire très légère), sans bibliothèque. Les valeurs restent
 * lisibles par les lecteurs d'écran dans un tableau masqué visuellement.
 */
export function PfLineChart({ points, label, formatLabel, dark }: { points: { key: string; value: number }[]; label: string; formatLabel: (key: string) => string; dark?: boolean }) {
  const width = 640;
  const height = 180;
  const pad = 8;
  const max = Math.max(1, ...points.map((point) => point.value));
  const coordinates = points.map((point, index) => ({
    x: pad + (points.length <= 1 ? 0 : (index / (points.length - 1)) * (width - pad * 2)),
    y: height - pad - (point.value / max) * (height - pad * 2 - 12),
  }));
  const line = coordinates.map((point, index) => {
    if (index === 0) return `M${point.x},${point.y}`;
    const previous = coordinates[index - 1]!;
    const mid = (previous.x + point.x) / 2;
    return `C${mid},${previous.y} ${mid},${point.y} ${point.x},${point.y}`;
  }).join(" ");
  const area = coordinates.length ? `${line} L${coordinates.at(-1)!.x},${height - pad} L${coordinates[0]!.x},${height - pad} Z` : "";
  const gradientId = useId();
  const stroke = dark ? "#ffffff" : "#0b0b0c";
  const ticks = points.length > 1 ? [0, Math.floor((points.length - 1) / 2), points.length - 1] : [0];
  return (
    <figure className="m-0 min-w-0">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={label} className="block h-44 w-full overflow-visible">
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={dark ? 0.18 : 0.08} />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((ratio) => <line key={ratio} x1={pad} x2={width - pad} y1={height * ratio} y2={height * ratio} stroke={dark ? "#2c2c31" : "#ececea"} strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
        {area && <path d={area} fill={`url(#${gradientId})`} />}
        {line && <path d={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
        {coordinates.length > 0 && <circle cx={coordinates.at(-1)!.x} cy={coordinates.at(-1)!.y} r="4" fill={dark ? "#121214" : "#ffffff"} stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className={cn("mt-2 flex justify-between text-[0.72rem]", dark ? "text-pf-panel-fg" : "text-pf-subtle")} aria-hidden="true">
        {ticks.map((index) => <span key={index}>{points[index] ? formatLabel(points[index]!.key) : ""}</span>)}
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>{points.map((point) => <tr key={point.key}><th scope="row">{formatLabel(point.key)}</th><td>{point.value}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

/** Barre segmentée en nuances de gris : la légende porte toujours la valeur (pas seulement la couleur). */
export function PfStackBar({ items, label }: { items: { key: string; label: string; value: number }[]; label: string }) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const shades = ["#0b0b0c", "#3a3a3f", "#7a7a80", "#b4b4b8", "#dcdcd8"];
  return (
    <div className="grid gap-4">
      <div role="img" aria-label={label} className="flex h-3 w-full overflow-hidden rounded-full bg-pf-chip">
        {items.map((item, index) => item.value > 0 && <span key={item.key} style={{ width: `${(item.value / Math.max(total, 1)) * 100}%`, background: shades[index % shades.length] }} className="h-full first:rounded-s-full last:rounded-e-full" />)}
      </div>
      <ul className="m-0 grid grid-cols-[minmax(0,1fr)] list-none gap-2.5 p-0">
        {items.map((item, index) => (
          <li key={item.key} className="flex items-center justify-between gap-3 text-[0.84rem]">
            <span className="flex min-w-0 items-center gap-2.5 text-pf-fg"><span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: shades[index % shades.length] }} /><span className="truncate">{item.label}</span></span>
            <span className="numeric font-semibold text-pf-ink">{item.value}<span className="ms-2 font-normal text-pf-subtle">{total ? `${Math.round((item.value / total) * 100)} %` : "0 %"}</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ Utilitaires */

export class PfRequestError extends Error {
  constructor(public status: number | null, message?: string) { super(message); }
}

/** Appel JSON vers /api/platform/* ; l'erreur garde le statut pour un message adapté. */
export async function pfRequest<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { method: init?.method ?? "GET", cache: "no-store", headers: init?.body ? { "content-type": "application/json" } : undefined, body: init?.body ? JSON.stringify(init.body) : undefined });
  } catch { throw new PfRequestError(null); }
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new PfRequestError(response.status, (payload as { error?: string }).error);
  return payload;
}

/** Message affichable : précis en français (texte serveur), traduit sinon. */
export function pfErrorMessage(error: unknown, t: Translate, locale: string) {
  if (!(error instanceof PfRequestError)) return t("platform.common.error");
  if (error.status === null) return t("platform.common.network");
  if (locale === "fr" && error.message) return error.message;
  if (error.status === 401 || error.status === 403) return t("platform.common.forbidden");
  return t("platform.common.error");
}

/** Libellé d'un événement d'audit (« platform.business_suspended » → clé de traduction). */
export function pfEventLabel(t: Translate, eventType: string) {
  const key = `platform.events.${eventType.replace(/\./g, "_")}` as MessageKey;
  const label = t(key);
  return label === key ? t("platform.events.unknown") : label;
}

/** Valeurs avant/après d'une entrée d'audit, en texte court. */
export function pfDescribeChange(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value !== "object") return String(value);
  return Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== null && item !== undefined && typeof item !== "object")
    .map(([key, item]) => `${key}: ${String(item)}`).join(" · ") || "—";
}

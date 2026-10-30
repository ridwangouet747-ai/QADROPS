"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Button } from "./button";
import { cn } from "./cn";
import { controlClasses } from "./field";
import { Icon } from "./icon";

export function SearchField({ value, onChange, label, placeholder }: { value: string; onChange: (value: string) => void; label: string; placeholder?: string }) {
  const { t } = useI18n();
  return (
    <div className="relative">
      <Icon name="search" className="pointer-events-none absolute inset-y-0 start-3 my-auto text-fg-subtle" />
      <input
        type="search" value={value} onChange={(event) => onChange(event.target.value)} aria-label={label} placeholder={placeholder}
        autoComplete="off" enterKeyHint="search" className={cn(controlClasses, "ps-10 pe-11 [&::-webkit-search-cancel-button]:hidden")}
      />
      {value && (
        <button type="button" onClick={() => onChange("")} aria-label={t("common.clearSearch")} className="absolute inset-y-0 end-0 grid w-11 cursor-pointer place-items-center border-0 bg-transparent text-fg-muted">
          <Icon name="close" />
        </button>
      )}
    </div>
  );
}

/** Filtres exclusifs : boutons à état pressé, défilables horizontalement dans leur propre zone si l'écran est étroit. */
export function Segmented<T extends string>({ label, value, onChange, options }: {
  label: string; value: T; onChange: (value: T) => void; options: { value: T; label: string; count?: number }[];
}) {
  return (
    <div role="group" aria-label={label} className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value} type="button" aria-pressed={active} onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold whitespace-nowrap",
              active ? "border-ink bg-ink text-white" : "border-line bg-surface text-fg-muted hover:border-line-strong",
            )}
          >
            {option.label}
            {option.count !== undefined && <span className={cn("numeric rounded-full px-1.5 text-xs", active ? "bg-white/20" : "bg-surface-muted")}>{option.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Fenêtre de confirmation basée sur <dialog> : focus piégé, touche Échap et retour du focus
 * sont gérés par le navigateur, sans bibliothèque.
 */
export function ConfirmDialog({ open, title, children, confirmLabel, onConfirm, onClose, busy, tone = "primary" }: {
  open: boolean; title: string; children: ReactNode; confirmLabel: string; onConfirm: () => void; onClose: () => void; busy?: boolean; tone?: "primary" | "cta" | "danger";
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref} onClose={onClose} aria-labelledby="confirm-dialog-title"
      className="qadr-dialog m-auto w-[min(calc(100%_-_2rem),28rem)] rounded-xl border border-line bg-surface p-0 text-fg shadow-overlay"
    >
      <div className="grid gap-3 p-5">
        <h2 id="confirm-dialog-title" className="m-0 font-heading text-xl font-normal text-ink">{title}</h2>
        <div className="text-fg-muted">{children}</div>
        <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
          <Button variant={tone} onClick={onConfirm} loading={busy}>{confirmLabel}</Button>
        </div>
      </div>
    </dialog>
  );
}

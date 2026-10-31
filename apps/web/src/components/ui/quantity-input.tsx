"use client";

import { useI18n } from "@/components/i18n/i18n-provider";
import { stepQuantity } from "@/lib/client/quantity";
import { cn } from "./cn";
import { Icon } from "./icon";

/**
 * Saisie de quantité pour le téléphone : clavier décimal, boutons ±1 de 48 px.
 * Pensé pour les articles sans code-barres (sacs, mètres, tôles) : aucune lecture de code n'est requise.
 */
export function QuantityInput({ id, value, onChange, unit, disabled, invalid, describedBy, ariaLabel }: {
  id: string; value: string; onChange: (value: string) => void; unit?: string;
  disabled?: boolean; invalid?: boolean; describedBy?: string; ariaLabel?: string;
}) {
  const { t, locale } = useI18n();
  const stepButton = "grid size-12 shrink-0 cursor-pointer place-items-center border-0 bg-surface-muted text-ink hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-50";
  return (
    <div className={cn("flex items-stretch overflow-hidden rounded-[14px] border bg-surface focus-within:border-brand focus-within:shadow-[0_0_0_3px_rgb(91_77_242/25%)]", invalid ? "border-danger" : "border-line-strong")}>
      <button type="button" className={stepButton} onClick={() => onChange(stepQuantity(value, -1, locale))} disabled={disabled} aria-label={t("quantity.decrease")}>
        <Icon name="minus" />
      </button>
      <div className="flex min-w-0 flex-1 items-center gap-1 border-x border-line px-2" dir="ltr">
        <input
          id={id} type="text" inputMode="decimal" autoComplete="off" enterKeyHint="done"
          value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}
          aria-invalid={invalid || undefined} aria-describedby={describedBy} aria-label={ariaLabel}
          className="numeric h-12 min-h-0 w-full min-w-0 rounded-none border-0 bg-transparent p-0 text-center text-lg font-semibold text-ink shadow-none outline-none"
        />
        {unit && <span className="shrink-0 text-sm text-fg-muted">{unit}</span>}
      </div>
      <button type="button" className={stepButton} onClick={() => onChange(stepQuantity(value, 1, locale))} disabled={disabled} aria-label={t("quantity.increase")}>
        <Icon name="plus" />
      </button>
    </div>
  );
}

import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "./cn";

export const controlClasses = cn(
  "block w-full min-h-11 rounded-md border border-line-strong bg-surface px-3 text-base text-fg",
  "placeholder:text-fg-subtle aria-invalid:border-danger disabled:bg-surface-muted disabled:text-fg-muted",
);

/**
 * Libellé toujours visible, aide et erreur reliées au champ par aria-describedby.
 * L'erreur s'affiche sous le champ concerné, jamais seulement en haut de page.
 */
export function Field({ label, hint, error, children, className }: {
  label: ReactNode; hint?: ReactNode; error?: ReactNode; className?: string;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: true }) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("grid gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-semibold text-ink">{label}</label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {hint && <p id={hintId} className="m-0 text-sm text-fg-muted">{hint}</p>}
      {error && <p id={errorId} className="m-0 text-sm font-medium text-danger">{error}</p>}
    </div>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(controlClasses, className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(controlClasses, "pe-8", className)} {...props}>{children}</select>;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(controlClasses, "min-h-20 py-2", className)} {...props} />;
}

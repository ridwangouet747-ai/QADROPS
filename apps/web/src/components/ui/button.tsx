import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "cta" | "secondary" | "ghost" | "danger";
type ButtonSize = "md" | "lg";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-brand text-white hover:bg-brand-strong border-transparent",
  cta: "bg-cta text-white hover:bg-cta-strong border-transparent",
  secondary: "bg-surface text-ink border-line-strong hover:bg-surface-muted",
  ghost: "bg-transparent text-brand-strong border-transparent hover:bg-brand-soft",
  danger: "bg-surface text-danger border-danger-line hover:bg-danger-soft",
};
// 44 px minimum partout : la cible tactile ne rétrécit pas sur ordinateur.
const sizes: Record<ButtonSize, string> = { md: "min-h-11 px-4 text-[0.95rem]", lg: "min-h-12 px-5 text-base" };

export function buttonClasses({ variant = "primary", size = "md", block = false, className }: { variant?: ButtonVariant; size?: ButtonSize; block?: boolean; className?: string } = {}) {
  return cn(
    "inline-flex cursor-pointer items-center justify-center gap-2 rounded-md border font-semibold leading-tight select-none",
    "transition-colors duration-150 ease-snappy active:translate-y-px",
    "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-brand",
    "disabled:cursor-not-allowed disabled:opacity-55 disabled:active:translate-y-0",
    variants[variant], sizes[size], block && "w-full", className,
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant; size?: ButtonSize; block?: boolean; loading?: boolean; icon?: ReactNode;
};

export function Button({ variant, size, block, loading = false, icon, className, children, disabled, type = "button", ...props }: ButtonProps) {
  return (
    <button type={type} className={buttonClasses({ variant, size, block, className })} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading ? <span className="size-4 animate-spin rounded-full border-2 border-current border-e-transparent motion-reduce:animate-none" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
}

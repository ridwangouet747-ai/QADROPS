import type { ReactNode } from "react";
import { cn } from "./cn";

const paths = {
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5h.01" /></>,
  warning: <><path d="M12 3.5 21.5 20h-19L12 3.5Z" /><path d="M12 10v4.5M12 17.5h.01" /></>,
  error: <><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6m0-6-6 6" /></>,
  success: <><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.8 2.8L16.5 9.5" /></>,
  back: <path d="m14.5 6-6 6 6 6" />,
  forward: <path d="m9.5 6 6 6-6 6" />,
  clipboard: <><path d="M8 4.5h8v3H8z" /><path d="M8 6H5.5v14h13V6H16M8.5 12h7M8.5 16h4" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.7 3.6 5.7 3.6 9s-1.1 6.3-3.6 9c-2.5-2.7-3.6-5.7-3.6-9S9.5 5.7 12 3Z" /></>,
  download: <><path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5" /><path d="M5 19.5h14" /></>,
  print: <><path d="M7 9V4h10v5M7 17H4.5V9h15v8H17" /><path d="M7 14h10v6H7z" /></>,
  cloudOff: <><path d="M3 3l18 18M8.5 7.2A5 5 0 0 1 16.6 10a3.8 3.8 0 0 1 3.3 5.3M17 18H7a4 4 0 0 1-1.2-7.8" /></>,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof paths;
/** Les icônes directionnelles se retournent en arabe ; les autres gardent leur sens. */
const mirrored = new Set<IconName>(["back", "forward"]);

export function Icon({ name, className, label }: { name: IconName; className?: string; label?: string }) {
  return (
    <svg
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      className={cn("size-5 shrink-0", mirrored.has(name) && "rtl:-scale-x-100", className)}
      role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}
    >
      {paths[name]}
    </svg>
  );
}

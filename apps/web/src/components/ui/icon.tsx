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
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>,
  cart: <><path d="M3.5 4.5h2l2.2 10.2a1.5 1.5 0 0 0 1.5 1.2h7.9a1.5 1.5 0 0 0 1.5-1.1L20.5 8H6.4" /><circle cx="9.5" cy="19.5" r="1.2" /><circle cx="17" cy="19.5" r="1.2" /></>,
  wallet: <><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3" /><path d="M4 7.5v10A2.5 2.5 0 0 0 6.5 20H20v-12H6.5A2.5 2.5 0 0 1 4 7.5Z" /><path d="M16 14h.01" /></>,
  trendUp: <><path d="m4 16 5-5 4 4 7-7" /><path d="M15 8h5v5" /></>,
  receipt: <><path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2v-17Z" /><path d="M9 8.5h6M9 12h6" /></>,
  users: <><circle cx="9" cy="8.5" r="3" /><path d="M3.5 19.5c.6-3.2 2.6-4.8 5.5-4.8s4.9 1.6 5.5 4.8M16 6a3 3 0 0 1 0 5.6M17.5 14.9c1.7.6 2.7 2.1 3 4.6" /></>,
  box: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="m4.5 7.8 7.5 4.3 7.5-4.3M12 12v8.5" /></>,
  grid: <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chart: <><path d="M4 20h16" /><path d="M7 16v-4m5 4V7m5 9v-6" /></>,
  trash: <><path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l1 13h9l1-13" /></>,
  user: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.8-3.6 3.3-5.5 7-5.5s6.2 1.9 7 5.5" /></>,
  truck: <><path d="M3 6.5h11v9H3zM14 10h4l3 3v2.5h-7" /><circle cx="7" cy="17.5" r="1.6" /><circle cx="17.5" cy="17.5" r="1.6" /></>,
  edit: <><path d="M4.5 19.5h4l10-10a2.8 2.8 0 0 0-4-4l-10 10v4Z" /><path d="m13.5 6.5 4 4" /></>,
  arrowUp: <path d="M12 19V5m-6 6 6-6 6 6" />,
  arrowDown: <path d="M12 5v14m-6-6 6 6 6-6" />,
  flag: <><path d="M5.5 21V4" /><path d="M5.5 4.5h11l-2 4 2 4h-11" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="M3 3l18 18M10.6 6a9.8 9.8 0 0 1 1.4-.1c6 0 9.5 6.1 9.5 6.1a17 17 0 0 1-3 3.7M6.5 7.1C4 8.9 2.5 12 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4.1-1M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>,
  logout: <><path d="M9.5 20H5.5a1.5 1.5 0 0 1-1.5-1.5v-13A1.5 1.5 0 0 1 5.5 4h4" /><path d="m15.5 16 4-4-4-4M19.5 12H9.5" /></>,
  tag: <><path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.5 1.5 0 0 1 0 2.1l-6.6 6.6a1.5 1.5 0 0 1-2.1 0Z" /><circle cx="8" cy="8" r="1.4" /></>,
  activity: <path d="M3 12h4l2.5-6 5 12 2.5-6h4" />,
  calendar: <><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  layers: <><path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8Z" /><path d="m3.5 12 8.5 4.5 8.5-4.5M3.5 16l8.5 4.5 8.5-4.5" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  arrowUpRight: <path d="M7 17 17 7M8.5 7H17v8.5" />,
  pause: <path d="M9 6v12M15 6v12" />,
  play: <path d="M8 5.5v13l10-6.5Z" />,
  ban: <><circle cx="12" cy="12" r="8.5" /><path d="m6 6 12 12" /></>,
  shield: <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6Z" />,
  store: <><path d="M4 9.5 5.5 4.5h13L20 9.5" /><path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0M5.5 12v8h13v-8M10 20v-4.5h4V20" /></>,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof paths;
/** Les icônes directionnelles se retournent en arabe ; les autres gardent leur sens. */
const mirrored = new Set<IconName>(["back", "forward", "arrowUpRight"]);

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

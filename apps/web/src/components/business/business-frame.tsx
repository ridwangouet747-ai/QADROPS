"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { BusinessShell, businessAreaFromPath } from "@/components/business/business-shell";
import { setClientCacheScope } from "@/lib/client/data-cache";

/**
 * En-tête de l'espace commerçant monté UNE fois pour toutes les pages `/business/*` (mission performance du
 * 2026-11-24) : changer de page ne le redessine plus et ne relance plus `/api/account/me`, le compteur de
 * notifications ni le rattachement push. Le ticket à l'écran garde sa page nue (impression).
 */
export function BusinessFrame({ initialRole, cacheScope, preview, children }: { initialRole: string | null; cacheScope: string | null; preview: boolean; children: ReactNode }) {
  const pathname = usePathname();
  // Portée des données gardées en mémoire : un autre compte ou un autre commerce les efface toutes.
  setClientCacheScope(cacheScope);
  if (/^\/business\/sales\/[^/]+\/receipt\/?$/.test(pathname)) return <>{children}</>;
  return <BusinessShell active={businessAreaFromPath(pathname)} initialRole={initialRole} preview={preview}>{children}</BusinessShell>;
}

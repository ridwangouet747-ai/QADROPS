"use client";

import { PlatformAudit } from "./platform-audit";
import { PlatformBusinesses } from "./platform-businesses";
import { PlatformOverview } from "./platform-overview";
import { PlatformPlans } from "./platform-plans";
import { PlatformNotifications } from "./platform-notifications";
import { PlatformPromotions } from "./platform-promotions";
import { PlatformSettings } from "./platform-settings";
import { PlatformShell, type PlatformSection } from "./platform-shell";
import { PlatformSubscriptions } from "./platform-subscriptions";

const views: Record<PlatformSection, (preview: boolean) => React.ReactNode> = {
  overview: () => <PlatformOverview />,
  businesses: () => <PlatformBusinesses />,
  subscriptions: () => <PlatformSubscriptions />,
  plans: () => <PlatformPlans />,
  promotions: () => <PlatformPromotions />,
  notifications: () => <PlatformNotifications />,
  audit: () => <PlatformAudit />,
  settings: (preview) => <PlatformSettings preview={preview} />,
};

/**
 * Console Qadr Ops Platform (mission 08) : remplace l'ancien PlatformWorkspace, conservé mais inutilisé.
 * Pas de <Suspense> ici : les pages sont dynamiques, et une frontière diffusée en flux restait masquée.
 */
export function PlatformConsole({ section, preview }: { section: PlatformSection; preview: boolean }) {
  return <PlatformShell active={section} preview={preview}>{views[section](preview)}</PlatformShell>;
}

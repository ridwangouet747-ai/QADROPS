"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { analyticsConfigured, identifyInternalUser, initializeAnalytics, readConsent, setConsent } from "@/lib/analytics/client";

/**
 * Mesure d'audience (PostHog) : chargée seulement après un accord explicite. Le bandeau n'apparaît que si
 * PostHog est configuré et qu'aucun choix n'a été fait ; refuser ne change rien à l'utilisation.
 */
export function AnalyticsProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [ask, setAsk] = useState(false);
  useEffect(() => {
    if (!analyticsConfigured()) return;
    if (initializeAnalytics()) void identify();
    else if (readConsent() === null) setAsk(true);
  }, []);
  return <>{children}{ask && <ConsentBanner onDecided={() => setAsk(false)} />}</>;
}

async function identify() {
  try {
    const response = await fetch("/api/account/me", { cache: "no-store" });
    if (!response.ok) return;
    const body = await response.json() as { user?: { id?: string } };
    if (body.user?.id) await identifyInternalUser(body.user.id);
  } catch { /* hors ligne ou non connecté : pas d'identification */ }
}

function ConsentBanner({ onDecided }: { onDecided: () => void }) {
  const { t } = useI18n();
  const decide = (value: "granted" | "denied") => {
    setConsent(value);
    if (value === "granted") void identify();
    onDecided();
  };
  return (
    <div role="dialog" aria-labelledby="consent-title" className="fixed inset-x-3 bottom-24 z-50 mx-auto max-w-lg rounded-2xl border border-line bg-surface p-4 shadow-overlay sm:bottom-4">
      <p id="consent-title" className="m-0 font-semibold text-ink">{t("analytics.consent.title")}</p>
      <p className="m-0 mt-1 text-sm text-fg-muted">{t("analytics.consent.body")}</p>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={() => decide("denied")} className="min-h-11 cursor-pointer rounded-full border border-line bg-surface px-5 text-sm font-semibold text-ink">{t("analytics.consent.refuse")}</button>
        <button type="button" onClick={() => decide("granted")} className="min-h-11 cursor-pointer rounded-full border-0 bg-brand px-5 text-sm font-semibold text-white">{t("analytics.consent.accept")}</button>
      </div>
    </div>
  );
}

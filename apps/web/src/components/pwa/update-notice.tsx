"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Icon } from "@/components/ui/icon";

const checkEveryMs = 30 * 60 * 1000;
const minimumGapMs = 60 * 1000;

async function deployedVersion(): Promise<string | null> {
  try {
    const response = await fetch("/api/version", { cache: "no-store" });
    if (!response.ok) return null;
    const body = await response.json() as { version?: unknown };
    return typeof body.version === "string" ? body.version : null;
  } catch { return null; } // hors ligne : nouvel essai au prochain retour sur l'onglet
}

/**
 * Nouvelle version en production : un message, jamais un rechargement imposé. La personne termine sa vente ou son
 * formulaire, puis actualise quand elle le décide ; « Plus tard » masque le message jusqu'à la version suivante.
 * Vérification au chargement, au retour sur l'onglet (au plus une fois par minute) et toutes les 30 minutes.
 */
export function UpdateNotice() {
  const { t } = useI18n();
  const [newVersion, setNewVersion] = useState<string | null>(null);
  const dismissed = useRef<string | null>(null);

  useEffect(() => {
    let baseline: string | null = null;
    let lastCheck = 0;
    let stopped = false;
    const check = async () => {
      if (document.visibilityState !== "visible" || Date.now() - lastCheck < minimumGapMs) return;
      lastCheck = Date.now();
      const version = await deployedVersion();
      if (stopped || !version) return;
      if (baseline === null) baseline = version;
      else if (version !== baseline && version !== dismissed.current) setNewVersion(version);
    };
    const onVisible = () => void check();
    void check();
    const timer = window.setInterval(onVisible, checkEveryMs);
    document.addEventListener("visibilitychange", onVisible);
    return () => { stopped = true; window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  if (!newVersion) return null;
  return (
    <div role="status" aria-live="polite" className="fixed inset-x-3 bottom-24 z-50 mx-auto flex max-w-lg flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-overlay sm:bottom-4">
      <Icon name="info" className="size-5 shrink-0 text-brand" />
      <p className="m-0 min-w-0 flex-1 text-sm font-semibold text-ink">{t("pwa.update.available")}</p>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={() => { dismissed.current = newVersion; setNewVersion(null); }} className="min-h-11 cursor-pointer rounded-full border border-line bg-surface px-4 text-sm font-semibold text-ink">{t("pwa.update.later")}</button>
        <button type="button" onClick={() => window.location.reload()} className="min-h-11 cursor-pointer rounded-full border-0 bg-brand px-4 text-sm font-semibold text-white">{t("pwa.update.refresh")}</button>
      </div>
    </div>
  );
}

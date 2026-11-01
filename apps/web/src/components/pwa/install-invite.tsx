"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Button, buttonClasses } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { detectInstallPlatform, dismissInstallInvite, installInviteDismissed, promptInstall, useInstallState } from "@/lib/pwa/client";

/**
 * Invitation discrète à installer, sous l'en-tête. Jamais bloquante, refusable (« Plus tard », retenu sur cet
 * appareil) et retrouvable ensuite dans « Installer ». Affichée seulement là où l'installation est possible :
 * invite du navigateur disponible, ou téléphone (iPhone/Android, avec les étapes à suivre).
 */
export function InstallInvite() {
  const { t } = useI18n();
  const { installed, canPrompt } = useInstallState();
  const [eligible, setEligible] = useState(false);
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    setHidden(installInviteDismissed());
    setEligible(detectInstallPlatform(navigator.userAgent, navigator.maxTouchPoints) !== "desktop");
  }, []);
  if (installed || hidden || !(canPrompt || eligible)) return null;

  const later = () => { dismissInstallInvite(); setHidden(true); };
  return (
    <aside aria-labelledby="install-invite-title" className="mx-auto mt-4 flex max-w-[1440px] flex-wrap items-center gap-3 px-4 sm:px-6 lg:px-8">
      <div className="flex w-full flex-wrap items-center gap-3 rounded-xl border border-brand-tint bg-brand-soft px-4 py-3">
        <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-[13px] bg-brand-gradient text-white shadow-brand"><Icon name="download" /></span>
        <div className="min-w-0 flex-1 basis-56">
          <p id="install-invite-title" className="m-0 text-sm font-bold text-ink">{t("pwa.invite.title")}</p>
          <p className="m-0 text-sm text-fg-muted">{t("pwa.invite.body")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canPrompt
            ? <Button variant="cta" onClick={() => void promptInstall()} icon={<Icon name="download" />}>{t("pwa.invite.install")}</Button>
            : <Link href="/business/install" className={buttonClasses({ variant: "cta" })}>{t("pwa.invite.howTo")}</Link>}
          <Button variant="ghost" onClick={later}>{t("pwa.invite.later")}</Button>
        </div>
      </div>
    </aside>
  );
}

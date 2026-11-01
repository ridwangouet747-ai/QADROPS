"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/controls";
import { Alert } from "@/components/ui/feedback";
import { Icon } from "@/components/ui/icon";
import { Card, CardTitle, PageHeader } from "@/components/ui/layout";
import { detectInstallPlatform, promptInstall, useInstallState, type InstallPlatform } from "@/lib/pwa/client";

const platforms: InstallPlatform[] = ["android", "ios", "desktop"];
const steps = ["one", "two", "three"] as const;
const benefits = ["fast", "updates", "notifications", "offline"] as const;

/** Page « Installer l'application » : bouton direct quand le navigateur le permet, sinon les gestes à faire. */
export function InstallWorkspace() {
  const { t } = useI18n();
  const { installed, canPrompt } = useInstallState();
  const [platform, setPlatform] = useState<InstallPlatform>("android");
  const [outcome, setOutcome] = useState<"accepted" | "dismissed" | null>(null);
  useEffect(() => { setPlatform(detectInstallPlatform(navigator.userAgent, navigator.maxTouchPoints)); }, []);

  const install = async () => {
    const result = await promptInstall();
    if (result !== "unavailable") setOutcome(result);
  };

  return (
    <div>
      <PageHeader kicker={t("pwa.page.kicker")} title={t("pwa.page.title")}>{t("pwa.page.intro")}</PageHeader>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card className="grid gap-4" aria-labelledby="install-steps-title">
          {installed ? (
            <Alert tone="success"><strong className="block">{t("pwa.page.installed")}</strong>{t("pwa.page.installedHint")}</Alert>
          ) : canPrompt ? (
            <Button variant="cta" size="lg" block onClick={() => void install()} icon={<Icon name="download" />}>{t("pwa.page.installButton")}</Button>
          ) : (
            <Alert tone="info">{t("pwa.page.noPrompt")}</Alert>
          )}
          {outcome && <Alert tone={outcome === "accepted" ? "success" : "info"}>{t(outcome === "accepted" ? "pwa.page.accepted" : "pwa.page.dismissed")}</Alert>}

          <CardTitle id="install-steps-title" title={t("pwa.page.platformLabel")} />
          <Segmented label={t("pwa.page.platformLabel")} value={platform} onChange={setPlatform}
            options={platforms.map((value) => ({ value, label: t(`pwa.page.platforms.${value}`) }))} />
          <ol className="m-0 grid list-none gap-3 p-0">
            {steps.map((step, index) => (
              <li key={step} className="flex items-start gap-3">
                <span aria-hidden="true" className="numeric grid size-8 shrink-0 place-items-center rounded-full bg-brand text-sm font-bold text-white">{index + 1}</span>
                <span className="pt-1 text-[0.95rem] text-ink">{t(`pwa.page.steps.${platform}.${step}`)}</span>
              </li>
            ))}
          </ol>
          {platform !== "desktop" && <p className="m-0 text-sm text-fg-muted">{t("pwa.page.otherBrowser")}</p>}
        </Card>

        <Card className="grid gap-3" aria-labelledby="install-benefits-title">
          <CardTitle id="install-benefits-title" title={t("pwa.page.benefitsTitle")} />
          <ul className="m-0 grid list-none gap-3 p-0">
            {benefits.map((benefit) => (
              <li key={benefit} className="flex items-start gap-2.5 text-sm text-fg">
                <Icon name={benefit === "offline" ? "cloudOff" : "check"} className={benefit === "offline" ? "mt-0.5 size-4 shrink-0 text-warn" : "mt-0.5 size-4 shrink-0 text-ok"} />
                <span>{t(`pwa.page.benefits.${benefit}`)}</span>
              </li>
            ))}
          </ul>
          <Link href="/business/notifications" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand-strong">
            <Icon name="bell" className="size-4" />{t("pwa.page.notificationsLink")}
          </Link>
        </Card>
      </div>
    </div>
  );
}

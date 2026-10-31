"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Icon } from "@/components/ui/icon";
import { intlLocale } from "@/lib/i18n/config";
import { PfPageHeader } from "./platform-shell";
import { PfAvatar, PfBadge, PfCard, PfCardHeader, PfNotice, PfSkeleton, pfErrorMessage, pfRequest } from "./pf-ui";

type Admin = { userId: string; name: string; email: string; grantedAt: string; revokedAt: string | null };
type Settings = { self: Admin | null; admins: Admin[] };

export function PlatformSettings() {
  const { t, locale } = useI18n();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { pfRequest<Settings>("/api/platform/settings").then(setSettings).catch((caught) => setError(pfErrorMessage(caught, t, locale))); }, [t, locale]);
  const date = (value: string) => new Date(value).toLocaleDateString(intlLocale[locale], { dateStyle: "long" });

  return (
    <>
      <PfPageHeader title={t("platform.settings.title")} description={t("platform.settings.description")} />
      {error && <div className="mb-4"><PfNotice tone="alert">{error}</PfNotice></div>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="grid h-fit gap-4">
          <PfCard>
            <PfCardHeader title={t("platform.settings.profile")} />
            {settings?.self ? (
              <div className="flex items-center gap-4">
                <PfAvatar name={settings.self.name} size="lg" />
                <div className="min-w-0">
                  <strong className="block truncate text-[1.05rem] text-pf-ink">{settings.self.name}</strong>
                  <span dir="ltr" className="block truncate text-[0.82rem] text-pf-muted">{settings.self.email}</span>
                  <span className="mt-1 block text-[0.78rem] text-pf-muted">{t("platform.settings.since", { date: date(settings.self.grantedAt) })}</span>
                </div>
              </div>
            ) : <PfSkeleton className="h-16" />}
          </PfCard>
          <PfCard tone="dark">
            <PfCardHeader dark title={t("platform.settings.grantTitle")} />
            <p className="m-0 text-[0.84rem] leading-relaxed text-pf-panel-fg">{t("platform.settings.grantBody")}</p>
            <pre dir="ltr" className="m-0 mt-4 overflow-x-auto rounded-[18px] bg-pf-panel-soft p-4 font-mono text-[0.76rem] leading-relaxed text-white">npx tsx scripts/platform-admin.ts grant \{"\n"}  --email … --reason "…"</pre>
            <p className="m-0 mt-4 flex items-start gap-2 text-[0.8rem] text-white"><Icon name="shield" className="mt-0.5 size-4" />{t("platform.settings.separation")}</p>
          </PfCard>
        </div>
        <div className="grid h-fit gap-4">
          <PfCard>
            <PfCardHeader title={t("platform.settings.admins")} />
            {settings ? (
              <ul className="m-0 grid grid-cols-[minmax(0,1fr)] list-none gap-2 p-0">
                {settings.admins.map((admin) => (
                  <li key={admin.userId} className="flex items-center gap-3 rounded-[18px] border border-pf-line px-3 py-2.5">
                    <PfAvatar size="sm" name={admin.name} />
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate text-[0.86rem] text-pf-ink">{admin.name}</strong>
                      <span dir="ltr" className="block truncate text-[0.76rem] text-pf-muted">{admin.email}</span>
                    </span>
                    {admin.revokedAt ? <PfBadge tone="outline">{t("platform.settings.revoked", { date: date(admin.revokedAt) })}</PfBadge> : <PfBadge tone="solid">{t("platform.superAdmin")}</PfBadge>}
                  </li>
                ))}
              </ul>
            ) : <PfSkeleton className="h-32" />}
          </PfCard>
          <PfCard tone="soft">
            <PfCardHeader title={t("platform.settings.expiry")} />
            <p className="m-0 text-[0.84rem] leading-relaxed text-pf-muted">{t("platform.settings.expiryBody")}</p>
          </PfCard>
          <PfCard tone="soft">
            <PfCardHeader title={t("platform.settings.payments")} />
            <p className="m-0 text-[0.84rem] leading-relaxed text-pf-muted">{t("platform.settings.paymentsBody")}</p>
          </PfCard>
        </div>
      </div>
    </>
  );
}

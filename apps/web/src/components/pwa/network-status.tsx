"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Icon } from "@/components/ui/icon";
import { useOnline } from "@/lib/pwa/client";

/**
 * Bandeau global : visible tant que le navigateur se sait hors ligne, puis « Connexion rétablie » quelques
 * secondes. Une seule zone annoncée (role=status) ; rien ne bouge le focus.
 */
export function NetworkStatus() {
  const { t } = useI18n();
  const online = useOnline();
  const [restored, setRestored] = useState(false);
  const wasOffline = useRef(false);
  useEffect(() => {
    if (!online) { wasOffline.current = true; setRestored(false); return; }
    if (!wasOffline.current) return;
    wasOffline.current = false;
    setRestored(true);
    const timer = window.setTimeout(() => setRestored(false), 4000);
    return () => window.clearTimeout(timer);
  }, [online]);

  return (
    <div role="status" aria-live="polite">
      {!online && (
        <p className="m-0 flex items-start justify-center gap-2 border-b border-warn-line bg-warn-soft px-4 py-2.5 text-center text-sm font-semibold text-ink">
          <Icon name="cloudOff" className="mt-0.5 size-4 shrink-0 text-warn" />{t("common.offline")}
        </p>
      )}
      {online && restored && (
        <p className="m-0 flex items-center justify-center gap-2 border-b border-ok-line bg-ok-soft px-4 py-2 text-center text-sm font-semibold text-ink">
          <Icon name="success" className="size-4 shrink-0 text-ok" />{t("common.online")}
        </p>
      )}
    </div>
  );
}

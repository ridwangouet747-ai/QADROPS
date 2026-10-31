"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { TurnstileAction } from "@/lib/auth/turnstile";

/** Clé publique du widget ; absente en développement local sans Turnstile (le serveur l'accepte alors). */
export const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";

type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};
declare global { interface Window { turnstile?: TurnstileApi } }

let scriptPromise: Promise<TurnstileApi> | undefined;

/** Charge une seule fois le script officiel en rendu explicite (le formulaire est créé par React). */
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile")));
    script.onerror = () => { scriptPromise = undefined; script.remove(); reject(new Error("turnstile")); };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/**
 * Vérification de sécurité Cloudflare Turnstile. Le jeton obtenu est transmis au parent, qui l'envoie
 * au serveur ; il n'est jamais stocké. Changer `resetKey` relance le widget (un jeton ne sert qu'une fois).
 */
export function TurnstileWidget({ action, onToken, resetKey = 0 }: { action: TurnstileAction; onToken: (token: string | null) => void; resetKey?: number }) {
  const { t, locale } = useI18n();
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const tokenCallback = useRef(onToken);
  const [state, setState] = useState<"loading" | "ready" | "verified" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => { tokenCallback.current = onToken; }, [onToken]);

  useEffect(() => {
    if (!turnstileSiteKey) return;
    let cancelled = false;
    loadTurnstile().then((api) => {
      if (cancelled || !container.current) return;
      widgetId.current = api.render(container.current, {
        sitekey: turnstileSiteKey,
        action,
        language: locale,
        theme: "light",
        size: "flexible",
        appearance: "always",
        callback: (token: string) => { setState("verified"); tokenCallback.current(token); },
        "expired-callback": () => { setState("ready"); tokenCallback.current(null); api.reset(widgetId.current!); },
        "timeout-callback": () => { setState("ready"); tokenCallback.current(null); api.reset(widgetId.current!); },
        "error-callback": () => { setState("error"); tokenCallback.current(null); return true; },
        "before-interactive-callback": () => setState("ready"),
      });
      setState((current) => (current === "loading" ? "ready" : current));
    }).catch(() => { if (!cancelled) setState("error"); });
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [action, locale, attempt]);

  // Après chaque envoi du formulaire, le jeton est consommé côté serveur : on en redemande un.
  useEffect(() => {
    if (resetKey === 0 || !widgetId.current || !window.turnstile) return;
    tokenCallback.current(null);
    setState("ready");
    window.turnstile.reset(widgetId.current);
  }, [resetKey]);

  if (!turnstileSiteKey) return null;
  return (
    <div className="grid gap-2" aria-live="polite">
      <span className="text-sm font-semibold text-ink">{t("auth.turnstile.label")}</span>
      <div ref={container} className="min-h-[65px] w-full overflow-hidden rounded-[14px]" />
      {state === "loading" && <p className="m-0 text-xs text-fg-muted">{t("auth.turnstile.loading")}</p>}
      {state === "error" && (
        <div className="flex flex-wrap items-center gap-2 rounded-[14px] border border-danger-line bg-danger-soft p-3 text-sm text-danger">
          <Icon name="warning" className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">{t("auth.turnstile.error")}</span>
          <Button variant="secondary" onClick={() => { setState("loading"); setAttempt((value) => value + 1); }}>{t("auth.turnstile.retry")}</Button>
        </div>
      )}
    </div>
  );
}

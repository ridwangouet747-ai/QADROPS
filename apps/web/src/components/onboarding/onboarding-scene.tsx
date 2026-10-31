"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { cn } from "@/components/ui/cn";
import { chooseSceneMode, type SceneMode, type ScenePlan, type SceneStage } from "@/lib/onboarding/wizard";
import { ShopStatic } from "./shop-static";

/* Le code 3D (three, React Three Fiber) et le lecteur Lottie ne sont téléchargés que sur cette page, et seulement si l'appareil les utilise. */
const ShopScene3D = dynamic(() => import("./shop-scene-3d"), { ssr: false });
const ShopLottie = dynamic(() => import("./shop-lottie"), { ssr: false });

type NavigatorSignals = Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };

function webglAvailable() {
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    const ok = Boolean(context);
    (context as WebGLRenderingContext | null)?.getExtension("WEBGL_lose_context")?.loseContext();
    return ok;
  } catch { return false; }
}

/** Lit les capacités observées (pas l'agent utilisateur) et choisit le rendu. */
function detectMode(): SceneMode {
  // Développement uniquement : ?scene=3d|lottie|static pour vérifier chaque rendu.
  const forced = process.env.NODE_ENV !== "production" ? new URLSearchParams(location.search).get("scene") : null;
  if (forced === "3d" || forced === "lottie" || forced === "static") return forced;
  const nav = navigator as NavigatorSignals;
  return chooseSceneMode({
    webgl: webglAvailable(), reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches, saveData: Boolean(nav.connection?.saveData),
    width: window.innerWidth, deviceMemory: nav.deviceMemory, hardwareConcurrency: nav.hardwareConcurrency, coarsePointer: matchMedia("(pointer: coarse)").matches && !matchMedia("(pointer: fine)").matches,
  });
}

/**
 * Scène décorative de l'inscription. Rendu initial statique (aucune attente pour remplir le
 * formulaire), puis montée en gamme après le premier affichage selon l'appareil. Toute erreur de
 * chargement ou perte de contexte WebGL redescend vers un rendu plus léger, jamais vers un blocage.
 */
export function OnboardingScene({ plan, stage, logo, className }: { plan: ScenePlan; stage: SceneStage; logo: string; className?: string }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<SceneMode>("static");
  const [tier, setTier] = useState<"high" | "low">("low");
  useEffect(() => {
    const decide = () => {
      const chosen = detectMode();
      const nav = navigator as NavigatorSignals;
      setTier((nav.deviceMemory ?? 8) >= 8 && (nav.hardwareConcurrency ?? 8) >= 8 ? "high" : "low");
      setMode(chosen);
    };
    const idle = (window as Window & { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
    if (idle) idle(decide, { timeout: 1200 }); else setTimeout(decide, 300);
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => decide();
    motion.addEventListener("change", onChange);
    return () => motion.removeEventListener("change", onChange);
  }, []);

  return (
    <div className={cn("isolate overflow-hidden", className)} data-scene-mode={mode}>
      <div aria-hidden="true" className="absolute inset-0">
        {mode === "3d" ? <ShopScene3D plan={plan} stage={stage} tier={tier} logo={logo} onContextLost={() => setMode("lottie")} />
          : mode === "lottie" ? <ShopLottie plan={plan} stage={stage} logo={logo} onFailure={() => setMode("static")} />
          : <ShopStatic plan={plan} logo={logo} />}
      </div>
      <p className="sr-only">{t("wizard.scene.label")}</p>
    </div>
  );
}

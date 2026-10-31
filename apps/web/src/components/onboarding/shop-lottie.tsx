"use client";

/*
 * Animation Lottie (téléphones, appareils modestes, WebGL absent). Lecteur « light » (SVG seul,
 * ~45 Ko compressé), chargé à la demande ; l'animation est générée en code (aucun fichier JSON à
 * télécharger). Chaque étape joue sa séquence puis s'arrête : aucune boucle permanente.
 */
import { useEffect, useRef } from "react";
import type { AnimationItem } from "lottie-web";
import { buildShopLottie, lottieOverlays, lottieSegments } from "@/lib/onboarding/lottie-shop";
import type { Activity, ScenePlan, SceneStage } from "@/lib/onboarding/wizard";
import { cn } from "@/components/ui/cn";

export default function ShopLottie({ plan, stage, logo, onFailure }: { plan: ScenePlan; stage: SceneStage; logo: string; onFailure: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const animation = useRef<AnimationItem | null>(null);
  const reached = useRef(0);
  // Étape demandée, lue au chargement : l'utilisateur peut avancer avant que le lecteur soit prêt.
  const wanted = useRef(stage);
  wanted.current = stage;

  useEffect(() => {
    let cancelled = false;
    import("lottie-web/build/player/lottie_light").then(({ default: lottie }) => {
      if (cancelled || !container.current) return;
      animation.current = lottie.loadAnimation({
        container: container.current, renderer: "svg", loop: false, autoplay: false, animationData: buildShopLottie(),
        rendererSettings: { preserveAspectRatio: "xMidYMid meet", progressiveLoad: false },
      });
      animation.current.addEventListener("DOMLoaded", () => {
        const [, end] = lottieSegments[wanted.current];
        animation.current?.playSegments([0, end], true);
        reached.current = end;
      });
    }).catch(() => { if (!cancelled) onFailure(); });
    const pauseWhenHidden = () => { if (document.visibilityState !== "visible") animation.current?.pause(); };
    document.addEventListener("visibilitychange", pauseWhenHidden);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", pauseWhenHidden);
      animation.current?.destroy();
      animation.current = null;
    };
    // L'animation est créée une seule fois ; les étapes suivantes jouent seulement leur séquence.
  }, []);

  useEffect(() => {
    const item = animation.current;
    if (!item || !item.isLoaded) return;
    const [, end] = lottieSegments[stage];
    if (end > reached.current) item.playSegments([reached.current, end], true);
    else item.goToAndStop(end - 1, true);
    reached.current = end;
  }, [stage]);

  const activity: Activity = plan.activity ?? "general";
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="relative aspect-[4/3] w-full max-w-[560px]" data-activity={activity}>
        {/* Seul l'aménagement de l'activité choisie reste visible (Lottie impose display en ligne, d'où !important). */}
        <style>{`${(["hardware", "phones", "clothing", "general"] as const).map((key) => `[data-activity]:not([data-activity="${key}"]) .act-${key}`).join(",")}{display:none!important}
          ${plan.activity ? "" : "[data-activity] [class^='act-']{display:none!important}"}`}</style>
        <div ref={container} className="absolute inset-0" />
        <div aria-hidden="true" className={cn("absolute flex items-center justify-center overflow-hidden px-[2%] transition-opacity duration-500 motion-reduce:transition-none", plan.sign && plan.signText ? "opacity-100 delay-700" : "opacity-0")}
          style={{ left: `${lottieOverlays.sign.left + (plan.logo ? 6 : 0)}%`, top: `${lottieOverlays.sign.top}%`, width: `${lottieOverlays.sign.width - (plan.logo ? 6 : 0)}%`, height: `${lottieOverlays.sign.height}%` }}>
          <span dir="auto" className="truncate text-[clamp(0.6rem,2.6vw,0.95rem)] font-extrabold text-white">{plan.signText}</span>
        </div>
        {plan.logo && logo && (
          // eslint-disable-next-line @next/next/no-img-element -- data URL réduite à 256 px, affichée en petit
          <img src={logo} alt="" aria-hidden="true" className="absolute rounded-full bg-white object-contain p-[0.4%] transition-opacity duration-500"
            style={{ left: `${lottieOverlays.logo.left}%`, top: `${lottieOverlays.logo.top}%`, width: `${lottieOverlays.logo.width}%`, height: `${lottieOverlays.logo.height}%` }} />
        )}
      </div>
    </div>
  );
}

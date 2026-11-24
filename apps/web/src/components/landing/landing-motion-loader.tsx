"use client";

import { useEffect, useState, type ComponentType } from "react";
import { decorativeEffectsAllowed, whenPageIdle } from "./device-capability";

/**
 * Le mouvement au défilement (GSAP + ScrollTrigger, landing-motion.tsx) n'est plus dans le JavaScript du premier
 * affichage (mission performance du 2026-11-24) : il est téléchargé après le chargement de la page, au premier
 * moment de repos, et seulement sur un appareil et un réseau qui le supportent. Sinon la page reste statique,
 * exactement comme avec « mouvement réduit » : tout est visible.
 */
export function LandingMotionLoader() {
  const [Motion, setMotion] = useState<ComponentType | null>(null);
  useEffect(() => {
    if (!decorativeEffectsAllowed()) return;
    let cancelled = false;
    void whenPageIdle().then(() => (cancelled ? null : import("./landing-motion"))).then((module) => {
      if (module && !cancelled) setMotion(() => module.LandingMotion);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  return Motion ? <Motion /> : null;
}

"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP, ScrollTrigger);

/*
 * Le mouvement lié à la lecture (docs/design/direction-artistique.md § 6) : dans « Une journée à la
 * boutique », l'aiguille de l'horloge et la ligne de progression suivent le défilement. L'ouverture du hero
 * est en CSS (landing.css) pour ne pas dépendre du chargement du JavaScript.
 * Défilement natif (pas de Lenis). Avec `prefers-reduced-motion`, rien ne bouge et tout est visible.
 */
export function LandingMotion() {
  useGSAP(() => {
    const root = document.querySelector<HTMLElement>("[data-landing]");
    if (!root) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const track = document.querySelector("[data-day-track]");
      if (track) {
        root.dataset.day = "ready";
        const timeline = gsap.timeline({ scrollTrigger: { trigger: track, start: "top 62%", end: "bottom 62%", scrub: 0.6 } });
        timeline.fromTo("[data-day-progress]", { scaleY: 0 }, { scaleY: 1, ease: "none" }, 0)
          // 07:30 → 19:00 : l'aiguille des heures fait presque un tour (11 h 30 = 345°).
          .fromTo("[data-clock-hour]", { "--hour": "225deg" }, { "--hour": "570deg", ease: "none" }, 0)
          .fromTo("[data-clock-minute]", { "--minute": "180deg" }, { "--minute": `${180 + 360 * 11.5}deg`, ease: "none" }, 0);
        // Le moment lu est le dernier dont le haut a franchi la ligne de lecture (62 % de la hauteur) : il y
        // en a toujours un, même entre deux moments.
        const moments = gsap.utils.toArray<HTMLElement>("[data-moment]");
        let current = -2;
        const pick = () => {
          const line = window.innerHeight * 0.62;
          let index = 0;
          moments.forEach((moment, position) => { if (moment.getBoundingClientRect().top <= line) index = position; });
          if (index === current) return;
          current = index;
          moments.forEach((moment, position) => moment.classList.toggle("is-active", position === index));
        };
        ScrollTrigger.create({ trigger: track, start: "top bottom", end: "bottom top", onUpdate: pick, onRefresh: pick });
        pick();
        // Les sections au-dessus de la journée sont rendues à la demande (content-visibility, landing.css) :
        // leur hauteur réelle remplace l'estimation au premier affichage, ce qui déplace la journée.
        const content = document.getElementById("contenu");
        let refreshTimer: number | undefined;
        let lastHeight = content?.offsetHeight ?? 0;
        const resize = content ? new ResizeObserver(() => {
          if (content.offsetHeight === lastHeight) return;
          lastHeight = content.offsetHeight;
          window.clearTimeout(refreshTimer);
          refreshTimer = window.setTimeout(() => ScrollTrigger.refresh(), 150);
        }) : null;
        if (content) resize?.observe(content);
        return () => {
          resize?.disconnect();
          window.clearTimeout(refreshTimer);
          moments.forEach((moment) => moment.classList.remove("is-active"));
          delete root.dataset.day;
        };
      }
    });
    return () => media.revert();
  });
  return null;
}

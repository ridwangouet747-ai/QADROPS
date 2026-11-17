"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP, ScrollTrigger);

/*
 * Le mouvement lié à la lecture (docs/design/direction-artistique.md § 6). L'ouverture du hero est en CSS
 * (landing.css) pour ne pas dépendre du chargement du JavaScript. Défilement natif (pas de Lenis).
 * Avec `prefers-reduced-motion`, rien ne bouge et tout est visible.
 * - Journée à la boutique : l'aiguille de l'horloge et la ligne de progression suivent le défilement (toutes tailles).
 * - À partir de 1024 px seulement (Android modeste épargné) : léger parallaxe des photos des commerces, et profondeur
 *   des « vrais écrans » en pages superposées (la page recouverte recule et s'assombrit, la suivante se pose).
 */
export function LandingMotion() {
  useGSAP(() => {
    const root = document.querySelector<HTMLElement>("[data-landing]");
    if (!root) return;
    const media = gsap.matchMedia();

    media.add("(prefers-reduced-motion: no-preference)", () => {
      // Les sections hors écran sont rendues à la demande (content-visibility, landing.css) : leur hauteur réelle
      // remplace l'estimation au premier affichage, ce qui déplace tout ce qui suit. On recalcule alors les déclencheurs.
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

      const track = document.querySelector("[data-day-track]");
      const moments = gsap.utils.toArray<HTMLElement>("[data-moment]");
      if (track) {
        root.dataset.day = "ready";
        const timeline = gsap.timeline({ scrollTrigger: { trigger: track, start: "top 62%", end: "bottom 62%", scrub: 0.6 } });
        timeline.fromTo("[data-day-progress]", { scaleY: 0 }, { scaleY: 1, ease: "none" }, 0)
          // 07:30 → 19:00 : l'aiguille des heures fait presque un tour (11 h 30 = 345°).
          .fromTo("[data-clock-hour]", { "--hour": "225deg" }, { "--hour": "570deg", ease: "none" }, 0)
          .fromTo("[data-clock-minute]", { "--minute": "180deg" }, { "--minute": `${180 + 360 * 11.5}deg`, ease: "none" }, 0);
        // Le moment lu est le dernier dont le haut a franchi la ligne de lecture (62 % de la hauteur) : il y
        // en a toujours un, même entre deux moments.
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
      }

      return () => {
        resize?.disconnect();
        window.clearTimeout(refreshTimer);
        moments.forEach((moment) => moment.classList.remove("is-active"));
        delete root.dataset.day;
      };
    });

    media.add("(prefers-reduced-motion: no-preference) and (min-width: 1024px)", () => {
      // Photos des commerces : l'image, un peu agrandie, glisse dans son cadre pendant la traversée de l'écran.
      gsap.utils.toArray<HTMLElement>("[data-sector-photo]").forEach((photo) => {
        gsap.fromTo(photo, { yPercent: -5, scale: 1.12 }, { yPercent: 5, scale: 1.12, ease: "none", scrollTrigger: { trigger: photo.parentElement, start: "top bottom", end: "bottom top", scrub: true } });
      });
      // Cartes des commerces : elles se posent en léger basculement, une fois.
      const cards = gsap.utils.toArray<HTMLElement>("[data-sector-card]");
      if (cards.length) {
        gsap.from(cards, { y: 48, rotateX: 8, transformPerspective: 1200, transformOrigin: "50% 100%", opacity: 0, duration: 0.9, ease: "power3.out", stagger: 0.09, clearProps: "transform,opacity", scrollTrigger: { trigger: cards[0]!.parentElement, start: "top 82%", once: true } });
      }

      // Pages superposées : chaque page, en arrivant, se pose (bascule vers l'avant annulée) et repousse la précédente.
      const deckCards = gsap.utils.toArray<HTMLElement>("[data-deck-card]");
      const steps = gsap.utils.toArray<HTMLElement>("[data-deck-step]");
      if (deckCards.length) {
        root.dataset.deck = "ready";
        deckCards.forEach((card, index) => {
          const page = card.querySelector<HTMLElement>("[data-deck-page]");
          const next = deckCards[index + 1];
          if (page && index > 0) {
            gsap.fromTo(page, { rotateX: 9, y: 30 }, { rotateX: 0, y: 0, ease: "none", scrollTrigger: { trigger: card, start: "top bottom", end: "top 55%", scrub: 0.4 } });
          }
          if (page && next) {
            const shade = page.querySelector("[data-deck-shade]");
            const recede = gsap.timeline({ scrollTrigger: { trigger: next, start: "top 85%", end: () => `top ${parseFloat(getComputedStyle(next).top) || 120}px`, scrub: 0.4 } });
            recede.to(page, { scale: 0.93, ease: "none" }, 0);
            if (shade) recede.to(shade, { opacity: 0.22, ease: "none" }, 0);
          }
          // Repère de lecture : la page active est celle qui vient de se coller.
          ScrollTrigger.create({
            trigger: card, start: () => `top ${parseFloat(getComputedStyle(card).top) + 40 || 160}px`,
            onToggle: () => {
              const active = deckCards.filter((item) => item.getBoundingClientRect().top <= (parseFloat(getComputedStyle(item).top) || 120) + 41).length - 1;
              steps.forEach((step, position) => step.classList.toggle("is-active", position === Math.max(0, active)));
            },
          });
        });
        steps[0]?.classList.add("is-active");
      }
      return () => {
        steps.forEach((step) => step.classList.remove("is-active"));
        delete root.dataset.deck;
      };
    });

    return () => media.revert();
  });
  return null;
}

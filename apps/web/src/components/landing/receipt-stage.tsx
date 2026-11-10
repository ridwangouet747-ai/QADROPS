"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/components/ui/cn";
import { ReceiptPaper, type ReceiptData } from "./receipt";

type Tier = "high" | "low";

/**
 * Trois niveaux (docs/design/direction-artistique.md § 7) :
 * - ordinateur : ticket 3D complet ;
 * - téléphone capable : ticket 3D allégé (densité de pixels réduite, sans anticrénelage) ;
 * - sinon (WebGL2 absent, mouvement réduit, économie de données, appareil modeste) : ticket HTML seul.
 */
function detectTier(): Tier | null {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
  const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };
  if (nav.connection?.saveData) return null;
  if ((nav.deviceMemory ?? 4) < 2 || (nav.hardwareConcurrency ?? 4) < 4) return null;
  const probe = document.createElement("canvas");
  const gl = probe.getContext("webgl2");
  if (!gl) return null;
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return window.matchMedia("(min-width: 1024px)").matches ? "high" : "low";
}

export function ReceiptStage({ data, label, className }: { data: ReceiptData; label: string; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const element = host.current;
    const tier = element ? detectTier() : null;
    if (!element || !tier) return;
    let dispose: (() => void) | undefined;
    let cancelled = false;
    // La 3D n'est chargée que lorsque le ticket approche de l'écran : le premier affichage n'en dépend jamais.
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      import("./receipt-3d").then(({ mountReceipt3d }) => {
        const target = layer.current;
        if (cancelled || !target) return;
        // Un canvas neuf à chaque montage : un canvas dont le contexte WebGL a été libéré (démontage,
        // changement de langue, double montage du mode strict) ne peut plus en recréer un.
        const canvas = document.createElement("canvas");
        canvas.className = "block size-full";
        target.append(canvas);
        try {
          const release = mountReceipt3d(canvas, element, data, tier, () => { if (!cancelled) setLive(true); }, () => {
            if (cancelled) return;
            setLive(false);
            setVersion((value) => value + 1);
          });
          dispose = () => { release(); canvas.remove(); };
        } catch {
          canvas.remove(); // repli : le ticket HTML reste affiché
        }
      }).catch(() => { /* module non chargé : le ticket HTML reste affiché */ });
    }, { rootMargin: "200px" });
    observer.observe(element);
    return () => { cancelled = true; observer.disconnect(); dispose?.(); };
  }, [data, version]);

  return (
    <figure aria-label={label} className={cn("relative m-0", className)}>
      <div ref={host} className={cn("drop-shadow-[0_24px_30px_color-mix(in_srgb,var(--color-qadr-950)_35%,transparent)] transition-opacity duration-300", live && "opacity-0")}>
        <ReceiptPaper data={data} />
      </div>
      {/* Le ticket HTML reste dans le document (lu par les lecteurs d'écran) ; le canvas (créé au montage) n'est qu'une image. */}
      <div ref={layer} aria-hidden="true" className={cn("pointer-events-none absolute -inset-[20%] h-[140%] w-[140%] transition-opacity duration-500", live ? "opacity-100" : "opacity-0")} />
    </figure>
  );
}

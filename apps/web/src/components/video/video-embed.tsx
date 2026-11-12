"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { cn } from "@/components/ui/cn";
import { Icon } from "@/components/ui/icon";
import { embedUrl, videoRatios, watchUrl, type VideoRatio, type VideoSource } from "@/lib/video/source";

/*
 * Lecteur vidéo réutilisable (page publique, tutoriels, aide de l'inscription).
 *
 * - Rien n'est chargé avant le clic : ni lecteur YouTube ou Vimeo, ni fichier vidéo. Seule l'image de
 *   couverture est affichée (chargement différé), donc aucun coût pour le premier affichage de la page et
 *   aucune donnée envoyée à un tiers tant que le visiteur n'a pas choisi de lire.
 * - Jamais de lecture automatique : la vidéo ne démarre qu'après un clic (ou Entrée) sur le bouton.
 * - Sans source (`source` nul), le composant affiche un emplacement clairement marqué comme vide.
 * - Les textes sont fournis par l'appelant, déjà traduits (voir `messages/landing.ts`, clé `video`).
 */
export type VideoEmbedLabels = {
  /** Bouton de lecture, ex. « Lire la vidéo ». */
  play: string;
  /** Emplacement sans vidéo, ex. « La vidéo de démonstration arrive bientôt. » */
  placeholder: string;
  /** Lecture impossible. */
  error: string;
  retry: string;
  /** Lien de repli vers la vidéo hors du site. */
  openExternal: string;
  /** Avertissement affiché AVANT la lecture d'une vidéo hébergée chez un tiers (nom du service déjà inséré). */
  privacy?: string;
};

type Props = {
  source: VideoSource | null;
  /** Titre de la vidéo : nom accessible du bouton et du lecteur. */
  title: string;
  /** Image de couverture (chemin du site ou URL autorisée par next.config). */
  poster?: string;
  ratio?: VideoRatio;
  labels: VideoEmbedLabels;
  className?: string;
};

export function VideoEmbed({ source, title, poster, ratio = "16/9", labels, className }: Props) {
  const [state, setState] = useState<"idle" | "playing" | "error">("idle");
  const player = useRef<HTMLIFrameElement | HTMLVideoElement | null>(null);
  // Le clavier suit la vidéo : après le clic, le lecteur reçoit le focus à la place du bouton disparu.
  useEffect(() => { if (state === "playing") player.current?.focus(); }, [state]);

  // Le fond est ajouté par chaque état : `cn` ne départage pas deux classes de fond concurrentes.
  const frame = cn("relative isolate w-full overflow-hidden rounded-[1.5rem]", videoRatios[ratio]);
  const cover = poster ? <Image src={poster} alt="" fill sizes="(min-width: 1024px) 960px, 100vw" className="object-cover object-top" /> : <span aria-hidden="true" className="absolute inset-0 bg-night-gradient" />;

  if (!source) {
    return (
      <div className={className}>
        <div role="img" aria-label={labels.placeholder} className={cn(frame, "grid place-items-center border-2 border-dashed border-qadr-300 bg-qadr-50")}>
          <span className="flex max-w-sm flex-col items-center gap-3 px-6 text-center">
            <span className="grid size-14 place-items-center rounded-full bg-qadr-100 text-qadr-600"><Icon name="play" className="size-6" /></span>
            <span className="text-[0.98rem] font-semibold text-fg-muted">{labels.placeholder}</span>
          </span>
        </div>
      </div>
    );
  }

  const external = source.kind !== "file";
  return (
    <div className={className}>
      <div className={cn(frame, "bg-qadr-950")}>
        {state === "idle" && (
          <button type="button" onClick={() => setState("playing")} aria-label={`${labels.play} : ${title}`}
            className="group absolute inset-0 grid cursor-pointer appearance-none place-items-center border-0 bg-transparent p-0 focus-visible:outline-4 focus-visible:-outline-offset-4 focus-visible:outline-qadr-300">
            {cover}
            <span aria-hidden="true" className="absolute inset-0 bg-qadr-950/35 transition-colors duration-200 group-hover:bg-qadr-950/20" />
            <span className="relative flex flex-col items-center gap-3">
              <span className="grid size-16 place-items-center rounded-full bg-white text-qadr-600 shadow-raised transition-transform duration-200 group-hover:scale-105 group-active:scale-95 sm:size-20">
                <Icon name="play" className="size-7 translate-x-0.5 sm:size-8" />
              </span>
              <span className="rounded-full bg-qadr-950/80 px-4 py-1.5 text-[0.95rem] font-semibold text-white">{labels.play}</span>
            </span>
          </button>
        )}
        {state === "playing" && external && (
          <iframe ref={(node) => { player.current = node; }} src={embedUrl(source)} title={title} tabIndex={0}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups" className="absolute inset-0 size-full border-0" />
        )}
        {state === "playing" && !external && (
          // Lecture lancée par le clic du visiteur : `autoPlay` ne joue donc jamais une vidéo non demandée.
          <video ref={(node) => { player.current = node; }} controls autoPlay playsInline preload="metadata" poster={poster} aria-label={title} tabIndex={0}
            onError={() => setState("error")} className="absolute inset-0 size-full bg-black object-contain">
            <source src={source.src} type={source.type} onError={() => setState("error")} />
          </video>
        )}
        {state === "error" && (
          <div role="alert" className="absolute inset-0 grid place-items-center bg-qadr-950 px-6 text-center text-white">
            <div className="flex max-w-sm flex-col items-center gap-4">
              <Icon name="info" className="size-7 text-qadr-300" />
              <p className="m-0 text-[0.98rem] leading-relaxed">{labels.error}</p>
              <button type="button" onClick={() => setState("playing")} className="inline-flex min-h-11 cursor-pointer appearance-none items-center rounded-full border-0 bg-white px-5 font-semibold text-qadr-900 hover:bg-qadr-100 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-qadr-300">{labels.retry}</button>
            </div>
          </div>
        )}
      </div>
      {(external || state === "error") && (
        <p className="m-0 mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.86rem] text-fg-subtle">
          {external && labels.privacy && <span>{labels.privacy}</span>}
          {(state !== "idle") && <a href={watchUrl(source)} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-strong underline underline-offset-4">{labels.openExternal}</a>}
        </p>
      )}
    </div>
  );
}

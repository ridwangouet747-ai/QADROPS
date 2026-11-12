import { parseVideoUrl, type VideoSource } from "@/lib/video/source";

/*
 * Vidéo de démonstration de la page publique. L'adresse vient de `QADR_DEMO_VIDEO_URL` (YouTube, Vimeo, ou
 * fichier .mp4 / .webm en HTTPS ou servi par le site) : elle se change sans toucher au code.
 *
 * Sans adresse valide, la section n'est PAS affichée en production : la page ne montre jamais une vidéo qui
 * n'existe pas. Hors production (aperçu, développement), un emplacement vide clairement marqué la remplace
 * pour que la mise en page reste vérifiable.
 */
export type DemoVideo = { status: "ready"; source: VideoSource } | { status: "placeholder" } | { status: "hidden" };

export function readDemoVideo(environment: { QADR_DEMO_VIDEO_URL?: string; NODE_ENV?: string } = process.env): DemoVideo {
  const source = parseVideoUrl(environment.QADR_DEMO_VIDEO_URL);
  if (source) return { status: "ready", source };
  return environment.NODE_ENV === "production" ? { status: "hidden" } : { status: "placeholder" };
}

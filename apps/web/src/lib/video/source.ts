/*
 * Sources vidéo acceptées par `components/video/video-embed.tsx`. Fonctions pures, testées sans navigateur.
 * Une adresse inconnue n'est jamais transformée en lecteur : `parseVideoUrl` répond `null` et le composant
 * affiche son emplacement vide. Aucun identifiant n'est recopié tel quel dans une URL sans contrôle de forme.
 */
export type VideoProvider = "youtube" | "vimeo";
export type VideoSource =
  | { kind: "youtube"; id: string }
  | { kind: "vimeo"; id: string }
  | { kind: "file"; src: string; type: "video/mp4" | "video/webm" };

const youtubeId = /^[A-Za-z0-9_-]{11}$/;
const vimeoId = /^[0-9]{6,12}$/;
const fileTypes = { mp4: "video/mp4", webm: "video/webm" } as const;

function fileSource(path: string, src: string): VideoSource | null {
  const extension = /\.(mp4|webm)$/i.exec(path)?.[1]?.toLowerCase() as keyof typeof fileTypes | undefined;
  return extension ? { kind: "file", src, type: fileTypes[extension] } : null;
}

/**
 * Reconnaît une page ou un lecteur YouTube (`watch?v=`, `youtu.be/`, `/embed/`, `/shorts/`), une vidéo Vimeo,
 * ou un fichier `.mp4` / `.webm` servi en HTTPS ou par le site lui-même (`/videos/demo.mp4`).
 */
export function parseVideoUrl(input: string | null | undefined): VideoSource | null {
  const value = input?.trim();
  if (!value) return null;
  // Fichier du site : chemin absolu simple, jamais `//hôte` ni de remontée de dossier.
  if (value.startsWith("/")) return /^\/(?!\/)[A-Za-z0-9/_.-]+$/.test(value) && !value.includes("..") ? fileSource(value, value) : null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const segments = url.pathname.split("/").filter(Boolean);
  if (host === "youtu.be") return youtubeId.test(segments[0] ?? "") ? { kind: "youtube", id: segments[0]! } : null;
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    const id = segments[0] === "watch" ? url.searchParams.get("v") : ["embed", "shorts", "live"].includes(segments[0] ?? "") ? segments[1] : null;
    return id && youtubeId.test(id) ? { kind: "youtube", id } : null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = segments[0] === "video" ? segments[1] : segments[0];
    return id && vimeoId.test(id) ? { kind: "vimeo", id } : null;
  }
  return fileSource(url.pathname, url.toString());
}

/**
 * Adresse du lecteur intégré. YouTube passe par `youtube-nocookie.com` (aucun cookie avant la lecture) et
 * Vimeo reçoit `dnt=1`. `autoplay=1` n'est posé que parce que le lecteur n'est créé qu'après un clic.
 */
export function embedUrl(source: Extract<VideoSource, { kind: VideoProvider }>): string {
  if (source.kind === "youtube") return `https://www.youtube-nocookie.com/embed/${source.id}?autoplay=1&rel=0&playsinline=1`;
  return `https://player.vimeo.com/video/${source.id}?autoplay=1&dnt=1&playsinline=1`;
}

/** Page publique de la vidéo, proposée si le lecteur intégré ne s'affiche pas. */
export function watchUrl(source: VideoSource): string {
  if (source.kind === "youtube") return `https://www.youtube.com/watch?v=${source.id}`;
  if (source.kind === "vimeo") return `https://vimeo.com/${source.id}`;
  return source.src;
}

export const providerName: Record<VideoProvider, string> = { youtube: "YouTube", vimeo: "Vimeo" };

export const videoRatios = { "16/9": "aspect-video", "9/16": "aspect-[9/16]", "1/1": "aspect-square", "4/3": "aspect-[4/3]" } as const;
export type VideoRatio = keyof typeof videoRatios;

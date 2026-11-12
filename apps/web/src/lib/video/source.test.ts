import { describe, expect, it } from "vitest";
import { embedUrl, parseVideoUrl, watchUrl } from "./source";

describe("sources vidéo", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?si=abc", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ])("reconnaît une vidéo YouTube : %s", (url, id) => {
    expect(parseVideoUrl(url)).toEqual({ kind: "youtube", id });
  });

  it.each([
    ["https://vimeo.com/123456789", "123456789"],
    ["https://player.vimeo.com/video/123456789?h=abc", "123456789"],
  ])("reconnaît une vidéo Vimeo : %s", (url, id) => {
    expect(parseVideoUrl(url)).toEqual({ kind: "vimeo", id });
  });

  it("reconnaît un fichier du site ou un fichier distant en HTTPS", () => {
    expect(parseVideoUrl("/videos/demo.mp4")).toEqual({ kind: "file", src: "/videos/demo.mp4", type: "video/mp4" });
    expect(parseVideoUrl("https://cdn.exemple.test/films/demo.WEBM")).toEqual({ kind: "file", src: "https://cdn.exemple.test/films/demo.WEBM", type: "video/webm" });
  });

  it.each([
    ["", "vide"],
    ["   ", "espaces"],
    ["http://www.youtube.com/watch?v=dQw4w9WgXcQ", "HTTP sans chiffrement"],
    ["https://www.youtube.com/watch?v=trop-court", "identifiant YouTube mal formé"],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ\"><script>", "identifiant YouTube suivi d'une injection"],
    ["https://vimeo.com/channels/staffpicks", "page Vimeo sans identifiant"],
    ["https://exemple.test/page.html", "page quelconque"],
    ["javascript:alert(1)", "schéma javascript"],
    ["//exemple.test/demo.mp4", "adresse sans schéma"],
    ["/../secret/demo.mp4", "remontée de dossier"],
    ["https://user:secret@cdn.exemple.test/demo.mp4", "identifiants dans l'adresse"],
    ["https://youtube.com.exemple.test/watch?v=dQw4w9WgXcQ", "faux domaine YouTube"],
  ])("refuse %s (%s)", (url) => {
    expect(parseVideoUrl(url)).toBeNull();
  });

  it("ne reçoit ni null ni undefined comme une source", () => {
    expect(parseVideoUrl(null)).toBeNull();
    expect(parseVideoUrl(undefined)).toBeNull();
  });

  it("construit un lecteur respectueux de la vie privée", () => {
    expect(embedUrl({ kind: "youtube", id: "dQw4w9WgXcQ" })).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&playsinline=1");
    expect(embedUrl({ kind: "vimeo", id: "123456789" })).toBe("https://player.vimeo.com/video/123456789?autoplay=1&dnt=1&playsinline=1");
  });

  it("donne la page publique de la vidéo comme solution de repli", () => {
    expect(watchUrl({ kind: "youtube", id: "dQw4w9WgXcQ" })).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(watchUrl({ kind: "vimeo", id: "123456789" })).toBe("https://vimeo.com/123456789");
    expect(watchUrl({ kind: "file", src: "/videos/demo.mp4", type: "video/mp4" })).toBe("/videos/demo.mp4");
  });
});

import type { MetadataRoute } from "next";

/**
 * Manifest de l'application installable (mission 11, phase 2). Statique : le nom de marque est le même
 * dans les trois langues, et l'écran de démarrage renvoie vers la connexion si la session a expiré.
 * Icônes : `node scripts/generate-pwa-icons.mjs`.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "QADR OPS",
    short_name: "QADR OPS",
    description: "Caisse, stock, ventes et rapports pour votre commerce.",
    lang: "fr",
    start_url: "/business/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f5f7fa",
    theme_color: "#03108e",
    categories: ["business", "finance", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Caisse", short_name: "Caisse", url: "/business/pos", icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: "Stock", short_name: "Stock", url: "/business/stock", icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] },
    ],
  };
}

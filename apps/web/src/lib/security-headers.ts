export type HeaderRule = { source: string; headers: { key: string; value: string }[] };

/** CSP appliquée : directives sans risque pour les scripts en ligne de Next.js (voir plus bas). */
export const enforcedContentSecurityPolicy = "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'";

/**
 * Politique complète, envoyée en `Content-Security-Policy-Report-Only` : le navigateur signale ce qu'elle
 * bloquerait (console des outils de développement) sans rien bloquer. Elle prépare le passage à une CSP
 * appliquée. Aucun point de collecte des rapports n'existe : pas de `report-uri` ni de `report-to`.
 *
 * Inventaire de ce que le navigateur charge réellement (2026-11-12) :
 * - scripts : ceux de Next.js (même origine) ET des scripts en ligne sans nonce (données de rendu, hydratation).
 *   D'où `'unsafe-inline'` dans `script-src` : un nonce exigerait un rendu dynamique de chaque page par le
 *   proxy, ce qui n'est pas fait. `'unsafe-eval'` seulement hors production (rechargement à chaud de `next dev`).
 *   Turnstile : `https://challenges.cloudflare.com/turnstile/v0/api.js` (components/auth/turnstile-widget.tsx).
 *   Three.js, GSAP et Lottie (`lottie_light`, sans `eval`) sont empaquetés : même origine.
 * - styles : feuilles de Next.js et attributs `style` posés par React, GSAP et Three.js → `'unsafe-inline'`.
 * - images : même origine (`/_next/image`, icônes, captures), logos des commerces en `data:` (lib/domain/account.ts),
 *   trames et aperçus d'impression dessinés par le navigateur (`blob:`, `data:`).
 * - polices : `next/font` les sert depuis le site.
 * - connexions : API du site ; Sentry navigateur à la première erreur (ingestion `*.ingest[.us|.de].sentry.io`,
 *   lib/observability/client-errors.ts) ; service d'impression local sur CET ordinateur
 *   (`http://127.0.0.1:<port>` ou `http://localhost:<port>`, lib/printing/agent-client.ts ; l'adresse `[::1]`
 *   acceptée par le client ne peut pas s'écrire dans une CSP et serait signalée).
 * - cadres : Turnstile, lecteurs YouTube (`youtube-nocookie.com`) et Vimeo créés après un clic (lib/video/source.ts).
 * - médias : fichier vidéo de démonstration servi par le site ou en HTTPS (`QADR_DEMO_VIDEO_URL`).
 * - service worker `public/sw.js` et manifeste `src/app/manifest.ts` : même origine.
 * - URL signées R2 : lues par le serveur ou ouvertes par navigation (téléchargement), jamais chargées par une page.
 * - exports (CSV, XLSX, PDF) : liens `blob:` téléchargés, hors CSP.
 */
export function reportOnlyContentSecurityPolicy(isProduction: boolean) {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(isProduction ? [] : ["'unsafe-eval'"]), "https://challenges.cloudflare.com"],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", "https://*.ingest.sentry.io", "https://*.ingest.us.sentry.io", "https://*.ingest.de.sentry.io", "http://127.0.0.1:*", "http://localhost:*"],
    "media-src": ["'self'", "https:"],
    "frame-src": ["https://challenges.cloudflare.com", "https://www.youtube-nocookie.com", "https://player.vimeo.com"],
    "worker-src": ["'self'"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(directives).map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}

/**
 * En-têtes HTTP appliqués par `next.config.ts` (guide Next.js « progressive-web-apps », § sécurité).
 * La CSP se limite volontairement aux directives sans risque pour les scripts en ligne de Next.js,
 * Turnstile et Sentry : interdiction d'être affiché dans un cadre, de changer `<base>`,
 * de charger des plugins et de soumettre un formulaire ailleurs. HSTS seulement en production.
 */
export function securityHeaderRules(isProduction: boolean): HeaderRule[] {
  const global = [
    { key: "Content-Security-Policy", value: enforcedContentSecurityPolicy },
    { key: "Content-Security-Policy-Report-Only", value: reportOnlyContentSecurityPolicy(isProduction) },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // Caméra gardée pour Qadr Capture (photo des cahiers), le reste coupé.
    { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
    ...(isProduction ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
  ];
  return [
    { source: "/(.*)", headers: global },
    {
      source: "/sw.js",
      headers: [
        { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
      ],
    },
  ];
}

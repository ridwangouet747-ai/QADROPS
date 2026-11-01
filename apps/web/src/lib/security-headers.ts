export type HeaderRule = { source: string; headers: { key: string; value: string }[] };

/**
 * En-têtes HTTP appliqués par `next.config.ts` (guide Next.js « progressive-web-apps », § sécurité).
 * La CSP se limite volontairement aux directives sans risque pour les scripts en ligne de Next.js,
 * Turnstile, Sentry et PostHog : interdiction d'être affiché dans un cadre, de changer `<base>`,
 * de charger des plugins et de soumettre un formulaire ailleurs. HSTS seulement en production.
 */
export function securityHeaderRules(isProduction: boolean): HeaderRule[] {
  const global = [
    { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
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

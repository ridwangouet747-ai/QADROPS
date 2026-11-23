import type { NextConfig } from "next";
import { canonicalHostRedirects } from "./src/lib/canonical-host";
import { securityHeaderRules } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  headers: async () => securityHeaderRules(process.env.NODE_ENV === "production"),
  // Production : une seule adresse, celle de BETTER_AUTH_URL (Turnstile, origine, cookies) — canonical-host.ts.
  redirects: async () => canonicalHostRedirects(),
  distDir: process.env.NODE_ENV === "development" && process.env.QADR_PREVIEW_MODE === "true" ? ".next-preview" : ".next",
  outputFileTracingRoot: process.cwd(),
  // PGlite (preview mode only) loads its WASM/data files from `new URL(..., import.meta.url)`; webpack bundling
  // breaks that path ("Received an instance of URL"), so it must be loaded with Node's native resolution.
  serverExternalPackages: ["@electric-sql/pglite"],
  // Navigateur : Sentry n'envoie aucune trace (tracesSampleRate 0, instrumentation-client.ts) ; ces constantes
  // retirent du fragment partagé le code de traçage et de débogage qu'il chargeait quand même (mesures :
  // docs/engineering/mission-performance-2026-11-21.md). Les erreurs restent signalées ; le serveur est inchangé.
  webpack: (config, { isServer, webpack }) => {
    if (!isServer) config.plugins.push(new webpack.DefinePlugin({ __SENTRY_DEBUG__: false, __SENTRY_TRACING__: false }));
    return config;
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;

import type { Server } from "node:http";

/** Types de `gateway.mjs`, pour le test d'intégration de `apps/web` (TypeScript strict, `allowJs: false`). */
export declare const WEBHOOK_PATH: "/api/webhooks/geniuspay";
export declare const MAX_BODY_BYTES: number;
export declare const FORWARDED_HEADERS: readonly string[];
export declare function parseUpstream(raw: string): URL;
export declare function createGateway(options: {
  upstream: string;
  log?: (entry: object) => void;
  maxBodyBytes?: number;
  upstreamTimeoutMs?: number;
  rateLimit?: { limit: number; windowMs: number };
  now?: () => number;
}): { server: Server; target: URL };

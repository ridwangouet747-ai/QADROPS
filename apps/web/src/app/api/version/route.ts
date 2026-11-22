import { createHash } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Identifiant opaque du déploiement en cours (empreinte, jamais l'identifiant Vercel ni le commit en clair).
 * Le navigateur le compare à celui qu'il a vu au chargement pour proposer « Actualiser la page » après une mise
 * en production (components/pwa/update-notice.tsx) ; il ne force jamais le rechargement. Aucune donnée, aucune base.
 */
export function GET() {
  const source = process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "local";
  const version = createHash("sha256").update(`qadr-ops:${source}`).digest("hex").slice(0, 16);
  return Response.json({ version }, { headers: { "cache-control": "no-store" } });
}

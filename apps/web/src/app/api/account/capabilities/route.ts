import { emailCapabilities } from "@/lib/auth/server";

export const runtime = "nodejs";

/** Fonctions qui dépendent d'un fournisseur externe : l'interface ne promet jamais un e-mail qui ne part pas. */
export function GET() {
  return Response.json(emailCapabilities(), { headers: { "cache-control": "no-store" } });
}

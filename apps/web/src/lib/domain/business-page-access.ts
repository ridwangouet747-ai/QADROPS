import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/server";
import { getDatabase } from "@/lib/db/client";
import { isLocalPreview } from "@/lib/preview/mode";
import { assertActiveMembership } from "./business-context";
import { commercialAccess } from "./commercial-access";

/**
 * Garde serveur des pages de gestion `/business/*` (mission CTO du 2026-11-14). Une URL saisie à la main, un
 * favori ou un ancien lien ne montre jamais l'espace de gestion d'un commerce sans droit d'usage : la page
 * redirige vers le suivi d'abonnement. Les API appliquent la même règle (`getBusinessContext`), la page n'est
 * qu'un confort. Les pages d'abonnement, de retour de paiement et d'installation n'appellent pas cette garde.
 */
export async function requireBusinessPageAccess() {
  if (isLocalPreview()) return;
  const requestHeaders = await headers();
  const session = await (await getAuth()).api.getSession({ headers: requestHeaders });
  if (!session) redirect("/login");
  const businessId = session.session.activeOrganizationId;
  if (!businessId) redirect("/select-business");
  const db = getDatabase();
  const reachable = await assertActiveMembership(db, businessId, session.user.id).then(() => true, () => false);
  if (!reachable) redirect("/select-business");
  if (!(await commercialAccess(db, businessId)).open) redirect("/business/subscription");
}

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/server";
import { getDatabase } from "@/lib/db/client";
import { isLocalPreview } from "@/lib/preview/mode";
import { assertActiveMembership } from "./business-context";
import { commercialAccess } from "./commercial-access";
import { isPlatformOwnerAccount } from "./platform-owner-separation";

/**
 * Garde serveur des pages de gestion `/business/*` (mission CTO du 2026-11-14). Une URL saisie à la main, un
 * favori ou un ancien lien ne montre jamais l'espace de gestion d'un commerce sans droit d'usage : la page
 * redirige vers le suivi d'abonnement. Les API appliquent la même règle (`getBusinessContext`), la page n'est
 * qu'un confort. Les pages d'abonnement, de retour de paiement et d'installation n'appellent pas cette garde.
 *
 * Renvoie le rôle déjà lu pour l'accès (mission performance du 2026-11-22) : la page le passe à l'en-tête comme
 * premier affichage, ce qui évite que les boutons réservés n'apparaissent qu'après `/api/account/me` et ne
 * décalent la page (CLS 0,19 mesuré sur les produits). Simple indication d'affichage : chaque API revérifie le rôle.
 */
export async function requireBusinessPageAccess(): Promise<string | null> {
  if (isLocalPreview()) return null;
  const requestHeaders = await headers();
  const session = await (await getAuth()).api.getSession({ headers: requestHeaders });
  if (!session) redirect("/login");
  const businessId = session.session.activeOrganizationId;
  if (!businessId) redirect("/select-business");
  const db = getDatabase();
  if (await isPlatformOwnerAccount(db, session.user.id)) redirect("/login");
  const role = await assertActiveMembership(db, businessId, session.user.id).then((value) => value, () => null);
  if (!role) redirect("/select-business");
  if (!(await commercialAccess(db, businessId)).open) redirect("/business/subscription");
  return role;
}

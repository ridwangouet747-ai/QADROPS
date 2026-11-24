import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/server";
import { getDatabase } from "@/lib/db/client";
import { isLocalPreview } from "@/lib/preview/mode";
import { assertActiveMembership } from "./business-context";
import { commercialAccess } from "./commercial-access";
import { isPlatformOwnerAccount } from "./platform-owner-separation";

/*
 * Lectures partagées par la mise en page `/business` et la garde de la page pendant UNE requête (`cache` de React) :
 * au premier chargement, l'en-tête et la page ne relisent pas deux fois la session ni l'appartenance.
 */
const pageSession = cache(async () => (await getAuth()).api.getSession({ headers: await headers() }));
const pageMembershipRole = cache(async (businessId: string, userId: string) =>
  assertActiveMembership(getDatabase(), businessId, userId).then((value) => value, () => null));

/**
 * État affiché par l'en-tête persistant de l'espace commerçant (app/business/layout.tsx) : rôle pour les menus et
 * portée des données gardées en mémoire de l'onglet (lib/client/data-cache.ts). Ne redirige jamais : la garde de
 * chaque page décide. Simple indication d'affichage ; chaque API revérifie tout.
 */
export async function readBusinessShellState(): Promise<{ role: string | null; scope: string | null }> {
  if (isLocalPreview()) return { role: null, scope: null };
  const session = await pageSession();
  const businessId = session?.session.activeOrganizationId;
  if (!session || !businessId) return { role: null, scope: null };
  const role = await pageMembershipRole(businessId, session.user.id);
  return { role, scope: role ? `${session.user.id}:${businessId}` : null };
}

/**
 * Garde serveur des pages de gestion `/business/*` (mission CTO du 2026-11-14). Une URL saisie à la main, un
 * favori ou un ancien lien ne montre jamais l'espace de gestion d'un commerce sans droit d'usage : la page
 * redirige vers le suivi d'abonnement. Les API appliquent la même règle (`getBusinessContext`), la page n'est
 * qu'un confort. Les pages d'abonnement, de retour de paiement et d'installation n'appellent pas cette garde.
 *
 * Renvoie le rôle déjà lu pour l'accès (mission performance du 2026-11-22). Simple indication d'affichage :
 * chaque API revérifie le rôle.
 */
export async function requireBusinessPageAccess(): Promise<string | null> {
  if (isLocalPreview()) return null;
  const session = await pageSession();
  if (!session) redirect("/login");
  const businessId = session.session.activeOrganizationId;
  if (!businessId) redirect("/select-business");
  const db = getDatabase();
  // Lectures indépendantes lancées ensemble, évaluées dans l'ordre d'origine (mêmes redirections, même priorité).
  const [owner, role, access] = await Promise.all([
    isPlatformOwnerAccount(db, session.user.id),
    pageMembershipRole(businessId, session.user.id),
    commercialAccess(db, businessId).then((value) => value, () => null),
  ]);
  if (owner) redirect("/login");
  if (!role) redirect("/select-business");
  if (!(access ?? await commercialAccess(db, businessId)).open) redirect("/business/subscription");
  return role;
}

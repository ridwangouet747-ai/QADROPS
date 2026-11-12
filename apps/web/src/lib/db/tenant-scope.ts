import { sql } from "drizzle-orm";
import type { CommercialDatabase } from "@/lib/domain/commercial";

/**
 * Isolation des commerces par PostgreSQL lui-même (RLS, migration 0025, docs/security/production-security-audit.md § 4).
 *
 * `withTenantScope(db, businessId, work)` ouvre une transaction, y passe dans le rôle `qadr_tenant` et fixe
 * `qadr.business_id`, puis exécute `work`. Dans cette transaction, PostgreSQL :
 * - ne renvoie que les lignes du commerce `businessId`, même si une requête oublie son filtre `business_id` ;
 * - refuse d'écrire une ligne d'un autre commerce (politique `WITH CHECK`) ;
 * - refuse toute lecture des tables globales (comptes, sessions, plateforme) : le rôle n'y a aucun droit.
 *
 * Les deux réglages sont LOCAUX à la transaction (`SET LOCAL`, `set_config(..., true)`) : une connexion rendue
 * au pool Neon ne garde jamais le commerce d'une requête précédente. Hors transaction, `SET LOCAL` n'a aucun
 * effet ; `enterTenantScope` le détecte en relisant le rôle courant et lève une erreur au lieu de continuer sans
 * protection.
 *
 * Le commerce vient toujours du contexte serveur (`getBusinessContext`), jamais du navigateur.
 */
export const TENANT_ROLE = "qadr_tenant";

type Executor = Pick<CommercialDatabase, "execute">;
type TransactionConfig = Parameters<CommercialDatabase["transaction"]>[1];

export class TenantScopeError extends Error {
  constructor(message: string) { super(message); this.name = "TenantScopeError"; }
}

const businessIdShape = /^[A-Za-z0-9_-]{1,128}$/;

/** À appeler en tête d'une transaction déjà ouverte. Toute la suite de la transaction est limitée au commerce. */
export async function enterTenantScope(tx: Executor, businessId: string) {
  if (!businessIdShape.test(businessId)) throw new TenantScopeError("Identifiant de commerce invalide pour le contexte de base.");
  await tx.execute(sql`set local role qadr_tenant`);
  await tx.execute(sql`select set_config('qadr.business_id', ${businessId}, true)`);
  const [state] = (await tx.execute(sql`select current_user as "role", current_setting('qadr.business_id', true) as "businessId"`) as unknown as {
    rows: { role: string; businessId: string | null }[];
  }).rows;
  if (state?.role !== TENANT_ROLE || state.businessId !== businessId) {
    throw new TenantScopeError("Le contexte de commerce n'a pas pu être posé : withTenantScope doit être appelé dans une transaction.");
  }
}

/** Exécute `work` dans une transaction limitée par PostgreSQL au commerce `businessId`. */
export async function withTenantScope<T>(db: CommercialDatabase, businessId: string, work: (tx: CommercialDatabase) => Promise<T>, config?: TransactionConfig): Promise<T> {
  return db.transaction(async (tx) => {
    await enterTenantScope(tx as unknown as Executor, businessId);
    return work(tx as unknown as CommercialDatabase);
  }, config);
}

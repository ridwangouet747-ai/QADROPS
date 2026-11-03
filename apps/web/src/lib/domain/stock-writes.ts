import { sql } from "drizzle-orm";
import type { CommercialTransaction } from "./operation-guard";

/**
 * Met à jour le stock de plusieurs variantes d'un même commerce en une seule requête (UPDATE … FROM VALUES).
 *
 * Contrat (mission 11, phase 6) : l'appelant a déjà verrouillé ces variantes dans la même transaction par
 * un seul `SELECT … FOR UPDATE` trié par identifiant croissant (ordre déterministe, sans interblocage entre
 * deux ventes qui partagent des articles), et a calculé chaque nouvelle quantité en micro-unités entières.
 * Rien n'est recalculé ici : les quantités arrivent en texte décimal et sont typées `numeric` par PostgreSQL.
 */
export async function setVariantStock(tx: CommercialTransaction, businessId: string, rows: { id: string; onHand: string; stockRevision: bigint }[]) {
  if (!rows.length) return;
  const values = sql.join(rows.map((row) => sql`(${row.id}::text, ${row.onHand}::numeric, ${row.stockRevision.toString()}::bigint)`), sql`, `);
  await tx.execute(sql`update product_variant as v set on_hand = u.on_hand, stock_revision = u.stock_revision
    from (values ${values}) as u(id, on_hand, stock_revision) where v.business_id = ${businessId} and v.id = u.id`);
}

/*
 * Retour depuis la page du reçu (mission CTO du 2026-11-17, § 4) : le logo du commerce ramène à l'écran d'où vient
 * le reçu, normalement la caisse. Le navigateur ne fournit jamais d'adresse : `?from=` n'accepte qu'un mot de cette
 * liste fermée, traduit ici en chemin interne. Toute autre valeur (adresse externe, `//hôte`, chemin inventé)
 * ramène à la caisse.
 */

export const receiptOrigins = ["pos", "sales", "sale", "dashboard"] as const;
export type ReceiptOrigin = (typeof receiptOrigins)[number];

export function receiptOrigin(value: unknown): ReceiptOrigin {
  return typeof value === "string" && (receiptOrigins as readonly string[]).includes(value) ? value as ReceiptOrigin : "pos";
}

export function receiptReturnPath(origin: ReceiptOrigin, saleId: string) {
  switch (origin) {
    case "sales": return "/business/sales";
    case "sale": return `/business/sales/${encodeURIComponent(saleId)}`;
    case "dashboard": return "/business/dashboard";
    case "pos": return "/business/pos";
  }
}

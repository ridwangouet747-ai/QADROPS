/**
 * Règlement d'une vente à la caisse, calculé dans le navigateur pour l'affichage seulement : le serveur refait
 * tous les contrôles et le total de référence reste le sien. Montants en XOF entiers (bigint), jamais en flottant.
 *
 * - Une ligne « espèces » saisit la somme **remise** par le client. Tant que le caissier n'y touche pas, elle suit
 *   automatiquement le montant restant dû : un paiement exact s'encaisse sans rien ressaisir.
 * - La part affectée aux espèces ne dépasse jamais ce qui reste dû après les autres moyens ; l'excédent est la monnaie.
 * - Wave, Orange Money, MTN MoMo, Moov Money et « autre » sont des règlements déclarés : le montant saisi est affecté
 *   tel quel ; il ne peut pas dépasser le total (aucune monnaie n'est rendue sur un transfert).
 * - Chaque règlement déclaré doit être **confirmé** par le caissier (« Confirmer la réception », 2026-11-19) : il
 *   a vu le transfert arrivé sur le téléphone du commerce. Sans cette confirmation la vente ne part pas. La
 *   référence de transaction est facultative ; Qadr Ops ne la vérifie auprès d'aucun opérateur.
 */
export type SettlementInput = { method: string; amountXof: string; touched: boolean; received?: boolean; reference?: string };

export type SettlementRow = { method: string; value: bigint; applied: bigint; tendered: bigint | null; change: bigint };

export type Settlement = {
  rows: SettlementRow[];
  /** Somme affectée à la vente (ce que la vente encaisse ; la monnaie n'en fait jamais partie). */
  paidXof: bigint;
  dueXof: bigint;
  /** Billets et pièces remis par le client, monnaie comprise. */
  cashGivenXof: bigint;
  changeXof: bigint;
  /** Les règlements déclarés hors espèces dépassent le total : la vente ne peut pas être validée. */
  overpaid: boolean;
  /** Un règlement déclaré (Mobile Money, autre) n'a pas encore été confirmé reçu par le caissier. */
  unconfirmed: boolean;
  /** Billets et pièces qui restent dans le tiroir : remis moins rendu (jamais de Mobile Money). */
  drawerNetXof: bigint;
  /** Corps `payments` attendu par `POST /api/business/sales`. */
  payload: { method: string; amountXof: string; tenderedXof?: string; reference?: string }[];
};

export function wholeXof(value: string): bigint {
  const digits = value.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 18);
  return digits ? BigInt(digits) : 0n;
}

export function computeSettlement(total: bigint, parts: SettlementInput[]): Settlement {
  const declared = parts.filter((part) => part.method !== "cash").reduce((sum, part) => sum + wholeXof(part.amountXof), 0n);
  let cashNeed = total > declared ? total - declared : 0n;
  const rows = parts.map((part): SettlementRow => {
    if (part.method !== "cash") {
      const value = wholeXof(part.amountXof);
      return { method: part.method, value, applied: value, tendered: null, change: 0n };
    }
    const tendered = part.touched ? wholeXof(part.amountXof) : cashNeed;
    const applied = tendered < cashNeed ? tendered : cashNeed;
    cashNeed -= applied;
    return { method: part.method, value: tendered, applied, tendered, change: tendered - applied };
  });
  const paidXof = rows.reduce((sum, row) => sum + row.applied, 0n);
  const payload = rows.flatMap((row, index) => {
    if (row.applied <= 0n) return [];
    if (row.tendered !== null) return [row.change > 0n
      ? { method: row.method, amountXof: row.applied.toString(), tenderedXof: row.tendered.toString() }
      : { method: row.method, amountXof: row.applied.toString() }];
    const reference = parts[index]?.reference?.trim();
    return [reference ? { method: row.method, amountXof: row.applied.toString(), reference } : { method: row.method, amountXof: row.applied.toString() }];
  });
  const cashGivenXof = rows.reduce((sum, row) => sum + (row.tendered ?? 0n), 0n);
  const changeXof = rows.reduce((sum, row) => sum + row.change, 0n);
  return {
    rows, paidXof, dueXof: total > paidXof ? total - paidXof : 0n,
    cashGivenXof, changeXof, drawerNetXof: cashGivenXof - changeXof,
    overpaid: declared > total,
    unconfirmed: rows.some((row, index) => row.tendered === null && row.applied > 0n && !parts[index]?.received),
    payload,
  };
}

/**
 * Règlement d'une vente à la caisse, calculé dans le navigateur pour l'affichage seulement : le serveur refait
 * tous les contrôles et le total de référence reste le sien. Montants en XOF entiers (bigint), jamais en flottant.
 *
 * - Une ligne « espèces » saisit la somme **remise** par le client. Tant que le caissier n'y touche pas, elle suit
 *   automatiquement le montant restant dû : un paiement exact s'encaisse sans rien ressaisir.
 * - La part affectée aux espèces ne dépasse jamais ce qui reste dû après les autres moyens ; l'excédent est la monnaie.
 * - Wave, Orange Money, MTN MoMo, Moov Money et « autre » sont des règlements déclarés : le montant saisi est affecté
 *   tel quel ; il ne peut pas dépasser le total (aucune monnaie n'est rendue sur un transfert).
 */
export type SettlementInput = { method: string; amountXof: string; touched: boolean };

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
  /** Corps `payments` attendu par `POST /api/business/sales`. */
  payload: { method: string; amountXof: string; tenderedXof?: string }[];
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
  const payload = rows.filter((row) => row.applied > 0n).map((row) => (
    row.tendered !== null && row.change > 0n
      ? { method: row.method, amountXof: row.applied.toString(), tenderedXof: row.tendered.toString() }
      : { method: row.method, amountXof: row.applied.toString() }));
  return {
    rows, paidXof, dueXof: total > paidXof ? total - paidXof : 0n,
    cashGivenXof: rows.reduce((sum, row) => sum + (row.tendered ?? 0n), 0n),
    changeXof: rows.reduce((sum, row) => sum + row.change, 0n),
    overpaid: declared > total, payload,
  };
}

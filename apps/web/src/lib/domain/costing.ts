/** Fixed scales matching PostgreSQL numeric(24,6) quantities and numeric(30,12) unit costs. */
export const QUANTITY_SCALE = BigInt("1000000");
export const UNIT_COST_SCALE = BigInt("1000000000000");

function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= BigInt(0)) throw new RangeError("Denominator must be positive");
  return (numerator + denominator / BigInt(2)) / denominator;
}

/** Weighted average cost represented as integer 10^-12 XOF per base unit. */
export function weightedAverageCost(input: {
  oldQuantityMicros: bigint;
  oldUnitCostScaled: bigint;
  receivedQuantityMicros: bigint;
  receivedUnitCostScaled: bigint;
}): bigint {
  const { oldQuantityMicros: oq, oldUnitCostScaled: oc, receivedQuantityMicros: rq, receivedUnitCostScaled: rc } = input;
  if (oq < BigInt(0) || rq <= BigInt(0) || oc < BigInt(0) || rc < BigInt(0)) throw new RangeError("Stock quantities and unit costs must be nonnegative; receipt quantity must be positive");
  if (oq === BigInt(0)) return rc;
  return divideHalfUp(oq * oc + rq * rc, oq + rq);
}

/** Cost of a sale line in whole XOF, rounded half-up from the 6+12 decimal product. */
export function costOfGoodsSold(quantityMicros: bigint, unitCostScaled: bigint): bigint {
  if (quantityMicros < BigInt(0) || unitCostScaled < BigInt(0)) throw new RangeError("Quantity and unit cost must be nonnegative");
  return divideHalfUp(quantityMicros * unitCostScaled, QUANTITY_SCALE * UNIT_COST_SCALE);
}

/** Parse a nonnegative decimal quantity without ever passing through a JS float. */
export function parseQuantityMicros(value: string): bigint {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) throw new TypeError("Quantity must be a nonnegative decimal with at most 6 fractional digits");
  return BigInt(match[1]) * QUANTITY_SCALE + BigInt((match[2] ?? "").padEnd(6, "0"));
}

import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { businessProfile, businessSubscription, idempotencyRecord } from "../db/schema";
import { CommercialError, type CommercialDatabase } from "./commercial";

/** Transaction handle passed to `db.transaction` callbacks. */
export type CommercialTransaction = Parameters<Parameters<CommercialDatabase["transaction"]>[0]>[0];

export const idempotencyKeySchema = z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9:_-]+$/);

/**
 * Refuse every commercial write for a business that is suspended or whose subscription has lapsed.
 * Reads stay allowed so the merchant keeps access to their history.
 *
 * Must run inside the write transaction: `FOR SHARE` on the profile row makes a concurrent
 * platform suspension (an UPDATE of that row) wait for in-flight writes, and every write that
 * starts after the suspension commits sees it.
 */
export async function assertBusinessOperational(tx: CommercialTransaction, businessId: string, now = new Date()) {
  const [profile] = await tx.select({ status: businessProfile.status }).from(businessProfile)
    .where(eq(businessProfile.businessId, businessId)).for("share").limit(1);
  if (!profile) throw new CommercialError("Commerce introuvable.", 404);
  if (profile.status === "suspended") {
    throw new CommercialError("Ce commerce est suspendu : les opérations sont bloquées. Vos données restent consultables.", 403);
  }
  if (profile.status === "expired") {
    throw new CommercialError("L’abonnement de ce commerce a expiré : les opérations sont bloquées. Vos données restent consultables.", 403);
  }
  // A business that has had a subscription in force (trial or paid) must still have one running. Businesses
  // without any subscription history (or only pending/canceled ones) are not blocked: that policy is not decided yet.
  const [subscriptions] = await tx.select({
    inForceHistory: sql<boolean>`bool_or(${businessSubscription.status} in ('trialing','active','expired'))`,
    current: sql<boolean>`bool_or(${businessSubscription.status} in ('trialing','active') and ${businessSubscription.endsAt} > ${now})`,
  }).from(businessSubscription).where(eq(businessSubscription.businessId, businessId));
  if (subscriptions?.inForceHistory && !subscriptions.current) {
    throw new CommercialError("L’abonnement de ce commerce a expiré : les opérations sont bloquées. Vos données restent consultables.", 403);
  }
}

type IdempotentOperation = "purchase.receive" | "expense.create" | "receivable.payment" | "stock.opening" | "opening_balance.create" | "opening_balance.payment";
type JsonResult = Record<string, string | number | boolean | null>;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function findRecord(db: CommercialDatabase, businessId: string, key: string) {
  const [record] = await db.select().from(idempotencyRecord)
    .where(and(eq(idempotencyRecord.businessId, businessId), eq(idempotencyRecord.idempotencyKey, key))).limit(1);
  return record;
}

/**
 * Run a critical write at most once per (business, client key).
 *
 * - First call: checks the business is operational, runs `execute` and stores its result in the same transaction.
 * - Same key and same request: returns the stored result with `replayed: true`, without re-running anything
 *   (this is what a client gets back when the original response was lost on the network).
 * - Same key, different request or operation: 409.
 *
 * Callers must verify the actor's permission before calling, so a replay never returns data to someone
 * who has lost access. A replay is still answered after a suspension: the operation already happened.
 */
export async function runIdempotent<T extends JsonResult>(db: CommercialDatabase, input: {
  businessId: string; actorUserId: string; idempotencyKey: string; operation: IdempotentOperation; request: unknown;
}, execute: (tx: CommercialTransaction) => Promise<T>): Promise<T & { replayed: boolean }> {
  const requestHash = createHash("sha256").update(canonicalJson({ operation: input.operation, actorUserId: input.actorUserId, request: input.request })).digest("hex");
  const replay = (record: NonNullable<Awaited<ReturnType<typeof findRecord>>>) => {
    if (record.operation !== input.operation || record.requestHash !== requestHash) {
      throw new CommercialError("Cette clé d’opération a déjà été utilisée pour une requête différente.", 409);
    }
    return { ...(record.result as T), replayed: true };
  };

  const existing = await findRecord(db, input.businessId, input.idempotencyKey);
  if (existing) return replay(existing);
  try {
    const result = await db.transaction(async (tx) => {
      await assertBusinessOperational(tx, input.businessId);
      const value = await execute(tx);
      await tx.insert(idempotencyRecord).values({ businessId: input.businessId, idempotencyKey: input.idempotencyKey,
        operation: input.operation, requestHash, actorUserId: input.actorUserId, result: value });
      return value;
    });
    return { ...result, replayed: false };
  } catch (error) {
    // A concurrent attempt with the same key may have committed first; its primary key insert makes ours roll back.
    const concurrent = await findRecord(db, input.businessId, input.idempotencyKey);
    if (concurrent) return replay(concurrent);
    throw error;
  }
}

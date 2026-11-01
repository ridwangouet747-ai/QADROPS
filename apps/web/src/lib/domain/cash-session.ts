import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { hasBusinessPermission } from "../auth/permissions";
import { auditEvent, cashMovement, cashSession, member, user } from "../db/schema";
import { CommercialError, type CommercialDatabase } from "./commercial";
import { idempotencyKeySchema, runIdempotent, type CommercialTransaction } from "./operation-guard";
import { enqueueNotification } from "./notifications";

/*
 * Sessions de caisse (mission 09). Une opération en espèces est rattachée, au moment où elle est
 * écrite, à la session ouverte de la personne qui l'enregistre (cash_session_id). Seules les espèces
 * comptent : un paiement Mobile Money n'est jamais de l'argent physique, et un paiement en attente
 * n'est pas un encaissement. Une ancienne dette réglée en espèces augmente la caisse sans devenir du
 * chiffre d'affaires.
 */

type Context = { businessId: string; actorUserId: string };
const contextShape = { businessId: z.string().min(1), actorUserId: z.string().min(1) };
const xof = z.string().regex(/^(0|[1-9]\d{0,17})$/);
const note = z.string().trim().max(500);

async function roleOf(db: CommercialDatabase | CommercialTransaction, context: Context) {
  const [membership] = await db.select({ role: member.role }).from(member)
    .where(and(eq(member.organizationId, context.businessId), eq(member.userId, context.actorUserId))).limit(1);
  return membership?.role ?? null;
}

function can(role: string | null, action: string) {
  return role !== null && hasBusinessPermission(role, "cash", action);
}

const forbidden = () => new CommercialError("Vous n’avez pas l’autorisation d’effectuer cette opération de caisse.", 403, "forbidden");
const notFound = () => new CommercialError("Session de caisse introuvable.", 404, "not_found");

/**
 * Session ouverte du membre, verrouillée en partage jusqu'à la fin de la transaction appelante :
 * une clôture concurrente (verrou exclusif) attend que l'opération soit écrite, et toute opération
 * qui commence après la clôture ne trouve plus de session ouverte. Renvoie null sans session.
 */
export async function attachOpenCashSession(tx: CommercialTransaction, businessId: string, userId: string) {
  const [open] = await tx.select({ id: cashSession.id }).from(cashSession)
    .where(and(eq(cashSession.businessId, businessId), eq(cashSession.userId, userId), eq(cashSession.status, "open")))
    .for("share").limit(1);
  return open?.id ?? null;
}

/* ------------------------------------------------------------------ Calcul */

export type CashBreakdown = {
  openingFloatXof: bigint; cashSalesXof: bigint; receivableCashXof: bigint; openingDebtCashXof: bigint; movementsInXof: bigint;
  expensesCashXof: bigint; supplierCashXof: bigint; refundsCashXof: bigint; movementsOutXof: bigint;
};

/**
 * Espèces théoriques = fonds initial + encaissements en espèces (ventes, crédits, anciennes dettes) + entrées justifiées
 * − dépenses en espèces − paiements fournisseurs en espèces − remboursements en espèces − sorties justifiées.
 */
export function expectedCash(b: CashBreakdown) {
  const inflows = b.cashSalesXof + b.receivableCashXof + b.openingDebtCashXof + b.movementsInXof;
  const outflows = b.expensesCashXof + b.supplierCashXof + b.refundsCashXof + b.movementsOutXof;
  return { inflowsXof: inflows, outflowsXof: outflows, expectedXof: b.openingFloatXof + inflows - outflows };
}

/** Écart = espèces comptées − espèces théoriques (négatif : il manque de l'argent). */
export function cashDifference(countedXof: bigint, expectedXof: bigint) {
  return countedXof - expectedXof;
}

export function serializeBreakdown(b: CashBreakdown) {
  const totals = expectedCash(b);
  return Object.fromEntries(Object.entries({ ...b, ...totals }).map(([key, value]) => [key, value.toString()])) as Record<keyof CashBreakdown | keyof typeof totals, string>;
}

async function computeBreakdown(db: CommercialDatabase | CommercialTransaction, businessId: string, sessionId: string, openingFloatXof: bigint): Promise<CashBreakdown> {
  // Une seule requête, indexée par (business_id, cash_session_id) ; montants en bigint, jamais en flottant.
  const result = await db.execute(sql`select
    (select coalesce(sum(p.amount_xof), 0) from payment p where p.business_id = ${businessId} and p.cash_session_id = ${sessionId}
      and p.method = 'cash' and p.status not in ('pending','failed')
      and not exists (select 1 from receivable_payment r where r.business_id = p.business_id and r.payment_id = p.id))::text as "cashSales",
    (select coalesce(sum(p.amount_xof), 0) from payment p where p.business_id = ${businessId} and p.cash_session_id = ${sessionId}
      and p.method = 'cash' and p.status not in ('pending','failed')
      and exists (select 1 from receivable_payment r where r.business_id = p.business_id and r.payment_id = p.id))::text as "receivableCash",
    (select coalesce(sum(op.amount_xof), 0) from opening_balance_payment op join opening_balance b on b.business_id = op.business_id and b.id = op.opening_balance_id
      where op.business_id = ${businessId} and op.cash_session_id = ${sessionId} and op.method = 'cash' and b.party_type = 'customer')::text as "openingDebtCash",
    (select coalesce(sum(op.amount_xof), 0) from opening_balance_payment op join opening_balance b on b.business_id = op.business_id and b.id = op.opening_balance_id
      where op.business_id = ${businessId} and op.cash_session_id = ${sessionId} and op.method = 'cash' and b.party_type = 'supplier')::text as "openingSupplierCash",
    (select coalesce(sum(e.amount_xof), 0) from expense e where e.business_id = ${businessId} and e.cash_session_id = ${sessionId} and e.payment_method = 'cash')::text as "expensesCash",
    (select coalesce(sum(pp.amount_xof), 0) from purchase_payment pp where pp.business_id = ${businessId} and pp.cash_session_id = ${sessionId} and pp.method = 'cash')::text as "purchaseCash",
    (select coalesce(sum(rf.amount_xof), 0) from payment_refund rf join payment p on p.business_id = rf.business_id and p.id = rf.payment_id
      where rf.business_id = ${businessId} and rf.cash_session_id = ${sessionId} and rf.status = 'confirmed' and p.method = 'cash')::text as "refundsCash",
    (select coalesce(sum(m.amount_xof) filter (where m.direction = 'in'), 0) from cash_movement m where m.business_id = ${businessId} and m.session_id = ${sessionId})::text as "movementsIn",
    (select coalesce(sum(m.amount_xof) filter (where m.direction = 'out'), 0) from cash_movement m where m.business_id = ${businessId} and m.session_id = ${sessionId})::text as "movementsOut"
  `) as unknown as { rows: Record<string, string>[] };
  const row = result.rows[0] ?? {};
  const n = (key: string) => BigInt(row[key] ?? "0");
  return {
    openingFloatXof, cashSalesXof: n("cashSales"), receivableCashXof: n("receivableCash"), openingDebtCashXof: n("openingDebtCash"), movementsInXof: n("movementsIn"),
    expensesCashXof: n("expensesCash"), supplierCashXof: n("purchaseCash") + n("openingSupplierCash"), refundsCashXof: n("refundsCash"), movementsOutXof: n("movementsOut"),
  };
}

/* ------------------------------------------------------------------ Ouverture */

const openInput = z.object({ ...contextShape, idempotencyKey: idempotencyKeySchema, openingFloatXof: xof, note: note.optional() });

export async function openCashSession(db: CommercialDatabase, raw: unknown) {
  const input = openInput.parse(raw);
  if (!can(await roleOf(db, input), "open")) throw forbidden();
  const id = randomUUID();
  const request = { openingFloatXof: input.openingFloatXof, note: input.note || null };
  try {
    return await runIdempotent(db, { ...input, operation: "cash_session.open", request }, async (tx) => {
      const [existing] = await tx.select({ id: cashSession.id }).from(cashSession)
        .where(and(eq(cashSession.businessId, input.businessId), eq(cashSession.userId, input.actorUserId), eq(cashSession.status, "open"))).limit(1);
      if (existing) throw new CommercialError("Votre caisse est déjà ouverte. Clôturez-la avant d’en ouvrir une autre.", 409, "already_open");
      const [created] = await tx.insert(cashSession).values({ id, businessId: input.businessId, userId: input.actorUserId,
        openingFloatXof: BigInt(input.openingFloatXof), openingNote: input.note || null }).returning({ openedAt: cashSession.openedAt });
      await tx.insert(auditEvent).values({ id: randomUUID(), businessId: input.businessId, actorUserId: input.actorUserId, eventType: "cash_session.opened",
        entityType: "cash_session", entityId: id, metadata: { openingFloatXof: input.openingFloatXof } });
      return { id, openedAt: created!.openedAt.toISOString(), openingFloatXof: input.openingFloatXof };
    });
  } catch (error) {
    // Deux ouvertures simultanées avec des clés différentes : l'index unique partiel en laisse passer une seule.
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      throw new CommercialError("Votre caisse est déjà ouverte. Clôturez-la avant d’en ouvrir une autre.", 409, "already_open");
    }
    throw error;
  }
}

/* ------------------------------------------------------------------ Accès à une session */

async function loadSession(db: CommercialDatabase | CommercialTransaction, businessId: string, sessionId: string, lock?: "update" | "share") {
  const query = db.select().from(cashSession).where(and(eq(cashSession.businessId, businessId), eq(cashSession.id, sessionId))).limit(1);
  const [row] = lock ? await query.for(lock) : await query;
  return row;
}

/** Sa propre session avec `ownAction`, celle d'un autre avec `otherAction` ; une session d'un autre commerce n'existe pas. */
function assertSessionAccess(role: string | null, actorUserId: string, sessionUserId: string, ownAction: string, otherAction: string) {
  if (!can(role, sessionUserId === actorUserId ? ownAction : otherAction)) throw forbidden();
}

/* ------------------------------------------------------------------ Entrées et sorties justifiées */

const movementInput = z.object({ ...contextShape, idempotencyKey: idempotencyKeySchema, sessionId: z.string().min(1).max(100),
  direction: z.enum(["in", "out"]), amountXof: xof, reason: z.string().trim().min(1).max(240) });

export async function recordCashMovement(db: CommercialDatabase, raw: unknown) {
  const input = movementInput.parse(raw);
  const amount = BigInt(input.amountXof);
  if (amount <= 0n) throw new CommercialError("Le montant doit être supérieur à zéro.", 400, "validation");
  const role = await roleOf(db, input);
  const session = await loadSession(db, input.businessId, input.sessionId);
  if (!session) throw notFound();
  assertSessionAccess(role, input.actorUserId, session.userId, "open", "manage");
  const request = { sessionId: input.sessionId, direction: input.direction, amountXof: input.amountXof, reason: input.reason };
  return runIdempotent(db, { ...input, operation: "cash_session.movement", request }, async (tx) => {
    const locked = await loadSession(tx, input.businessId, input.sessionId, "share");
    if (!locked || locked.status !== "open") throw new CommercialError("Cette caisse est déjà clôturée.", 409, "already_closed");
    const id = randomUUID();
    await tx.insert(cashMovement).values({ id, businessId: input.businessId, sessionId: input.sessionId, direction: input.direction,
      amountXof: amount, reason: input.reason, createdByUserId: input.actorUserId });
    await tx.insert(auditEvent).values({ id: randomUUID(), businessId: input.businessId, actorUserId: input.actorUserId, eventType: "cash_session.movement_recorded",
      entityType: "cash_session", entityId: input.sessionId, metadata: { direction: input.direction, amountXof: input.amountXof } });
    return { id };
  });
}

/* ------------------------------------------------------------------ Clôture */

const closeInput = z.object({ ...contextShape, idempotencyKey: idempotencyKeySchema, sessionId: z.string().min(1).max(100), countedCashXof: xof, note: note.optional() });

export async function closeCashSession(db: CommercialDatabase, raw: unknown, now = new Date()) {
  const input = closeInput.parse(raw);
  const role = await roleOf(db, input);
  const session = await loadSession(db, input.businessId, input.sessionId);
  if (!session) throw notFound();
  assertSessionAccess(role, input.actorUserId, session.userId, "close", "manage");
  const request = { sessionId: input.sessionId, countedCashXof: input.countedCashXof, note: input.note || null };
  return runIdempotent(db, { ...input, operation: "cash_session.close", request }, async (tx) => {
    // Verrou exclusif : attend les opérations en espèces en cours (verrou partagé), puis fige le calcul.
    const locked = await loadSession(tx, input.businessId, input.sessionId, "update");
    if (!locked || locked.status !== "open") throw new CommercialError("Cette caisse est déjà clôturée.", 409, "already_closed");
    const breakdown = await computeBreakdown(tx, input.businessId, input.sessionId, locked.openingFloatXof);
    const { expectedXof } = expectedCash(breakdown);
    const counted = BigInt(input.countedCashXof);
    const difference = cashDifference(counted, expectedXof);
    if (difference !== 0n && !input.note) {
      throw new CommercialError("Expliquez l’écart avant de clôturer la caisse.", 400, "justification_required");
    }
    const snapshot = serializeBreakdown(breakdown);
    await tx.update(cashSession).set({ status: "closed", closedAt: now, closedByUserId: input.actorUserId, countedCashXof: counted,
      expectedCashXof: expectedXof, differenceXof: difference, closingNote: input.note || null, closingSnapshot: snapshot })
      .where(and(eq(cashSession.businessId, input.businessId), eq(cashSession.id, input.sessionId)));
    await tx.insert(auditEvent).values({ id: randomUUID(), businessId: input.businessId, actorUserId: input.actorUserId, eventType: "cash_session.closed",
      entityType: "cash_session", entityId: input.sessionId, metadata: { expectedXof: expectedXof.toString(), countedXof: counted.toString(),
        differenceXof: difference.toString(), onBehalf: locked.userId !== input.actorUserId } });
    if (difference !== 0n) await enqueueNotification(tx, { businessId: input.businessId, eventType: "cash.closing_gap",
      payload: { sessionId: input.sessionId, subjectUserId: locked.userId, actorUserId: input.actorUserId, status: difference < 0n ? "short" : "over" }, dedupKey: `cash.closing_gap:${input.sessionId}` });
    return { id: input.sessionId, status: "closed", expectedXof: expectedXof.toString(), countedXof: counted.toString(), differenceXof: difference.toString(), closedAt: now.toISOString() };
  });
}

/* ------------------------------------------------------------------ Validation par un responsable */

const validateInput = z.object({ ...contextShape, idempotencyKey: idempotencyKeySchema, sessionId: z.string().min(1).max(100), note: note.optional() });

export async function validateCashSession(db: CommercialDatabase, raw: unknown, now = new Date()) {
  const input = validateInput.parse(raw);
  const role = await roleOf(db, input);
  if (!can(role, "validate")) throw forbidden();
  const session = await loadSession(db, input.businessId, input.sessionId);
  if (!session) throw notFound();
  // Un responsable ne valide pas sa propre caisse, sauf le propriétaire (seul à pouvoir le faire dans un petit commerce).
  if (session.userId === input.actorUserId && !(role ?? "").split(",").map((part) => part.trim()).includes("owner")) {
    throw new CommercialError("Une autre personne doit valider votre clôture.", 403, "self_validation");
  }
  const request = { sessionId: input.sessionId, note: input.note || null };
  return runIdempotent(db, { ...input, operation: "cash_session.validate", request }, async (tx) => {
    const locked = await loadSession(tx, input.businessId, input.sessionId, "update");
    if (!locked) throw notFound();
    if (locked.status === "open") throw new CommercialError("La caisse doit être clôturée avant d’être validée.", 409, "not_closed");
    if (locked.status === "validated") throw new CommercialError("Cette clôture est déjà validée.", 409, "already_validated");
    await tx.update(cashSession).set({ status: "validated", validatedAt: now, validatedByUserId: input.actorUserId, validationNote: input.note || null })
      .where(and(eq(cashSession.businessId, input.businessId), eq(cashSession.id, input.sessionId)));
    await tx.insert(auditEvent).values({ id: randomUUID(), businessId: input.businessId, actorUserId: input.actorUserId, eventType: "cash_session.validated",
      entityType: "cash_session", entityId: input.sessionId, metadata: {} });
    return { id: input.sessionId, status: "validated", validatedAt: now.toISOString() };
  });
}

/* ------------------------------------------------------------------ Lecture */

function present(row: typeof cashSession.$inferSelect & { userName: string | null }, live?: CashBreakdown) {
  const breakdown = live ? serializeBreakdown(live) : (row.closingSnapshot as Record<string, string> | null);
  return {
    id: row.id, userId: row.userId, userName: row.userName ?? "", status: row.status, openingFloatXof: row.openingFloatXof.toString(), openingNote: row.openingNote,
    openedAt: row.openedAt.toISOString(), closedAt: row.closedAt?.toISOString() ?? null, closedByUserId: row.closedByUserId,
    countedCashXof: row.countedCashXof?.toString() ?? null, expectedCashXof: row.expectedCashXof?.toString() ?? breakdown?.expectedXof ?? null,
    differenceXof: row.differenceXof?.toString() ?? null, closingNote: row.closingNote, validatedAt: row.validatedAt?.toISOString() ?? null,
    validationNote: row.validationNote, breakdown,
  };
}
export type CashSessionView = ReturnType<typeof present>;

const sessionColumns = { session: cashSession, userName: user.name };

export async function getCashOverview(db: CommercialDatabase, context: Context, raw: unknown = {}) {
  const filters = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }).parse(raw);
  const role = await roleOf(db, context);
  const audit = can(role, "audit");
  if (!audit && !can(role, "read")) throw forbidden();
  const [mine] = await db.select(sessionColumns).from(cashSession).innerJoin(user, eq(user.id, cashSession.userId))
    .where(and(eq(cashSession.businessId, context.businessId), eq(cashSession.userId, context.actorUserId), eq(cashSession.status, "open"))).limit(1);
  const current = mine ? present({ ...mine.session, userName: mine.userName }, await computeBreakdown(db, context.businessId, mine.session.id, mine.session.openingFloatXof)) : null;
  const scope = audit ? eq(cashSession.businessId, context.businessId) : and(eq(cashSession.businessId, context.businessId), eq(cashSession.userId, context.actorUserId));
  const rows = await db.select(sessionColumns).from(cashSession).innerJoin(user, eq(user.id, cashSession.userId))
    .where(scope).orderBy(desc(cashSession.openedAt), desc(cashSession.id)).limit(filters.limit);
  const sessions = rows.map((row) => present({ ...row.session, userName: row.userName }));
  // Comparaison des caisses : écarts cumulés par personne sur les clôtures affichées.
  const byCashier = new Map<string, { userId: string; userName: string; closedCount: number; differenceXof: bigint; shortCount: number }>();
  for (const session of sessions) {
    if (session.differenceXof === null) continue;
    const entry = byCashier.get(session.userId) ?? { userId: session.userId, userName: session.userName, closedCount: 0, differenceXof: 0n, shortCount: 0 };
    entry.closedCount += 1;
    entry.differenceXof += BigInt(session.differenceXof);
    if (BigInt(session.differenceXof) < 0n) entry.shortCount += 1;
    byCashier.set(session.userId, entry);
  }
  return {
    current, sessions,
    comparison: [...byCashier.values()].map((entry) => ({ ...entry, differenceXof: entry.differenceXof.toString() })),
    permissions: { open: can(role, "open"), audit, validate: can(role, "validate"), manage: can(role, "manage") },
  };
}

export async function getCashSessionDetail(db: CommercialDatabase, context: Context & { sessionId: string }) {
  const role = await roleOf(db, context);
  const [row] = await db.select(sessionColumns).from(cashSession).innerJoin(user, eq(user.id, cashSession.userId))
    .where(and(eq(cashSession.businessId, context.businessId), eq(cashSession.id, context.sessionId))).limit(1);
  if (!row) throw notFound();
  assertSessionAccess(role, context.actorUserId, row.session.userId, "read", "audit");
  const live = row.session.status === "open" ? await computeBreakdown(db, context.businessId, row.session.id, row.session.openingFloatXof) : undefined;
  const movements = await db.select({ id: cashMovement.id, direction: cashMovement.direction, amountXof: cashMovement.amountXof, reason: cashMovement.reason, occurredAt: cashMovement.occurredAt })
    .from(cashMovement).where(and(eq(cashMovement.businessId, context.businessId), eq(cashMovement.sessionId, context.sessionId))).orderBy(desc(cashMovement.occurredAt)).limit(200);
  return { session: present({ ...row.session, userName: row.userName }, live),
    movements: movements.map((movement) => ({ ...movement, amountXof: movement.amountXof.toString(), occurredAt: movement.occurredAt.toISOString() })) };
}

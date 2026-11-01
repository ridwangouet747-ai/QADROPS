import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { hasBusinessPermission } from "../auth/permissions";
import { auditEvent, member, organization, printDevice, printerSettings, printJob, sale } from "../db/schema";
import { buildReceiptTicket, buildTestTicket } from "../printing/receipt-ticket";
import { CommercialError, type CommercialDatabase } from "./commercial";
import { getSaleReceipt } from "./receipt";

/*
 * Impression thermique (mission 10) : module facultatif, désactivé par défaut. Ici, rien ne touche au
 * matériel : le serveur prépare le ticket ESC/POS d'une vente déjà validée et suit les tâches. Le service
 * local (apps/print-agent) imprime, et le navigateur rapporte le résultat. Une panne d'impression ne
 * modifie jamais la vente.
 */

type Context = { businessId: string; actorUserId: string };

async function roleOf(db: CommercialDatabase, context: Context) {
  const [row] = await db.select({ role: member.role }).from(member).where(and(eq(member.organizationId, context.businessId), eq(member.userId, context.actorUserId))).limit(1);
  return row?.role ?? null;
}
async function requirePrinter(db: CommercialDatabase, context: Context, action: "configure" | "print") {
  const role = await roleOf(db, context);
  if (!role || !hasBusinessPermission(role, "printer", action)) throw new CommercialError("Vous n’avez pas l’autorisation d’utiliser l’imprimante.", 403, "forbidden");
  return role;
}

export async function getPrinterSetup(db: CommercialDatabase, context: Context) {
  const role = await roleOf(db, context);
  const canConfigure = Boolean(role && hasBusinessPermission(role, "printer", "configure"));
  const canPrint = Boolean(role && hasBusinessPermission(role, "printer", "print"));
  if (!canConfigure && !canPrint) throw new CommercialError("Vous n’avez pas l’autorisation d’utiliser l’imprimante.", 403, "forbidden");
  const [[settings], devices] = await Promise.all([
    db.select().from(printerSettings).where(eq(printerSettings.businessId, context.businessId)).limit(1),
    db.select({ id: printDevice.id, name: printDevice.name, transport: printDevice.transport, profile: printDevice.profile, paperWidthMm: printDevice.paperWidthMm,
      agentId: printDevice.agentId, lastStatus: printDevice.lastStatus, lastSeenAt: printDevice.lastSeenAt })
      .from(printDevice).where(and(eq(printDevice.businessId, context.businessId), isNull(printDevice.archivedAt))).orderBy(printDevice.createdAt),
  ]);
  return { enabled: settings?.enabled ?? false, autoPrint: settings?.autoPrint ?? false, devices, permissions: { configure: canConfigure, print: canPrint } };
}

export async function updatePrinterSettings(db: CommercialDatabase, context: Context, raw: unknown, now = new Date()) {
  await requirePrinter(db, context, "configure");
  const input = z.object({ enabled: z.boolean(), autoPrint: z.boolean() }).parse(raw);
  const values = { enabled: input.enabled, autoPrint: input.enabled && input.autoPrint, updatedByUserId: context.actorUserId, updatedAt: now };
  await db.transaction(async (tx) => {
    await tx.insert(printerSettings).values({ businessId: context.businessId, ...values }).onConflictDoUpdate({ target: printerSettings.businessId, set: values });
    await tx.insert(auditEvent).values({ id: randomUUID(), businessId: context.businessId, actorUserId: context.actorUserId, eventType: "printer.settings_updated",
      entityType: "printer_settings", entityId: context.businessId, metadata: { enabled: values.enabled, autoPrint: values.autoPrint } });
  });
  return getPrinterSetup(db, context);
}

const deviceInput = z.object({
  name: z.string().trim().min(1).max(80), transport: z.enum(["tcp", "windows_share", "device", "simulated"]),
  profile: z.enum(["generic", "epson", "xprinter", "star"]).default("generic"), paperWidthMm: z.union([z.literal(58), z.literal(80)]),
  agentId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).nullable(),
});

/** Déclare une imprimante (sans secret : l'appairage reste entre le navigateur et le service local). */
export async function addPrintDevice(db: CommercialDatabase, context: Context, raw: unknown) {
  await requirePrinter(db, context, "configure");
  const input = deviceInput.parse(raw);
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(printDevice).values({ id, businessId: context.businessId, createdByUserId: context.actorUserId, ...input });
    await tx.insert(auditEvent).values({ id: randomUUID(), businessId: context.businessId, actorUserId: context.actorUserId, eventType: "printer.device_added",
      entityType: "print_device", entityId: id, metadata: { transport: input.transport, paperWidthMm: input.paperWidthMm } });
  });
  return { id };
}

export async function archivePrintDevice(db: CommercialDatabase, context: Context, deviceId: string, now = new Date()) {
  await requirePrinter(db, context, "configure");
  const archived = await db.update(printDevice).set({ archivedAt: now }).where(and(eq(printDevice.businessId, context.businessId), eq(printDevice.id, deviceId), isNull(printDevice.archivedAt))).returning({ id: printDevice.id });
  if (!archived.length) throw new CommercialError("Imprimante introuvable.", 404, "not_found");
  return { archived: true };
}

const jobInput = z.object({
  deviceId: z.string().min(1).max(100), kind: z.enum(["receipt", "test"]), saleId: z.string().min(1).max(100).optional(),
  reprintOfJobId: z.string().min(1).max(100).optional(), language: z.enum(["fr", "en"]).default("fr"),
});

/**
 * Prépare une tâche. Pour un ticket de vente : la vente doit exister dans CE commerce (validée par le
 * serveur). Une seule impression d'origine par (vente, imprimante) : un second appel (double clic,
 * impression automatique rejouée) renvoie la même tâche, que le service local refusera d'imprimer deux fois.
 * Si cette tâche est déjà imprimée, rien n'est renvoyé à imprimer : il faut demander une réimpression.
 */
export async function createPrintJob(db: CommercialDatabase, context: Context, raw: unknown, now = new Date()) {
  await requirePrinter(db, context, "print");
  const input = jobInput.parse(raw);
  const [settings] = await db.select().from(printerSettings).where(eq(printerSettings.businessId, context.businessId)).limit(1);
  if (!settings?.enabled) throw new CommercialError("Le module d’impression n’est pas activé pour ce commerce.", 409, "module_disabled");
  const [device] = await db.select().from(printDevice).where(and(eq(printDevice.businessId, context.businessId), eq(printDevice.id, input.deviceId), isNull(printDevice.archivedAt))).limit(1);
  if (!device) throw new CommercialError("Imprimante introuvable.", 404, "not_found");
  const width = device.paperWidthMm === 58 ? 58 : 80;

  if (input.kind === "test") {
    const [business] = await db.select({ name: organization.name }).from(organization).where(eq(organization.id, context.businessId)).limit(1);
    const id = randomUUID();
    await db.insert(printJob).values({ id, businessId: context.businessId, deviceId: device.id, kind: "test", createdByUserId: context.actorUserId, createdAt: now, updatedAt: now });
    const ticket = buildTestTicket(width, business?.name ?? "", input.language, now);
    return { job: { id, status: "pending" as const, kind: "test" as const, duplicate: false }, payload: Buffer.from(ticket.bytes).toString("base64"), preview: ticket.preview, unsupportedCharacters: ticket.unsupportedCharacters };
  }

  if (!input.saleId) throw new CommercialError("Choisissez la vente à imprimer.", 400, "validation");
  // getSaleReceipt vérifie aussi la permission de lecture des ventes et l'appartenance de la vente au commerce.
  const receipt = await getSaleReceipt(db, { businessId: context.businessId, actorUserId: context.actorUserId, saleId: input.saleId });
  let reprintOf: string | null = null;
  if (input.reprintOfJobId) {
    const [original] = await db.select({ id: printJob.id, saleId: printJob.saleId }).from(printJob).where(and(eq(printJob.businessId, context.businessId), eq(printJob.id, input.reprintOfJobId))).limit(1);
    if (!original || original.saleId !== input.saleId) throw new CommercialError("Impression d’origine introuvable.", 404, "not_found");
    reprintOf = original.id;
  }
  const id = randomUUID();
  const [created] = await db.insert(printJob).values({ id, businessId: context.businessId, deviceId: device.id, saleId: input.saleId, kind: "receipt", reprintOfJobId: reprintOf,
    createdByUserId: context.actorUserId, createdAt: now, updatedAt: now }).onConflictDoNothing().returning({ id: printJob.id });
  let job: { id: string; status: string; duplicate: boolean } = { id, status: "pending", duplicate: false };
  if (!created) {
    const [existing] = await db.select({ id: printJob.id, status: printJob.status }).from(printJob).where(and(eq(printJob.businessId, context.businessId), eq(printJob.saleId, input.saleId),
      eq(printJob.deviceId, device.id), eq(printJob.kind, "receipt"), isNull(printJob.reprintOfJobId))).limit(1);
    job = { id: existing!.id, status: existing!.status, duplicate: true };
    if (existing!.status === "printed" || existing!.status === "canceled") return { job: { ...job, kind: "receipt" as const }, payload: null, preview: null, unsupportedCharacters: 0 };
  }
  if (reprintOf) {
    await db.insert(auditEvent).values({ id: randomUUID(), businessId: context.businessId, actorUserId: context.actorUserId, eventType: "printer.receipt_reprinted", entityType: "sale", entityId: input.saleId, metadata: { jobId: id } });
  }
  const ticket = buildReceiptTicket({ business: receipt.business, sale: receipt.sale, lines: receipt.lines, payments: receipt.payments }, width, input.language);
  return { job: { ...job, kind: "receipt" as const }, payload: Buffer.from(ticket.bytes).toString("base64"), preview: ticket.preview, unsupportedCharacters: ticket.unsupportedCharacters };
}

const transitions: Record<string, string[]> = { pending: ["printed", "failed", "uncertain", "canceled"], uncertain: ["printed", "failed", "canceled"], failed: [], printed: [], canceled: [] };

/**
 * Résultat rapporté par le navigateur. `uncertain` : réponse perdue, on ne relance pas à l'aveugle ; la
 * personne indique ensuite si le ticket est sorti (printed) ou non (failed, puis réimpression volontaire).
 */
export async function reportPrintResult(db: CommercialDatabase, context: Context, jobId: string, raw: unknown, now = new Date()) {
  await requirePrinter(db, context, "print");
  const input = z.object({ status: z.enum(["printed", "failed", "uncertain", "canceled"]), errorCode: z.string().regex(/^[a-z_]{1,40}$/).optional(), deviceStatus: z.string().regex(/^[a-z_,]{1,120}$/).optional() }).parse(raw);
  const [job] = await db.select().from(printJob).where(and(eq(printJob.businessId, context.businessId), eq(printJob.id, jobId))).limit(1);
  if (!job) throw new CommercialError("Tâche d’impression introuvable.", 404, "not_found");
  if (job.status === input.status) return { id: job.id, status: job.status, replayed: true };
  if (!transitions[job.status]?.includes(input.status)) throw new CommercialError("Cette tâche ne peut plus changer d’état.", 409, "job_final");
  await db.update(printJob).set({ status: input.status, errorCode: input.errorCode ?? null, updatedAt: now }).where(eq(printJob.id, job.id));
  await db.update(printDevice).set({ lastSeenAt: now, lastStatus: input.deviceStatus ?? (input.status === "printed" ? "ok" : input.errorCode ?? input.status) })
    .where(and(eq(printDevice.businessId, context.businessId), eq(printDevice.id, job.deviceId)));
  return { id: job.id, status: input.status, replayed: false };
}

export async function listPrintJobs(db: CommercialDatabase, context: Context, raw: unknown = {}) {
  await requirePrinter(db, context, "print");
  const input = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30), saleId: z.string().min(1).max(100).optional() }).parse(raw);
  const conditions = [eq(printJob.businessId, context.businessId)];
  if (input.saleId) conditions.push(eq(printJob.saleId, input.saleId));
  return db.select({ id: printJob.id, kind: printJob.kind, status: printJob.status, errorCode: printJob.errorCode, saleId: printJob.saleId, reference: sale.reference,
    deviceName: printDevice.name, reprintOfJobId: printJob.reprintOfJobId, createdAt: printJob.createdAt, updatedAt: printJob.updatedAt })
    .from(printJob).innerJoin(printDevice, and(eq(printDevice.businessId, printJob.businessId), eq(printDevice.id, printJob.deviceId)))
    .leftJoin(sale, and(eq(sale.businessId, printJob.businessId), eq(sale.id, printJob.saleId)))
    .where(and(...conditions)).orderBy(desc(printJob.createdAt)).limit(input.limit);
}

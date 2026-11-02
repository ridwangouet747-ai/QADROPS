import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { hasBusinessPermission } from "../auth/permissions";
import { auditEvent, member, organization, printDevice, printerSettings, printJob, sale } from "../db/schema";
import { chooseRender, codePages, renderModes, resolveProfile, type PrinterProfile } from "../printing/profiles";
import { buildReceiptDocument } from "../printing/receipt-document";
import { encodeTicketText, layoutReceipt, layoutTestTicket, type TicketLayout } from "../printing/receipt-ticket";
import { CommercialError, type CommercialDatabase } from "./commercial";
import { assertBusinessOperational, idempotencyKeySchema, runIdempotent, type CommercialTransaction } from "./operation-guard";
import { getSaleReceipt } from "./receipt";

/*
 * Impression thermique (mission 10 ; ticket unique, profils et réimpression idempotente en mission 11,
 * phase 5) : module facultatif, désactivé par défaut. Ici, rien ne touche au matériel : le serveur prépare
 * le ticket d'une vente déjà validée et suit les tâches. Le service local (apps/print-agent) transmet les
 * octets, et le navigateur rapporte le résultat. Une panne d'impression ne modifie jamais la vente.
 *
 * « printed » (statut historique en base) veut dire « transmis à l'imprimante sans erreur signalée » : ni
 * le serveur ni le service local ne voient le papier sortir. L'interface l'affiche donc « Transmis » (I-7).
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
      codePage: printDevice.codePage, renderMode: printDevice.renderMode, agentId: printDevice.agentId, lastStatus: printDevice.lastStatus, lastSeenAt: printDevice.lastSeenAt })
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

const profileFields = {
  paperWidthMm: z.union([z.literal(58), z.literal(80)]),
  codePage: z.enum(["pc858", "pc850", "wpc1252"] satisfies typeof codePages[number][]).default("pc858"),
  renderMode: z.enum(["auto", "text", "raster"] satisfies typeof renderModes[number][]).default("auto"),
};
const deviceInput = z.object({
  name: z.string().trim().min(1).max(80), transport: z.enum(["tcp", "windows_share", "device", "simulated"]),
  profile: z.enum(["generic", "epson", "xprinter", "star"]).default("generic"), ...profileFields,
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
      entityType: "print_device", entityId: id, metadata: { transport: input.transport, paperWidthMm: input.paperWidthMm, codePage: input.codePage, renderMode: input.renderMode } });
  });
  return { id };
}

/** Change le profil d'une imprimante de CE commerce (largeur, page de codes, mode d'écriture). */
export async function updatePrintDevice(db: CommercialDatabase, context: Context, deviceId: string, raw: unknown) {
  await requirePrinter(db, context, "configure");
  const input = z.object(profileFields).parse(raw);
  await db.transaction(async (tx) => {
    const updated = await tx.update(printDevice).set(input).where(and(eq(printDevice.businessId, context.businessId), eq(printDevice.id, deviceId), isNull(printDevice.archivedAt))).returning({ id: printDevice.id });
    if (!updated.length) throw new CommercialError("Imprimante introuvable.", 404, "not_found");
    await tx.insert(auditEvent).values({ id: randomUUID(), businessId: context.businessId, actorUserId: context.actorUserId, eventType: "printer.device_updated",
      entityType: "print_device", entityId: deviceId, metadata: input });
  });
  return { id: deviceId, ...input };
}

export async function archivePrintDevice(db: CommercialDatabase, context: Context, deviceId: string, now = new Date()) {
  await requirePrinter(db, context, "configure");
  const archived = await db.update(printDevice).set({ archivedAt: now }).where(and(eq(printDevice.businessId, context.businessId), eq(printDevice.id, deviceId), isNull(printDevice.archivedAt))).returning({ id: printDevice.id });
  if (!archived.length) throw new CommercialError("Imprimante introuvable.", 404, "not_found");
  return { archived: true };
}

const jobInput = z.object({
  deviceId: z.string().min(1).max(100), kind: z.enum(["receipt", "test"]), saleId: z.string().min(1).max(100).optional(),
  reprintOfJobId: z.string().min(1).max(100).optional(), language: z.enum(["fr", "en", "ar"]).default("fr"),
  /** Clé de l'intention « réimprimer » (I-8) : un double clic renvoie la même tâche au lieu d'en créer deux. */
  idempotencyKey: idempotencyKeySchema.optional(),
});

/**
 * Ticket prêt pour le navigateur. `payload` : octets ESC/POS en texte (sans logo), ou `null` si le ticket
 * doit partir en image (arabe, caractère hors page de codes, ou profil « image ») : le navigateur rend
 * alors `layout` en image. Dans les deux cas, `layout` vient du même document : aucun montant n'est
 * recalculé ailleurs.
 */
function prepareTicket(build: (render: "text" | "raster") => TicketLayout, profile: PrinterProfile) {
  let layout = build("text");
  let text = encodeTicketText(layout, profile);
  const render = chooseRender(profile, { direction: layout.direction, unsupportedCharacters: text.unsupportedCharacters });
  if (render === "raster") { layout = build("raster"); text = encodeTicketText(layout, profile); }
  return {
    deliver: true as const, render, layout,
    profile: { paperWidthMm: profile.paperWidthMm, dots: profile.dots, columns: profile.columns, codePage: profile.codePage },
    payload: render === "text" ? Buffer.from(text.bytes).toString("base64") : null,
    preview: text.preview, unsupportedCharacters: render === "text" ? text.unsupportedCharacters : 0,
  };
}
const nothingToSend = { deliver: false as const, render: null, layout: null, profile: null, payload: null, preview: null, unsupportedCharacters: 0 };

/**
 * Prépare une tâche. Pour un ticket de vente : la vente doit exister dans CE commerce (validée par le
 * serveur). Une seule impression d'origine par (vente, imprimante) : un second appel (double clic,
 * impression automatique rejouée) renvoie la même tâche, que le service local refusera d'imprimer deux fois.
 * Si cette tâche est déjà transmise, rien n'est renvoyé : il faut demander une réimpression.
 *
 * Une réimpression est une nouvelle tâche liée à l'originale et tracée dans l'audit. Avec une clé
 * d'intention (`idempotencyKey`), elle passe par `runIdempotent` : la même clé renvoie la même tâche (I-8).
 * La route HTTP exige cette clé (`requireReprintKey`). Toute création de tâche vérifie que le commerce
 * n'est ni suspendu ni expiré ; le ticket à l'écran reste consultable.
 */
export async function createPrintJob(db: CommercialDatabase, context: Context, raw: unknown, now = new Date(), options: { requireReprintKey?: boolean } = {}) {
  await requirePrinter(db, context, "print");
  const input = jobInput.parse(raw);
  const [settings] = await db.select().from(printerSettings).where(eq(printerSettings.businessId, context.businessId)).limit(1);
  if (!settings?.enabled) throw new CommercialError("Le module d’impression n’est pas activé pour ce commerce.", 409, "module_disabled");
  const [device] = await db.select().from(printDevice).where(and(eq(printDevice.businessId, context.businessId), eq(printDevice.id, input.deviceId), isNull(printDevice.archivedAt))).limit(1);
  if (!device) throw new CommercialError("Imprimante introuvable.", 404, "not_found");
  const profile = resolveProfile(device);
  const jobValues = { businessId: context.businessId, deviceId: device.id, createdByUserId: context.actorUserId, createdAt: now, updatedAt: now };

  if (input.kind === "test") {
    const [business] = await db.select({ name: organization.name }).from(organization).where(eq(organization.id, context.businessId)).limit(1);
    const id = randomUUID();
    await db.transaction(async (tx) => {
      await assertBusinessOperational(tx, context.businessId, now);
      await tx.insert(printJob).values({ id, ...jobValues, kind: "test" });
    });
    const ticket = prepareTicket((render) => layoutTestTicket({ businessName: business?.name ?? "", language: input.language, profile, render, now }), profile);
    return { job: { id, status: "pending" as const, kind: "test" as const, duplicate: false }, ...ticket };
  }

  if (!input.saleId) throw new CommercialError("Choisissez la vente à imprimer.", 400, "validation");
  const saleId = input.saleId;
  // getSaleReceipt vérifie aussi la permission de lecture des ventes et l'appartenance de la vente au commerce.
  const document = buildReceiptDocument(await getSaleReceipt(db, { businessId: context.businessId, actorUserId: context.actorUserId, saleId }), { language: input.language });

  const insertReprint = async (tx: CommercialTransaction, reprintOf: string) => {
    const id = randomUUID();
    await tx.insert(printJob).values({ id, ...jobValues, saleId, kind: "receipt", reprintOfJobId: reprintOf });
    await tx.insert(auditEvent).values({ id: randomUUID(), businessId: context.businessId, actorUserId: context.actorUserId, eventType: "printer.receipt_reprinted",
      entityType: "sale", entityId: saleId, metadata: { jobId: id, reprintOfJobId: reprintOf } });
    return { jobId: id };
  };
  const createReprint = async (reprintOf: string) => {
    if (input.idempotencyKey) {
      const result = await runIdempotent(db, { businessId: context.businessId, actorUserId: context.actorUserId, idempotencyKey: input.idempotencyKey, operation: "print.reprint",
        request: { saleId, deviceId: device.id, reprintOfJobId: reprintOf } }, (tx) => insertReprint(tx, reprintOf));
      return { id: result.jobId, duplicate: result.replayed };
    }
    const created = await db.transaction(async (tx) => { await assertBusinessOperational(tx, context.businessId, now); return insertReprint(tx, reprintOf); });
    return { id: created.jobId, duplicate: false };
  };

  let job: { id: string; duplicate: boolean };
  if (input.reprintOfJobId) {
    if (options.requireReprintKey && !input.idempotencyKey) throw new CommercialError("La demande de réimpression doit porter une clé d’opération.", 400, "idempotency_key_required");
    const [original] = await db.select({ id: printJob.id, saleId: printJob.saleId }).from(printJob).where(and(eq(printJob.businessId, context.businessId), eq(printJob.id, input.reprintOfJobId))).limit(1);
    if (!original || original.saleId !== saleId) throw new CommercialError("Impression d’origine introuvable.", 404, "not_found");
    job = await createReprint(original.id);
  } else {
    const id = randomUUID();
    const created = await db.transaction(async (tx) => {
      await assertBusinessOperational(tx, context.businessId, now);
      return tx.insert(printJob).values({ id, ...jobValues, saleId, kind: "receipt" }).onConflictDoNothing().returning({ id: printJob.id });
    });
    if (created.length) job = { id, duplicate: false };
    else {
      const [existing] = await db.select({ id: printJob.id, status: printJob.status }).from(printJob).where(and(eq(printJob.businessId, context.businessId), eq(printJob.saleId, saleId),
        eq(printJob.deviceId, device.id), eq(printJob.kind, "receipt"), isNull(printJob.reprintOfJobId))).limit(1);
      // Relance depuis la caisse après un échec : renvoyer la même tâche ferait rejouer l'échec mémorisé
      // par le service local. On crée donc une réimpression liée, tracée comme les autres (I-3).
      job = existing!.status === "failed" ? await createReprint(existing!.id) : { id: existing!.id, duplicate: true };
    }
  }

  const [current] = await db.select({ status: printJob.status }).from(printJob).where(and(eq(printJob.businessId, context.businessId), eq(printJob.id, job.id))).limit(1);
  const status = current?.status ?? "pending";
  const result = { job: { id: job.id, status, duplicate: job.duplicate, kind: "receipt" as const } };
  // Tâche déjà terminée (transmise, annulée, ou échec mémorisé par le service local) : rien à renvoyer.
  if (status !== "pending" && status !== "uncertain") return { ...result, ...nothingToSend };
  return { ...result, ...prepareTicket(() => layoutReceipt(document), profile) };
}

const transitions: Record<string, string[]> = { pending: ["printed", "failed", "uncertain", "canceled"], uncertain: ["printed", "failed", "canceled"], failed: [], printed: [], canceled: [] };

/**
 * Résultat rapporté par le navigateur. `printed` = transmis sans erreur signalée ; `uncertain` : réponse
 * perdue, on ne relance pas à l'aveugle ; la personne indique ensuite si le ticket est sorti (printed) ou
 * non (failed, puis réimpression volontaire).
 */
export async function reportPrintResult(db: CommercialDatabase, context: Context, jobId: string, raw: unknown, now = new Date()) {
  await requirePrinter(db, context, "print");
  const input = z.object({ status: z.enum(["printed", "failed", "uncertain", "canceled"]), errorCode: z.string().regex(/^[a-z_]{1,40}$/).optional(), deviceStatus: z.string().regex(/^[a-z_,]{1,120}$/).optional() }).parse(raw);
  const [job] = await db.select().from(printJob).where(and(eq(printJob.businessId, context.businessId), eq(printJob.id, jobId))).limit(1);
  if (!job) throw new CommercialError("Tâche d’impression introuvable.", 404, "not_found");
  if (job.status === input.status) return { id: job.id, status: job.status, replayed: true };
  if (!transitions[job.status]?.includes(input.status)) throw new CommercialError("Cette tâche ne peut plus changer d’état.", 409, "job_final");
  await db.update(printJob).set({ status: input.status, errorCode: input.errorCode ?? null, updatedAt: now }).where(and(eq(printJob.businessId, context.businessId), eq(printJob.id, job.id)));
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

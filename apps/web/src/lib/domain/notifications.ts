import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { hasBusinessPermission } from "../auth/permissions";
import {
  auditEvent, businessMemberAccess, businessProfile, businessSubscription, member, notification, notificationCampaign, notificationDelivery,
  notificationOutbox, notificationPreference, notificationTemplate, organization, platformAdmin, pushSubscription, session, user,
} from "../db/schema";
import {
  categories, defaultTemplates, effectivePreference, eventDefinitions, icons, inQuietHours, localMinute, localizedTemplate, locales, pushGenericBody,
  renderText, segmentActivities, segmentLifecycles, transactionalCategories, validateTemplateText,
  type Category, type EventKey, type NotificationLocale, type Segment, type TemplateDefinition, type Variable,
} from "../notifications/catalog";
import { isAllowedPushEndpoint, type PushResult, type PushSender } from "../notifications/web-push";
import { CommercialError, type CommercialDatabase } from "./commercial";
import type { CommercialTransaction } from "./operation-guard";

/*
 * Moteur de notifications (mission 10), sur le principe de la boîte d'envoi transactionnelle :
 * 1. l'opération métier écrit son événement dans `notification_outbox`, dans SA transaction (enqueueNotification) ;
 * 2. un processus indépendant (après la réponse HTTP, ou la tâche planifiée) le traite (processNotificationOutbox) ;
 * 3. il crée les notifications internes des destinataires autorisés puis tente les envois push ;
 * 4. résultats, échecs et appareils expirés sont enregistrés.
 * Une vente n'attend jamais une notification : une panne push laisse la vente intacte.
 */

type Db = CommercialDatabase | CommercialTransaction;

/* ------------------------------------------------------------------ 1. Écriture dans la boîte d'envoi */

/** À appeler dans la transaction de l'opération métier. Un événement déjà connu (`dedupKey`) n'est pas dupliqué. */
export async function enqueueNotification(tx: Db, input: { businessId: string | null; eventType: EventKey | "announcement"; payload: Record<string, string>; dedupKey: string; campaignId?: string }) {
  // Échéance écrite par le serveur, comme la comparaison de `processNotificationOutbox` : avec le défaut
  // `now()` de la base, un serveur en retard sur la base laisserait l'événement attendre la tâche planifiée.
  await tx.insert(notificationOutbox).values({ id: randomUUID(), businessId: input.businessId, eventType: input.eventType, payload: input.payload,
    dedupKey: input.dedupKey.slice(0, 200), campaignId: input.campaignId ?? null, nextAttemptAt: new Date() }).onConflictDoNothing({ target: notificationOutbox.dedupKey });
}

/* ------------------------------------------------------------------ 2. Traitement */

const maxAttempts = 5;
const backoffMinutes = [1, 5, 30, 120, 720];
const pushRatePerHour = 30;

async function templateFor(db: Db, key: string): Promise<TemplateDefinition | null> {
  const [stored] = await db.select().from(notificationTemplate).where(eq(notificationTemplate.key, key)).limit(1);
  if (stored) return { ...stored, kind: stored.kind as "event", category: stored.category as Category, icon: stored.icon as TemplateDefinition["icon"] };
  return defaultTemplates.find((template) => template.key === key) ?? null;
}

type Recipient = { userId: string; businessId: string | null; businessName: string; timezone: string };

/** Membres actifs (accès non désactivé) d'un commerce qui ont la permission demandée. */
async function businessRecipients(db: Db, businessId: string, permission: [string, string] | null): Promise<Recipient[]> {
  const rows = await db.select({ userId: member.userId, role: member.role, businessName: organization.name, timezone: businessProfile.timezone })
    .from(member).innerJoin(organization, eq(organization.id, member.organizationId)).innerJoin(businessProfile, eq(businessProfile.businessId, member.organizationId))
    .leftJoin(businessMemberAccess, and(eq(businessMemberAccess.businessId, member.organizationId), eq(businessMemberAccess.userId, member.userId)))
    .where(and(eq(member.organizationId, businessId), isNull(businessMemberAccess.disabledAt)));
  return rows.filter((row) => !permission || hasBusinessPermission(row.role, permission[0] as Parameters<typeof hasBusinessPermission>[1], permission[1]))
    .map((row) => ({ userId: row.userId, businessId, businessName: row.businessName, timezone: row.timezone }));
}

/** Destinataires d'une annonce : critères décidés par le serveur (activité, état d'abonnement, rôle). */
async function segmentRecipients(db: Db, segment: Segment, now: Date): Promise<Recipient[]> {
  const rows = await db.select({ userId: member.userId, role: member.role, businessId: member.organizationId, businessName: organization.name,
    timezone: businessProfile.timezone, activity: businessProfile.activity, status: businessProfile.status })
    .from(member).innerJoin(organization, eq(organization.id, member.organizationId)).innerJoin(businessProfile, eq(businessProfile.businessId, member.organizationId))
    .leftJoin(businessMemberAccess, and(eq(businessMemberAccess.businessId, member.organizationId), eq(businessMemberAccess.userId, member.userId)))
    .where(isNull(businessMemberAccess.disabledAt));
  let candidates = rows;
  if (segment.activities?.length) candidates = candidates.filter((row) => segment.activities!.includes(row.activity as (typeof segmentActivities)[number]));
  if (segment.roles?.length && !segment.roles.includes("all")) candidates = candidates.filter((row) => row.role.split(",").some((role) => segment.roles!.includes(role.trim() as "owner")));
  if (segment.subscriptionStatuses?.length) {
    const subscriptions = await db.select({ businessId: businessSubscription.businessId, status: businessSubscription.status, endsAt: businessSubscription.endsAt }).from(businessSubscription);
    const statusOf = new Map<string, string>();
    for (const item of subscriptions) {
      const state = (item.status === "trialing" || item.status === "active") && item.endsAt <= now ? "expired" : item.status;
      if (!statusOf.has(item.businessId) || state === "active" || state === "trialing") statusOf.set(item.businessId, state);
    }
    candidates = candidates.filter((row) => segment.subscriptionStatuses!.includes(statusOf.get(row.businessId) as "active"));
  }
  return candidates.map((row) => ({ userId: row.userId, businessId: row.businessId, businessName: row.businessName, timezone: row.timezone }));
}

function formatDate(date: Date, locale: NotificationLocale, timeZone: string) {
  return date.toLocaleDateString(locale === "ar" ? "ar" : locale === "en" ? "en-GB" : "fr-FR", { dateStyle: "medium", timeZone });
}

const statusWords: Record<string, Record<NotificationLocale, string>> = {
  short: { fr: "manque", en: "money missing", ar: "نقص" }, over: { fr: "excédent", en: "money over", ar: "زيادة" },
};

type ProcessOptions = { now?: Date; limit?: number; sender?: PushSender | null };

/**
 * Traite les événements en attente. Verrou court (`locked_until`) et `FOR UPDATE SKIP LOCKED` : deux
 * processus simultanés ne prennent jamais le même événement. Renvoie un résumé (aucune donnée métier).
 */
export async function processNotificationOutbox(db: CommercialDatabase, options: ProcessOptions = {}) {
  const now = options.now ?? new Date();
  const claimed = await db.transaction(async (tx) => {
    const rows = await tx.select({ id: notificationOutbox.id }).from(notificationOutbox)
      .where(and(eq(notificationOutbox.status, "pending"), lte(notificationOutbox.nextAttemptAt, now), or(isNull(notificationOutbox.lockedUntil), lt(notificationOutbox.lockedUntil, now))))
      .orderBy(notificationOutbox.createdAt).limit(options.limit ?? 25).for("update", { skipLocked: true });
    if (rows.length) await tx.update(notificationOutbox).set({ lockedUntil: new Date(now.getTime() + 120_000) }).where(inArray(notificationOutbox.id, rows.map((row) => row.id)));
    return rows.map((row) => row.id);
  });
  const summary = { processed: 0, notifications: 0, pushSent: 0, pushFailed: 0, skipped: 0, failed: 0 };
  for (const id of claimed) {
    const [event] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)).limit(1);
    if (!event) continue;
    try {
      const outcome = await handleEvent(db, event, now, options.sender ?? null);
      if (outcome.postponeMinutes) {
        await db.update(notificationOutbox).set({ lockedUntil: null, nextAttemptAt: new Date(now.getTime() + outcome.postponeMinutes * 60_000) }).where(eq(notificationOutbox.id, id));
        continue;
      }
      await db.update(notificationOutbox).set({ status: outcome.skipped ? "skipped" : "done", processedAt: now, lockedUntil: null, recipientCount: outcome.notifications, lastError: outcome.skipped ?? null })
        .where(eq(notificationOutbox.id, id));
      summary.processed += 1; summary.notifications += outcome.notifications; summary.pushSent += outcome.pushSent; summary.pushFailed += outcome.pushFailed;
      if (outcome.skipped) summary.skipped += 1;
    } catch (error) {
      const attempts = event.attempts + 1;
      // Message technique court, sans contenu métier.
      const message = error instanceof Error ? error.message.slice(0, 200) : "erreur";
      await db.update(notificationOutbox).set({ attempts, lockedUntil: null, lastError: message, status: attempts >= maxAttempts ? "failed" : "pending",
        nextAttemptAt: new Date(now.getTime() + (backoffMinutes[attempts - 1] ?? 720) * 60_000) }).where(eq(notificationOutbox.id, id));
      summary.failed += 1;
    }
  }
  const retried = await retryPushDeliveries(db, now, options.sender ?? null);
  summary.pushSent += retried.sent; summary.pushFailed += retried.failed;
  return summary;
}

async function handleEvent(db: CommercialDatabase, event: typeof notificationOutbox.$inferSelect, now: Date, sender: PushSender | null) {
  const payload = (event.payload ?? {}) as Record<string, string>;
  let template: TemplateDefinition | null;
  let recipients: Recipient[];
  let link: string | null;
  if (event.eventType === "announcement") {
    const [campaign] = event.campaignId ? await db.select().from(notificationCampaign).where(eq(notificationCampaign.id, event.campaignId)).limit(1) : [];
    if (!campaign || campaign.status === "canceled") return { notifications: 0, pushSent: 0, pushFailed: 0, skipped: "campaign_canceled" };
    if (campaign.status === "paused") return { notifications: 0, pushSent: 0, pushFailed: 0, postponeMinutes: 5 };
    const [stored] = await db.select().from(notificationTemplate).where(eq(notificationTemplate.id, campaign.templateId)).limit(1);
    template = stored ? { ...stored, kind: "announcement", category: stored.category as Category, icon: stored.icon as TemplateDefinition["icon"] } : null;
    recipients = await segmentRecipients(db, campaign.segment as Segment, now);
    link = template?.linkPath ?? null;
  } else {
    const definition = eventDefinitions[event.eventType as EventKey];
    if (!definition) return { notifications: 0, pushSent: 0, pushFailed: 0, skipped: "unknown_event" };
    template = await templateFor(db, event.eventType === "system.test" && payload.templateKey ? payload.templateKey : event.eventType);
    if (event.eventType === "system.test") {
      recipients = payload.userId ? [{ userId: payload.userId, businessId: null, businessName: "Qadr Ops", timezone: "Africa/Abidjan" }] : [];
    } else {
      recipients = event.businessId ? await businessRecipients(db, event.businessId, definition.permission) : [];
      if (definition.skipActor) recipients = recipients.filter((recipient) => recipient.userId !== payload.actorUserId);
    }
    link = template?.linkPath ?? definition.link(payload);
  }
  if (!template) return { notifications: 0, pushSent: 0, pushFailed: 0, skipped: "no_template" };
  // Un modèle désactivé ne s'applique pas aux événements métier ; un test l'envoie quand même (aperçu réel).
  if (!template.active && event.eventType !== "system.test") return { notifications: 0, pushSent: 0, pushFailed: 0, skipped: "template_inactive" };
  const category = template.category;
  const userIds = [...new Set([...recipients.map((recipient) => recipient.userId), ...(payload.actorUserId ? [payload.actorUserId] : [])])];
  const [preferences, names] = userIds.length ? await Promise.all([
    db.select().from(notificationPreference).where(inArray(notificationPreference.userId, userIds)),
    db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, userIds)),
  ]) : [[], []];
  const preferenceOf = new Map(preferences.map((row) => [row.userId, row]));
  const nameOf = new Map(names.map((row) => [row.id, row.name]));

  let created = 0, pushSent = 0, pushFailed = 0;
  for (const recipient of recipients) {
    const stored = preferenceOf.get(recipient.userId);
    const locale = (stored?.locale ?? "fr") as NotificationLocale;
    const preference = effectivePreference(stored?.categories, category);
    if (!preference.inApp) continue;
    const values: Partial<Record<Variable, string>> = {
      business_name: recipient.businessName, user_name: payload.subjectUserId ? nameOf.get(payload.subjectUserId) ?? "" : payload.actorUserId ? nameOf.get(payload.actorUserId) ?? "" : "",
      event_date: formatDate(payload.eventDate ? new Date(payload.eventDate) : event.createdAt, locale, recipient.timezone),
      event_type: event.eventType, status: payload.status ? statusWords[payload.status]?.[locale] ?? "" : "", product_name: payload.productName ?? "",
    };
    const text = localizedTemplate(template, locale);
    const id = randomUUID();
    const [inserted] = await db.insert(notification).values({ id, userId: recipient.userId, businessId: recipient.businessId, outboxId: event.id, templateKey: template.key,
      category, icon: template.icon, title: renderText(text.title, values), body: renderText(text.body, values), linkPath: link })
      .onConflictDoNothing({ target: [notification.outboxId, notification.userId] }).returning({ id: notification.id, title: notification.title });
    if (!inserted) continue; // déjà créée lors d'un essai précédent : pas de second push.
    created += 1;
    const pushed = await pushToUser(db, { notificationId: inserted.id, userId: recipient.userId, title: inserted.title, locale, link, category,
      pushEnabled: Boolean(stored?.pushEnabled) && preference.push, quiet: inQuietHours(localMinute(now, recipient.timezone), stored?.quietStartMinute ?? null, stored?.quietEndMinute ?? null) }, now, sender);
    pushSent += pushed.sent; pushFailed += pushed.failed;
  }
  return { notifications: created, pushSent, pushFailed, skipped: null as string | null };
}

async function pushToUser(db: CommercialDatabase, input: { notificationId: string; userId: string; title: string; locale: NotificationLocale; link: string | null; category: Category; pushEnabled: boolean; quiet: boolean }, now: Date, sender: PushSender | null) {
  const devices = (await db.select({ device: pushSubscription }).from(pushSubscription).innerJoin(session, liveDeviceSession(now))
    .where(and(eq(pushSubscription.userId, input.userId), isNull(pushSubscription.disabledAt)))).map((row) => row.device);
  if (!devices.length) return { sent: 0, failed: 0 };
  const record = (subscriptionId: string | null, status: typeof notificationDelivery.$inferInsert["status"], extra: Partial<typeof notificationDelivery.$inferInsert> = {}) =>
    db.insert(notificationDelivery).values({ id: randomUUID(), notificationId: input.notificationId, subscriptionId, status, attemptedAt: now, ...extra });
  if (!input.pushEnabled) { await record(null, "skipped_preference"); return { sent: 0, failed: 0 }; }
  const transactional = transactionalCategories.has(input.category);
  if (input.quiet && !transactional) { await record(null, "skipped_quiet"); return { sent: 0, failed: 0 }; }
  if (!transactional) {
    const [recent] = await db.select({ count: sql<number>`count(*)::int` }).from(notificationDelivery)
      .innerJoin(pushSubscription, eq(pushSubscription.id, notificationDelivery.subscriptionId))
      .where(and(eq(pushSubscription.userId, input.userId), eq(notificationDelivery.status, "sent"), gte(notificationDelivery.attemptedAt, new Date(now.getTime() - 3_600_000))));
    if ((recent?.count ?? 0) >= pushRatePerHour) { await record(null, "skipped_rate"); return { sent: 0, failed: 0 }; }
  }
  if (!sender) { await record(null, "skipped_unconfigured"); return { sent: 0, failed: 0 }; }
  let sent = 0, failed = 0;
  for (const device of devices) {
    const result = await deliver(db, sender, device, { notificationId: input.notificationId, title: input.title, locale: input.locale, link: input.link, urgent: transactional }, now, 1);
    if (result) sent += 1; else failed += 1;
  }
  return { sent, failed };
}

/**
 * Mission 13 : un appareil ne reçoit les notifications d'un compte que tant que la session qui l'a
 * enregistré existe, appartient à ce compte et n'a pas expiré. Déconnexion, expiration, révocation
 * (nouveau mot de passe, « fermer les autres sessions ») coupent donc les envois, même si le navigateur
 * n'a pas pu prévenir le serveur.
 */
const liveDeviceSession = (now: Date) => and(eq(session.id, pushSubscription.sessionId), eq(session.userId, pushSubscription.userId), gt(session.expiresAt, now));

/** Message push : titre sûr, texte générique, lien interne. Jamais le corps de la notification ni un montant. */
function pushPayload(input: { notificationId: string; title: string; locale: NotificationLocale; link: string | null }) {
  return { title: input.title, body: pushGenericBody[input.locale], url: input.link ?? "/business/notifications", tag: input.notificationId };
}

async function deliver(db: CommercialDatabase, sender: PushSender, device: typeof pushSubscription.$inferSelect,
  input: { notificationId: string; title: string; locale: NotificationLocale; link: string | null; urgent: boolean }, now: Date, attempt: number, deliveryId?: string) {
  // Une exception du service push devient un échec réessayable : la notification interne existe déjà et
  // l'événement ne doit pas être rejoué (sinon ce push serait perdu, la notification n'étant pas recréée).
  const result: PushResult = await sender({ endpoint: device.endpoint, p256dh: device.p256dh, auth: device.auth }, pushPayload(input), { ttlSeconds: 86_400, urgency: input.urgent ? "high" : "normal" })
    .catch((error: unknown) => ({ ok: false, status: null, expired: false, retryable: true, error: error instanceof Error ? error.name : "error" }));
  const values = result.ok
    ? { status: "sent" as const, httpStatus: result.status, error: null, nextAttemptAt: null }
    : result.expired ? { status: "expired" as const, httpStatus: result.status, error: result.error, nextAttemptAt: null }
    : result.retryable && attempt < 3 ? { status: "retry" as const, httpStatus: result.status, error: result.error, nextAttemptAt: new Date(now.getTime() + attempt * 5 * 60_000) }
    : { status: "failed" as const, httpStatus: result.status, error: result.error, nextAttemptAt: null };
  if (deliveryId) await db.update(notificationDelivery).set({ ...values, attempts: attempt, attemptedAt: now }).where(eq(notificationDelivery.id, deliveryId));
  else await db.insert(notificationDelivery).values({ id: randomUUID(), notificationId: input.notificationId, subscriptionId: device.id, attempts: attempt, attemptedAt: now, ...values });
  if (result.ok) await db.update(pushSubscription).set({ lastSuccessAt: now, failureCount: 0 }).where(eq(pushSubscription.id, device.id));
  else if (result.expired) await db.update(pushSubscription).set({ disabledAt: now, disabledReason: "expired" }).where(eq(pushSubscription.id, device.id));
  else if (values.status === "failed") {
    // Incrément en SQL : plusieurs envois du même appareil peuvent échouer dans le même passage.
    const [updated] = await db.update(pushSubscription).set({ failureCount: sql`${pushSubscription.failureCount} + 1` }).where(eq(pushSubscription.id, device.id)).returning({ failures: pushSubscription.failureCount });
    if ((updated?.failures ?? 0) >= 5) await db.update(pushSubscription).set({ disabledAt: now, disabledReason: "too_many_failures" }).where(eq(pushSubscription.id, device.id));
  }
  return result.ok;
}

/** Relances contrôlées (au plus 3 essais) des envois push en échec temporaire. */
async function retryPushDeliveries(db: CommercialDatabase, now: Date, sender: PushSender | null) {
  if (!sender) return { sent: 0, failed: 0 };
  const due = await db.select({ delivery: notificationDelivery, item: notification, device: pushSubscription, locale: notificationPreference.locale })
    .from(notificationDelivery).innerJoin(notification, eq(notification.id, notificationDelivery.notificationId))
    .innerJoin(pushSubscription, eq(pushSubscription.id, notificationDelivery.subscriptionId))
    .innerJoin(session, liveDeviceSession(now))
    .leftJoin(notificationPreference, eq(notificationPreference.userId, notification.userId))
    // L'appareil doit encore appartenir au destinataire : sinon une relance partirait vers le compte qui l'a repris.
    .where(and(eq(notificationDelivery.status, "retry"), lte(notificationDelivery.nextAttemptAt, now), isNull(pushSubscription.disabledAt),
      eq(pushSubscription.userId, notification.userId))).limit(50);
  let sent = 0, failed = 0;
  for (const row of due) {
    const ok = await deliver(db, sender, row.device, { notificationId: row.item.id, title: row.item.title, locale: (row.locale ?? "fr") as NotificationLocale,
      link: row.item.linkPath, urgent: transactionalCategories.has(row.item.category as Category) }, now, row.delivery.attempts + 1, row.delivery.id);
    if (ok) sent += 1; else failed += 1;
  }
  return { sent, failed };
}

/** Abonnements qui se terminent dans les 3 jours : un événement par abonnement et par échéance. */
export async function enqueueExpiringSubscriptions(db: CommercialDatabase, now = new Date()) {
  const soon = await db.select({ id: businessSubscription.id, businessId: businessSubscription.businessId, endsAt: businessSubscription.endsAt }).from(businessSubscription)
    .where(and(inArray(businessSubscription.status, ["trialing", "active"]), gte(businessSubscription.endsAt, now), lte(businessSubscription.endsAt, new Date(now.getTime() + 3 * 86_400_000))));
  for (const item of soon) {
    await enqueueNotification(db, { businessId: item.businessId, eventType: "subscription.expiring", payload: { subscriptionId: item.id, eventDate: item.endsAt.toISOString() },
      dedupKey: `subscription.expiring:${item.id}:${item.endsAt.toISOString().slice(0, 10)}` });
  }
  return soon.length;
}

/* ------------------------------------------------------------------ 3. Boîte de réception d'un utilisateur */

type Inbox = { userId: string; businessId: string | null };
/** Ses propres notifications, du commerce actif ou personnelles ; jamais celles d'un autre commerce ou d'un autre membre. */
const inboxScope = (inbox: Inbox) => and(eq(notification.userId, inbox.userId),
  inbox.businessId ? or(eq(notification.businessId, inbox.businessId), isNull(notification.businessId)) : isNull(notification.businessId));

const listInput = z.object({ unread: z.coerce.boolean().optional(), category: z.enum(categories).optional(), before: z.string().datetime().optional(), limit: z.coerce.number().int().min(1).max(50).default(20) });

export async function listNotifications(db: CommercialDatabase, inbox: Inbox, raw: unknown = {}) {
  const filters = listInput.parse(raw);
  const conditions = [inboxScope(inbox)];
  if (filters.unread) conditions.push(isNull(notification.readAt));
  if (filters.category) conditions.push(eq(notification.category, filters.category));
  if (filters.before) conditions.push(lt(notification.createdAt, new Date(filters.before)));
  const [items, [unread]] = await Promise.all([
    db.select({ id: notification.id, category: notification.category, icon: notification.icon, title: notification.title, body: notification.body,
      linkPath: notification.linkPath, createdAt: notification.createdAt, readAt: notification.readAt })
      .from(notification).where(and(...conditions)).orderBy(desc(notification.createdAt), desc(notification.id)).limit(filters.limit + 1),
    db.select({ count: sql<number>`count(*)::int` }).from(notification).where(and(inboxScope(inbox), isNull(notification.readAt))),
  ]);
  const page = items.slice(0, filters.limit);
  return { items: page, unreadCount: unread?.count ?? 0, nextBefore: items.length > filters.limit ? page.at(-1)!.createdAt.toISOString() : null };
}

export async function unreadNotificationCount(db: CommercialDatabase, inbox: Inbox) {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(notification).where(and(inboxScope(inbox), isNull(notification.readAt)));
  return row?.count ?? 0;
}

export async function markNotificationsRead(db: CommercialDatabase, inbox: Inbox, raw: unknown, now = new Date()) {
  const input = z.object({ ids: z.array(z.string().min(1).max(100)).max(100).optional(), all: z.boolean().optional() }).parse(raw);
  if (!input.all && !input.ids?.length) return { updated: 0 };
  const updated = await db.update(notification).set({ readAt: now })
    .where(and(inboxScope(inbox), isNull(notification.readAt), ...(input.all ? [] : [inArray(notification.id, input.ids!)]))).returning({ id: notification.id });
  return { updated: updated.length };
}

/* ------------------------------------------------------------------ 4. Préférences et appareils */

export async function getNotificationPreferences(db: CommercialDatabase, userId: string) {
  const [stored] = await db.select().from(notificationPreference).where(eq(notificationPreference.userId, userId)).limit(1);
  // L'adresse push (celle des appareils de la personne elle-même) permet à l'écran de reconnaître le navigateur courant.
  const devices = await db.select({ id: pushSubscription.id, endpoint: pushSubscription.endpoint, deviceLabel: pushSubscription.deviceLabel, createdAt: pushSubscription.createdAt, lastSuccessAt: pushSubscription.lastSuccessAt })
    .from(pushSubscription).where(and(eq(pushSubscription.userId, userId), isNull(pushSubscription.disabledAt))).orderBy(desc(pushSubscription.createdAt));
  return {
    locale: (stored?.locale ?? "fr") as NotificationLocale, pushEnabled: stored?.pushEnabled ?? false,
    categories: Object.fromEntries(categories.map((category) => [category, effectivePreference(stored?.categories, category)])) as Record<Category, { inApp: boolean; push: boolean }>,
    quietStartMinute: stored?.quietStartMinute ?? null, quietEndMinute: stored?.quietEndMinute ?? null, devices,
  };
}

const preferenceInput = z.object({
  locale: z.enum(locales), pushEnabled: z.boolean(),
  categories: z.object(Object.fromEntries(categories.map((category) => [category, z.object({ inApp: z.boolean(), push: z.boolean() })])) as Record<Category, z.ZodObject<{ inApp: z.ZodBoolean; push: z.ZodBoolean }>>),
  quietStartMinute: z.number().int().min(0).max(1439).nullable(), quietEndMinute: z.number().int().min(0).max(1439).nullable(),
}).refine((value) => (value.quietStartMinute === null) === (value.quietEndMinute === null), { message: "quiet_hours" });

export async function updateNotificationPreferences(db: CommercialDatabase, userId: string, raw: unknown, now = new Date()) {
  const input = preferenceInput.parse(raw);
  const values = { locale: input.locale, pushEnabled: input.pushEnabled, categories: input.categories, quietStartMinute: input.quietStartMinute, quietEndMinute: input.quietEndMinute, updatedAt: now };
  await db.insert(notificationPreference).values({ userId, ...values }).onConflictDoUpdate({ target: notificationPreference.userId, set: values });
  return getNotificationPreferences(db, userId);
}

const subscriptionInput = z.object({
  endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/), auth: z.string().regex(/^[A-Za-z0-9_-]{16,32}$/) }),
  deviceLabel: z.string().trim().max(80).optional(),
});

/** Compte et session qui présentent l'appareil (toujours issus de la session côté serveur). */
export type PushDeviceOwner = { userId: string; sessionId: string | null };

/**
 * Enregistre l'appareil courant pour le compte connecté et la session courante (mission 13 : sans
 * session vivante de ce compte, l'appareil ne reçoit rien ; en aperçu sans session, jamais).
 *
 * Une adresse push encore active pour un autre compte n'est jamais reprise ni modifiée (409) : connaître
 * l'adresse d'un appareil d'autrui ne doit rien changer chez lui. Le navigateur se désabonne alors et
 * s'abonne de nouveau pour obtenir une adresse neuve ; l'ancienne, révoquée par le service push, expire
 * côté serveur au premier envoi (410). Une adresse désactivée peut être rattachée au compte connecté.
 */
export async function registerPushSubscription(db: CommercialDatabase, owner: PushDeviceOwner, raw: unknown, now = new Date()) {
  const input = subscriptionInput.parse(raw);
  if (!isAllowedPushEndpoint(input.endpoint)) throw new CommercialError("Service push non reconnu.", 400, "push_endpoint");
  const values = { userId: owner.userId, sessionId: owner.sessionId, p256dh: input.keys.p256dh, auth: input.keys.auth, deviceLabel: input.deviceLabel || null };
  const [row] = await db.insert(pushSubscription).values({ id: randomUUID(), endpoint: input.endpoint, ...values })
    .onConflictDoUpdate({ target: pushSubscription.endpoint, set: { ...values, disabledAt: null, disabledReason: null, failureCount: 0, createdAt: now },
      setWhere: or(eq(pushSubscription.userId, owner.userId), isNotNull(pushSubscription.disabledAt)) })
    .returning({ id: pushSubscription.id });
  if (!row) throw new CommercialError("Cet appareil est déjà relié à un autre compte.", 409, "push_endpoint_taken");
  await db.insert(notificationPreference).values({ userId: owner.userId, pushEnabled: true }).onConflictDoUpdate({ target: notificationPreference.userId, set: { pushEnabled: true, updatedAt: now } });
  return { id: row!.id };
}

/**
 * Au chargement de l'application, le navigateur présente l'adresse push qu'il détient encore.
 * - `bound` : elle est à ce compte ; elle est rattachée à la session courante (reconnexion).
 * - `foreign` : elle appartient à un autre compte (appareil partagé, déconnexion qui n'a pas abouti).
 *   Rien n'est modifié chez l'autre compte ; c'est le navigateur qui se désabonne, ce qui révoque
 *   l'adresse auprès du service push : les envois de l'autre compte échouent (410) et l'appareil expire.
 *   De toute façon, sans session vivante de l'autre compte, le serveur n'y envoyait déjà plus rien.
 * - `unknown` : adresse inconnue ou désactivée : le navigateur doit se désabonner.
 */
export async function claimPushEndpoint(db: CommercialDatabase, owner: PushDeviceOwner, raw: unknown) {
  const { endpoint } = z.object({ endpoint: z.string().url().max(1000) }).parse(raw);
  const [row] = await db.select({ id: pushSubscription.id, userId: pushSubscription.userId }).from(pushSubscription)
    .where(and(eq(pushSubscription.endpoint, endpoint), isNull(pushSubscription.disabledAt))).limit(1);
  if (!row) return { status: "unknown" as const };
  if (row.userId === owner.userId) {
    await db.update(pushSubscription).set({ sessionId: owner.sessionId }).where(eq(pushSubscription.id, row.id));
    return { status: "bound" as const };
  }
  return { status: "foreign" as const };
}

/** « Supprimer un appareil » : désactivé et clés effacées ; la ligne reste pour l'historique des envois. */
export async function removePushSubscription(db: CommercialDatabase, userId: string, subscriptionId: string, now = new Date()) {
  const removed = await db.update(pushSubscription).set({ disabledAt: now, disabledReason: "user_removed", p256dh: "", auth: "" })
    .where(and(eq(pushSubscription.id, subscriptionId), eq(pushSubscription.userId, userId), isNull(pushSubscription.disabledAt))).returning({ id: pushSubscription.id });
  if (!removed.length) throw new CommercialError("Appareil introuvable.", 404, "not_found");
  return { removed: true };
}

/** Déconnexion : ce navigateur ne doit plus recevoir les notifications du compte. Sans effet si l'adresse n'est pas à lui. */
export async function forgetPushEndpoint(db: CommercialDatabase, userId: string, raw: unknown, now = new Date()) {
  const { endpoint } = z.object({ endpoint: z.string().url().max(1000) }).parse(raw);
  const removed = await db.update(pushSubscription).set({ disabledAt: now, disabledReason: "signed_out", p256dh: "", auth: "" })
    .where(and(eq(pushSubscription.endpoint, endpoint), eq(pushSubscription.userId, userId), isNull(pushSubscription.disabledAt))).returning({ id: pushSubscription.id });
  return { removed: removed.length > 0 };
}

/* ------------------------------------------------------------------ 5. Console Super Admin */

async function requirePlatformAdmin(db: Db, actorUserId: string) {
  const [grant] = await db.select({ userId: platformAdmin.userId }).from(platformAdmin).where(and(eq(platformAdmin.userId, actorUserId), isNull(platformAdmin.revokedAt))).limit(1);
  if (!grant) throw new CommercialError("Accès réservé à l’administration de la plateforme.", 403, "forbidden");
}

export async function listNotificationTemplates(db: CommercialDatabase, actorUserId: string) {
  await requirePlatformAdmin(db, actorUserId);
  const stored = await db.select().from(notificationTemplate).orderBy(notificationTemplate.key);
  const storedKeys = new Set(stored.map((row) => row.key));
  return [
    ...stored.map((row) => ({ ...row, builtIn: defaultTemplates.some((template) => template.key === row.key), customized: true })),
    ...defaultTemplates.filter((template) => !storedKeys.has(template.key)).map((template) => ({ ...template, id: null, version: 0, updatedAt: null, builtIn: true, customized: false })),
  ].sort((a, b) => a.key.localeCompare(b.key));
}

const templateInput = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_.-]{2,60}$/), kind: z.enum(["event", "announcement"]), category: z.enum(categories), icon: z.enum(icons),
  // « //hote » serait une adresse externe pour le navigateur : le premier caractère après « / » ne peut pas être « / ».
  linkPath: z.string().regex(/^\/(?:[A-Za-z0-9_-][A-Za-z0-9/_-]*)?$/).max(200).nullable(), active: z.boolean(),
  titleFr: z.string().max(120), titleEn: z.string().max(120), titleAr: z.string().max(120), bodyFr: z.string().max(500), bodyEn: z.string().max(500), bodyAr: z.string().max(500),
});

/** Création ou modification (par clé). Un modèle d'événement ne peut porter que la clé d'un événement réellement émis. */
export async function saveNotificationTemplate(db: CommercialDatabase, actorUserId: string, raw: unknown, now = new Date()) {
  await requirePlatformAdmin(db, actorUserId);
  const input = templateInput.parse(raw);
  const trimmed = { ...input, titleFr: input.titleFr.trim(), titleEn: input.titleEn.trim(), titleAr: input.titleAr.trim(), bodyFr: input.bodyFr.trim(), bodyEn: input.bodyEn.trim(), bodyAr: input.bodyAr.trim() };
  const problems = validateTemplateText(trimmed);
  if (problems.length) throw new CommercialError(`Modèle invalide : ${problems.join(", ")}.`, 400, "template_invalid");
  if (input.kind === "event" && !(input.key in eventDefinitions)) throw new CommercialError("Aucun événement métier ne porte cette clé.", 400, "template_invalid");
  if (input.kind === "announcement" && (input.key in eventDefinitions || input.category !== "announcement")) throw new CommercialError("Une annonce utilise la catégorie « annonce » et une clé propre.", 400, "template_invalid");
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(notificationTemplate).where(eq(notificationTemplate.key, input.key)).for("update").limit(1);
    const id = existing?.id ?? randomUUID();
    const values = { ...trimmed, updatedByUserId: actorUserId, updatedAt: now };
    if (existing) await tx.update(notificationTemplate).set({ ...values, version: existing.version + 1 }).where(eq(notificationTemplate.id, id));
    else await tx.insert(notificationTemplate).values({ id, ...values });
    await tx.insert(auditEvent).values({ id: randomUUID(), businessId: null, actorUserId, eventType: existing ? "platform.notification_template_updated" : "platform.notification_template_created",
      entityType: "notification_template", entityId: id, metadata: { key: input.key, active: input.active } });
    return { id, version: (existing?.version ?? 0) + 1 };
  });
}

/** Test réel : rend le modèle pour l'administrateur et le pousse sur ses propres appareils abonnés. */
export async function sendTestNotification(db: CommercialDatabase, actorUserId: string, templateKey: string, now = new Date()) {
  await requirePlatformAdmin(db, actorUserId);
  if (!(await templateFor(db, templateKey))) throw new CommercialError("Modèle introuvable.", 404, "not_found");
  await enqueueNotification(db, { businessId: null, eventType: "system.test", payload: { userId: actorUserId, templateKey, actorUserId, eventDate: now.toISOString() }, dedupKey: `system.test:${randomUUID()}` });
  return { queued: true };
}

const segmentSchema = z.object({
  activities: z.array(z.enum(segmentActivities)).max(4).optional(), subscriptionStatuses: z.array(z.enum(segmentLifecycles)).max(3).optional(),
  roles: z.array(z.enum(["owner", "admin", "all"])).max(3).optional(),
});

export async function createAnnouncementCampaign(db: CommercialDatabase, actorUserId: string, raw: unknown) {
  await requirePlatformAdmin(db, actorUserId);
  const input = z.object({ templateId: z.string().min(1), segment: segmentSchema }).parse(raw);
  const [template] = await db.select().from(notificationTemplate).where(eq(notificationTemplate.id, input.templateId)).limit(1);
  if (!template || template.kind !== "announcement") throw new CommercialError("Choisissez un modèle d’annonce enregistré.", 400, "template_invalid");
  if (!template.active) throw new CommercialError("Ce modèle est désactivé.", 409, "template_inactive");
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(notificationCampaign).values({ id, templateId: template.id, segment: input.segment, createdByUserId: actorUserId });
    await enqueueNotification(tx, { businessId: null, eventType: "announcement", payload: { actorUserId }, dedupKey: `announcement:${id}`, campaignId: id });
    await tx.insert(auditEvent).values({ id: randomUUID(), businessId: null, actorUserId, eventType: "platform.notification_campaign_created", entityType: "notification_campaign", entityId: id, metadata: { segment: input.segment } });
  });
  return { id, status: "running" };
}

export async function setCampaignStatus(db: CommercialDatabase, actorUserId: string, campaignId: string, raw: unknown, now = new Date()) {
  await requirePlatformAdmin(db, actorUserId);
  const { action } = z.object({ action: z.enum(["pause", "resume", "cancel"]) }).parse(raw);
  const [campaign] = await db.select().from(notificationCampaign).where(eq(notificationCampaign.id, campaignId)).limit(1);
  if (!campaign) throw new CommercialError("Campagne introuvable.", 404, "not_found");
  const [outbox] = await db.select({ status: notificationOutbox.status }).from(notificationOutbox).where(eq(notificationOutbox.campaignId, campaignId)).limit(1);
  if (outbox && outbox.status !== "pending") throw new CommercialError("Cette campagne est déjà envoyée.", 409, "campaign_sent");
  const next = action === "pause" ? "paused" : action === "resume" ? "running" : "canceled";
  if (campaign.status === "canceled" || campaign.status === next) throw new CommercialError("Changement impossible pour cette campagne.", 409, "campaign_state");
  await db.update(notificationCampaign).set({ status: next, updatedAt: now }).where(eq(notificationCampaign.id, campaignId));
  if (action === "resume") await db.update(notificationOutbox).set({ nextAttemptAt: now }).where(eq(notificationOutbox.campaignId, campaignId));
  await db.insert(auditEvent).values({ id: randomUUID(), businessId: null, actorUserId, eventType: `platform.notification_campaign_${action}`, entityType: "notification_campaign", entityId: campaignId, metadata: {} });
  return { id: campaignId, status: next };
}

/**
 * Historique et statistiques d'envoi : types d'événements, commerce concerné, comptes et codes d'erreur.
 * Aucun contenu de notification ni donnée commerciale n'est renvoyé à la console.
 */
export async function getNotificationActivity(db: CommercialDatabase, actorUserId: string, now = new Date()) {
  await requirePlatformAdmin(db, actorUserId);
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const [byStatus, deliveries, history, campaigns, errors] = await Promise.all([
    db.select({ status: notificationOutbox.status, count: sql<number>`count(*)::int` }).from(notificationOutbox).where(gte(notificationOutbox.createdAt, since)).groupBy(notificationOutbox.status),
    db.select({ status: notificationDelivery.status, count: sql<number>`count(*)::int` }).from(notificationDelivery).where(gte(notificationDelivery.attemptedAt, since)).groupBy(notificationDelivery.status),
    db.select({ id: notificationOutbox.id, eventType: notificationOutbox.eventType, businessName: organization.name, status: notificationOutbox.status,
      recipientCount: notificationOutbox.recipientCount, attempts: notificationOutbox.attempts, createdAt: notificationOutbox.createdAt, processedAt: notificationOutbox.processedAt })
      .from(notificationOutbox).leftJoin(organization, eq(organization.id, notificationOutbox.businessId)).orderBy(desc(notificationOutbox.createdAt)).limit(40),
    db.select({ id: notificationCampaign.id, status: notificationCampaign.status, templateKey: notificationTemplate.key, segment: notificationCampaign.segment, createdAt: notificationCampaign.createdAt,
      recipients: sql<number>`coalesce((select o.recipient_count from notification_outbox o where o.campaign_id = ${notificationCampaign.id} limit 1), 0)::int` })
      .from(notificationCampaign).innerJoin(notificationTemplate, eq(notificationTemplate.id, notificationCampaign.templateId)).orderBy(desc(notificationCampaign.createdAt)).limit(20),
    db.select({ error: notificationDelivery.error, count: sql<number>`count(*)::int` }).from(notificationDelivery)
      .where(and(gte(notificationDelivery.attemptedAt, since), inArray(notificationDelivery.status, ["failed", "expired", "retry"]))).groupBy(notificationDelivery.error).limit(10),
  ]);
  return { outbox: byStatus, deliveries, history, campaigns, errors };
}

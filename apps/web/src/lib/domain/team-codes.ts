import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { hasBusinessPermission } from "@/lib/auth/permissions";
import {
  account, auditEvent, businessInviteCode, businessProfile, businessSubscription, member, organization, platformAdmin, session, user,
} from "../db/schema";
import { accessCodeFamilyOf, accessCodeHint, generateAccessCode, hashAccessCode, normalizeAccessCode } from "../security/access-codes";
import { assertActiveMembership, BusinessContextError } from "./business-context";
import type { CommercialDatabase } from "./commercial";
import { CommercialError } from "./commercial";
import { assertPlanQuota } from "./plan-limits";
import { businessLifecycle } from "./subscription-lifecycle";

/**
 * Codes d'invitation des employés (2026-11-16, docs/team-invite-codes.md). Domaine B, séparé des codes
 * commerciaux (domaine A) : autre table, autre préfixe (`EQP-`), autre clé d'empreinte, autres routes.
 *
 * - Créé par le propriétaire ou un administrateur pour LEUR commerce ; le rôle est fixé ici, côté serveur.
 * - Jamais `owner` (ni droit de la plateforme). Un administrateur ne délègue que les rôles inférieurs au sien.
 * - Usage unique, expirant (7 jours par défaut), révocable, jamais stocké en clair, montré une seule fois.
 * - N'accorde aucun abonnement. Le commerce doit avoir un droit d'usage en cours (essai ou abonnement actif) au
 *   moment où l'employé rejoint l'équipe.
 * - L'employé choisit un nom d'utilisateur et un mot de passe personnel ; aucune adresse e-mail n'est exigée ni
 *   inventée. Le code ne sert qu'une fois ; ensuite l'employé se connecte normalement.
 */

type Db = CommercialDatabase;
type TeamContext = { businessId: string; actorUserId: string };

export const inviteCodeRoles = ["admin", "cashier", "stock_manager", "accountant", "member"] as const;
export type InviteCodeRole = (typeof inviteCodeRoles)[number];

/** Rôles qu'un acteur peut attribuer par code : le propriétaire jusqu'à administrateur, l'administrateur en dessous. */
export function delegableRoles(actorRole: string): InviteCodeRole[] {
  if (actorRole === "owner") return [...inviteCodeRoles];
  if (actorRole === "admin") return inviteCodeRoles.filter((role) => role !== "admin");
  return [];
}

export const DEFAULT_INVITE_DAYS = 7;
const dayMs = 86_400_000;

export type InviteCodeState = "pending" | "used" | "expired" | "revoked";
export function inviteCodeState(row: { consumedAt: Date | null; revokedAt: Date | null; expiresAt: Date }, now = new Date()): InviteCodeState {
  if (row.consumedAt) return "used";
  if (row.revokedAt) return "revoked";
  if (row.expiresAt <= now) return "expired";
  return "pending";
}

async function requireCodeManager(db: Db, context: TeamContext) {
  const role = await assertActiveMembership(db, context.businessId, context.actorUserId);
  if (!hasBusinessPermission(role, "invitation", "create")) throw new BusinessContextError("Seuls le propriétaire et les administrateurs gèrent l’équipe.", 403);
  return role;
}

/** Le commerce a-t-il un droit d'usage en cours (essai ou abonnement actif, non suspendu) ? */
async function businessIsOpen(db: Pick<Db, "select">, businessId: string, now: Date) {
  const [[profile], subscriptions] = await Promise.all([
    db.select({ status: businessProfile.status }).from(businessProfile).where(eq(businessProfile.businessId, businessId)).limit(1),
    db.select({ status: businessSubscription.status, endsAt: businessSubscription.endsAt }).from(businessSubscription).where(eq(businessSubscription.businessId, businessId)),
  ]);
  if (!profile) return false;
  const lifecycle = businessLifecycle(profile.status, subscriptions, now);
  return lifecycle === "active" || lifecycle === "trial";
}

/* ------------------------------------------------------------------ Côté commerce */

const createSchema = z.object({
  role: z.enum(inviteCodeRoles),
  displayName: z.string().trim().max(80).optional().transform((value) => value || null),
  expiresInDays: z.number().int().min(1).max(30).default(DEFAULT_INVITE_DAYS),
});

export async function createInviteCode(db: Db, context: TeamContext, raw: unknown, now = new Date()) {
  const actorRole = await requireCodeManager(db, context);
  const input = createSchema.parse(raw);
  if (!delegableRoles(actorRole).includes(input.role)) throw new BusinessContextError("Votre rôle ne permet pas d’attribuer ce rôle.", 403, "role_not_delegable");
  if (!(await businessIsOpen(db, context.businessId, now))) throw new BusinessContextError("Ce commerce n’a pas d’abonnement en cours : aucun employé ne peut le rejoindre.", 403, "business_closed");
  try { await assertPlanQuota(db, context.businessId, "users", now); }
  catch (error) { if (error instanceof CommercialError) throw new BusinessContextError(error.message, error.status, error.code ?? "plan_limit"); throw error; }
  const code = generateAccessCode("invite");
  const normalized = normalizeAccessCode("invite", code)!;
  const id = randomUUID();
  const expiresAt = new Date(now.getTime() + input.expiresInDays * dayMs);
  await db.transaction(async (tx) => {
    await tx.insert(businessInviteCode).values({
      id, businessId: context.businessId, codeHash: hashAccessCode("invite", normalized), codeHint: accessCodeHint(normalized), role: input.role,
      displayName: input.displayName, createdByUserId: context.actorUserId, createdAt: now, expiresAt,
    });
    await tx.insert(auditEvent).values({
      id: randomUUID(), businessId: context.businessId, actorUserId: context.actorUserId, eventType: "team.invite_code_created", entityType: "business_invite_code", entityId: id,
      metadata: { role: input.role, hint: accessCodeHint(normalized), expiresAt: expiresAt.toISOString() }, occurredAt: now,
    });
  });
  // Seule apparition du code brut.
  return { id, code, hint: accessCodeHint(normalized), role: input.role, displayName: input.displayName, expiresAt: expiresAt.toISOString() };
}

export async function listInviteCodes(db: Db, context: TeamContext, now = new Date()) {
  const actorRole = await requireCodeManager(db, context);
  const creator = alias(user, "invite_creator");
  const consumer = alias(user, "invite_consumer");
  const rows = await db.select({
    id: businessInviteCode.id, hint: businessInviteCode.codeHint, role: businessInviteCode.role, displayName: businessInviteCode.displayName,
    createdAt: businessInviteCode.createdAt, expiresAt: businessInviteCode.expiresAt, revokedAt: businessInviteCode.revokedAt, consumedAt: businessInviteCode.consumedAt,
    createdBy: creator.name, consumedBy: sql<string | null>`coalesce(${consumer.displayUsername}, ${consumer.name})`,
  }).from(businessInviteCode)
    .innerJoin(creator, eq(creator.id, businessInviteCode.createdByUserId))
    .leftJoin(consumer, eq(consumer.id, businessInviteCode.consumedByUserId))
    .where(eq(businessInviteCode.businessId, context.businessId))
    .orderBy(desc(businessInviteCode.createdAt), desc(businessInviteCode.id)).limit(100);
  const allowed = delegableRoles(actorRole);
  return {
    delegableRoles: allowed,
    codes: rows.map((row) => ({
      ...row, state: inviteCodeState(row, now), canRevoke: allowed.includes(row.role as InviteCodeRole) && inviteCodeState(row, now) === "pending",
      createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null, consumedAt: row.consumedAt?.toISOString() ?? null,
    })),
  };
}

export async function revokeInviteCode(db: Db, context: TeamContext, codeId: string, now = new Date()) {
  const actorRole = await requireCodeManager(db, context);
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(businessInviteCode)
      .where(and(eq(businessInviteCode.id, codeId), eq(businessInviteCode.businessId, context.businessId))).for("update").limit(1);
    // Un code d'un autre commerce répond comme un code inconnu.
    if (!row) throw new BusinessContextError("Code introuvable.", 404, "not_found");
    if (!delegableRoles(actorRole).includes(row.role as InviteCodeRole)) throw new BusinessContextError("Votre rôle ne permet pas de révoquer ce code.", 403, "role_not_delegable");
    if (row.consumedAt) throw new BusinessContextError("Ce code a déjà été utilisé.", 409, "already_used");
    if (row.revokedAt) return { id: row.id, state: "revoked" as const, replayed: true };
    await tx.update(businessInviteCode).set({ revokedAt: now, revokedByUserId: context.actorUserId }).where(eq(businessInviteCode.id, row.id));
    await tx.insert(auditEvent).values({
      id: randomUUID(), businessId: context.businessId, actorUserId: context.actorUserId, eventType: "team.invite_code_revoked", entityType: "business_invite_code", entityId: row.id,
      metadata: { role: row.role, hint: row.codeHint }, occurredAt: now,
    });
    return { id: row.id, state: "revoked" as const, replayed: false };
  });
}

/**
 * Ferme toutes les sessions d'un employé (2026-11-16). Seulement pour un compte dont ce commerce est la SEULE
 * appartenance : un compte qui appartient aussi à d'autres commerces perd seulement ce commerce actif.
 */
export async function revokeMemberSessions(db: Db, context: TeamContext, memberId: string) {
  const actorRole = await requireCodeManager(db, context);
  const [target] = await db.select({ id: member.id, userId: member.userId, role: member.role }).from(member)
    .where(and(eq(member.id, memberId), eq(member.organizationId, context.businessId))).limit(1);
  if (!target) throw new BusinessContextError("Membre introuvable dans ce commerce.", 404, "not_found");
  if (target.userId === context.actorUserId) throw new BusinessContextError("Vous ne pouvez pas fermer vos propres sessions ici.", 403);
  if (target.role === "owner" || (target.role === "admin" && actorRole !== "owner")) throw new BusinessContextError("Votre rôle ne permet pas d’agir sur ce membre.", 403, "role_not_delegable");
  return db.transaction(async (tx) => {
    const memberships = await tx.select({ organizationId: member.organizationId }).from(member).where(eq(member.userId, target.userId));
    const onlyHere = memberships.every((row) => row.organizationId === context.businessId);
    const closed = onlyHere
      ? await tx.delete(session).where(eq(session.userId, target.userId)).returning({ id: session.id })
      : await tx.update(session).set({ activeOrganizationId: null }).where(and(eq(session.userId, target.userId), eq(session.activeOrganizationId, context.businessId))).returning({ id: session.id });
    await tx.insert(auditEvent).values({
      id: randomUUID(), businessId: context.businessId, actorUserId: context.actorUserId, eventType: "team.sessions_revoked", entityType: "member", entityId: target.id,
      metadata: { sessions: closed.length, scope: onlyHere ? "account" : "business" },
    });
    return { memberId: target.id, sessions: closed.length, scope: onlyHere ? "account" as const : "business" as const };
  });
}

/* ------------------------------------------------------------------ Côté employé (sans session) */

function readInviteCode(raw: unknown) {
  if (accessCodeFamilyOf(raw) === "commercial") {
    throw new CommercialError("Ce code active un abonnement Qadr Ops : saisissez-le sur la page « J’ai un code Qadr Agency ».", 422, "commercial_code");
  }
  const normalized = normalizeAccessCode("invite", raw);
  if (!normalized) throw new CommercialError("Code invalide. Vérifiez chaque caractère.", 404, "invalid");
  return hashAccessCode("invite", normalized);
}

function inviteStateError(state: InviteCodeState) {
  if (state === "used") return new CommercialError("Ce code a déjà été utilisé.", 409, "already_used");
  if (state === "revoked") return new CommercialError("Ce code a été annulé par le commerce.", 410, "revoked");
  return new CommercialError("Ce code a expiré. Demandez-en un nouveau au responsable du commerce.", 410, "expired");
}

/** Ce que l'employé voit avant de créer son compte : nom du commerce et rôle, rien d'autre. */
export async function checkInviteCode(db: Db, rawCode: unknown, now = new Date()) {
  const [row] = await db.select({
    id: businessInviteCode.id, businessId: businessInviteCode.businessId, role: businessInviteCode.role, displayName: businessInviteCode.displayName,
    expiresAt: businessInviteCode.expiresAt, revokedAt: businessInviteCode.revokedAt, consumedAt: businessInviteCode.consumedAt,
    businessName: organization.name, logo: organization.logo,
  }).from(businessInviteCode).innerJoin(organization, eq(organization.id, businessInviteCode.businessId))
    .where(eq(businessInviteCode.codeHash, readInviteCode(rawCode))).limit(1);
  if (!row) throw new CommercialError("Code invalide. Vérifiez chaque caractère.", 404, "invalid");
  const state = inviteCodeState(row, now);
  if (state !== "pending") throw inviteStateError(state);
  if (!(await businessIsOpen(db, row.businessId, now))) throw new CommercialError("Ce commerce n’a pas d’abonnement en cours. Prévenez son responsable.", 403, "business_closed");
  return { businessName: row.businessName, logo: row.logo, role: row.role as InviteCodeRole, displayName: row.displayName, expiresAt: row.expiresAt.toISOString() };
}

export const usernameSchema = z.string().trim().toLowerCase()
  .min(3, "Le nom d’utilisateur compte au moins 3 caractères.").max(30, "Le nom d’utilisateur compte au plus 30 caractères.")
  .regex(/^[a-z0-9._]+$/, "Utilisez seulement des lettres sans accent, des chiffres, le point et le tiret bas.");

const acceptSchema = z.object({
  code: z.string().max(64),
  name: z.string().trim().min(2, "Indiquez votre nom.").max(80),
  username: usernameSchema,
  password: z.string().min(8, "Le mot de passe compte au moins 8 caractères.").max(128),
});

/**
 * Crée le compte de l'employé et son appartenance au commerce, consomme le code, trace : une seule transaction.
 * Le rôle vient du code, jamais du corps de la requête. Rend l'identifiant du compte et du commerce ; la session
 * est ouverte ensuite par l'appelant (connexion par nom d'utilisateur côté serveur).
 */
export async function acceptInviteCode(db: Db, raw: unknown, now = new Date()) {
  const input = acceptSchema.parse(raw);
  const codeHash = readInviteCode(input.code);
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(businessInviteCode).where(eq(businessInviteCode.codeHash, codeHash)).for("update").limit(1);
    if (!row) throw new CommercialError("Code invalide. Vérifiez chaque caractère.", 404, "invalid");
    const state = inviteCodeState(row, now);
    if (state !== "pending") throw inviteStateError(state);
    if (!(inviteCodeRoles as readonly string[]).includes(row.role)) throw new CommercialError("Code invalide.", 404, "invalid");
    // Verrou partagé du profil : une suspension simultanée attend la fin de cette transaction.
    const [profile] = await tx.select({ status: businessProfile.status }).from(businessProfile).where(eq(businessProfile.businessId, row.businessId)).for("share").limit(1);
    if (!profile || !(await businessIsOpen(tx as Db, row.businessId, now))) throw new CommercialError("Ce commerce n’a pas d’abonnement en cours. Prévenez son responsable.", 403, "business_closed");
    await assertPlanQuota(tx as Db, row.businessId, "users", now);
    const [taken] = await tx.select({ id: user.id }).from(user).where(eq(user.username, input.username)).limit(1);
    if (taken) throw new CommercialError("Ce nom d’utilisateur est déjà pris. Choisissez-en un autre.", 409, "username_taken");
    const userId = randomUUID();
    const memberId = randomUUID();
    await tx.insert(user).values({ id: userId, name: input.name, email: null, emailVerified: false, username: input.username, displayUsername: input.username, createdAt: now, updatedAt: now });
    await tx.insert(account).values({ id: randomUUID(), accountId: userId, providerId: "credential", userId, password: passwordHash, createdAt: now, updatedAt: now });
    await tx.insert(member).values({ id: memberId, organizationId: row.businessId, userId, role: row.role, createdAt: now });
    const consumed = await tx.update(businessInviteCode).set({ consumedAt: now, consumedByUserId: userId })
      .where(and(eq(businessInviteCode.id, row.id), sql`${businessInviteCode.consumedAt} is null`, sql`${businessInviteCode.revokedAt} is null`)).returning({ id: businessInviteCode.id });
    if (!consumed.length) throw inviteStateError("used");
    await tx.insert(auditEvent).values({
      id: randomUUID(), businessId: row.businessId, actorUserId: userId, eventType: "team.member_joined_by_code", entityType: "member", entityId: memberId,
      metadata: { role: row.role, codeId: row.id, hint: row.codeHint, createdBy: row.createdByUserId }, occurredAt: now,
    });
    return { userId, memberId, businessId: row.businessId, role: row.role as InviteCodeRole, username: input.username };
  });
}

/** Compte du propriétaire de la plateforme : jamais connecté par cette voie (même réponse qu'un mauvais mot de passe). */
export async function isPlatformOwnerUsername(db: Pick<Db, "select">, username: string) {
  const [row] = await db.select({ userId: platformAdmin.userId }).from(platformAdmin).innerJoin(user, eq(user.id, platformAdmin.userId))
    .where(and(eq(user.username, username), sql`${platformAdmin.revokedAt} is null`)).limit(1);
  return Boolean(row);
}


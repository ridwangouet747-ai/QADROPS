import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { emailRequestScope, type EmailRequestScope } from "@/lib/auth/email";
import { businessActivities, storeFormats, type QadrAuth } from "@/lib/auth/server";
import { locales } from "@/lib/i18n/config";
import { hasBusinessPermission } from "@/lib/auth/permissions";
import { auditEvent, businessMemberAccess, businessProfile, businessSubscription, invitation, member, organization, session, user } from "@/lib/db/schema";
import { assertActiveMembership, BusinessContextError } from "./business-context";
import { CommercialError, type CommercialDatabase } from "./commercial";
import { assertPlanQuota } from "./plan-limits";
import { businessLifecycle } from "./subscription-lifecycle";
import { logoSchema } from "./business-logo";
import { campaignOutcomeForBusiness, signupCampaignScope, type SignupCampaignScope } from "./public-campaigns";
import { accessActivationScope, readAccessPass, type AccessActivationScope } from "@/lib/commercial/access-pass";
import { accessCodeRequired } from "@/lib/commercial/mode";
import { usableCommercialCodeById } from "./commercial-codes";

export const assignableRoles = ["owner", "admin", "cashier", "stock_manager", "accountant", "member"] as const;
export type AssignableRole = (typeof assignableRoles)[number];

/** Erreurs de Better Auth (APIError) traduites en statut HTTP sans exposer leur détail. */
function fromAuthError(error: unknown, fallback: string): never {
  const status = typeof error === "object" && error && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 400;
  throw new BusinessContextError(fallback, status >= 500 ? 500 : status);
}

/* ------------------------------------------------------------------ Compte */

export async function getAccountOverview(db: CommercialDatabase, userId: string, activeBusinessId: string | null) {
  // L’espace commerçant ne révèle jamais si le compte détient aussi le droit plateforme (aucun raccourci vers la console).
  const [memberships] = await Promise.all([
    db.select({ id: organization.id, name: organization.name, logo: organization.logo, role: member.role, activity: businessProfile.activity,
      status: businessProfile.status, timezone: businessProfile.timezone, disabledAt: businessMemberAccess.disabledAt })
      .from(member).innerJoin(organization, eq(organization.id, member.organizationId))
      .leftJoin(businessProfile, eq(businessProfile.businessId, organization.id))
      .leftJoin(businessMemberAccess, and(eq(businessMemberAccess.businessId, member.organizationId), eq(businessMemberAccess.userId, member.userId)))
      .where(eq(member.userId, userId)).orderBy(asc(organization.name)),
  ]);
  const visible = memberships.filter((row) => row.activity !== null);
  // État commercial de chaque commerce : l’interface masque les modules d’un commerce sans droit d’usage ;
  // le refus reste appliqué côté serveur (getBusinessContext, requireBusinessPageAccess).
  const subscriptions = visible.length ? await db.select({ businessId: businessSubscription.businessId, status: businessSubscription.status, endsAt: businessSubscription.endsAt })
    .from(businessSubscription).where(inArray(businessSubscription.businessId, visible.map((row) => row.id))) : [];
  const now = new Date();
  const businesses = visible.map((row) => ({
    id: row.id, name: row.name, logo: row.logo, role: row.role, activity: row.activity, status: row.status, timezone: row.timezone,
    lifecycle: businessLifecycle(row.status ?? "active", subscriptions.filter((item) => item.businessId === row.id), now),
    disabled: row.disabledAt !== null, active: row.id === activeBusinessId,
  }));
  return { businesses, activeBusinessId: businesses.some((row) => row.active && !row.disabled) ? activeBusinessId : null };
}

export { logoBytesMatch } from "./business-logo";

export const createBusinessInput = z.object({
  name: z.string().trim().min(2).max(120), activity: z.enum(businessActivities),
  phone: z.string().trim().max(40).optional(), address: z.string().trim().max(200).optional(), logo: logoSchema.optional(),
  storeFormat: z.enum(storeFormats).optional(), displayName: z.string().trim().max(80).optional(),
  /** Identifiant du brouillon d'inscription : rejouer la même création renvoie le commerce déjà créé. */
  creationKey: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/).optional(),
  /**
   * Campagne publique choisie à l'inscription (mission 12) : seulement le code et la formule. Durée et
   * remise sont relues par le serveur ; un code mal formé ne bloque pas la création (« unavailable »).
   */
  promotion: z.object({ code: z.string().max(60), planCode: z.string().max(60).optional() }).strict().optional(),
});

export function businessSlug(name: string) {
  const base = name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "commerce";
  return `${base}-${randomUUID().slice(0, 8)}`;
}

/**
 * Crée le commerce via Better Auth (le créateur devient `owner`) ; le profil est créé par le hook d'organisation.
 * Avec une `creationKey` déjà utilisée par ce même propriétaire, renvoie le commerce existant au lieu d'en
 * créer un second (réponse perdue puis nouvel essai). Deux envois strictement simultanés restent protégés
 * par l'index unique sur `business_profile.creation_key` (voir docs/onboarding.md).
 *
 * Avec `promotion`, la campagne publique est réclamée dans la transaction qui crée le profil (crochet
 * `afterCreateOrganization`) ; `promotion` dans la réponse dit si l'avantage a été appliqué. Un rejeu
 * renvoie la réclamation déjà faite, jamais une seconde (docs/promotions.md).
 */
export async function createBusiness(auth: QadrAuth, headers: Headers, raw: unknown, db?: CommercialDatabase) {
  const input = createBusinessInput.parse(raw);
  if (input.creationKey && db) {
    const current = await auth.api.getSession({ headers });
    if (!current) throw new BusinessContextError("Authentification requise.", 401);
    const [existing] = await db.select({ id: organization.id, name: organization.name }).from(businessProfile)
      .innerJoin(organization, eq(organization.id, businessProfile.businessId))
      .innerJoin(member, and(eq(member.organizationId, businessProfile.businessId), eq(member.userId, current.user.id), eq(member.role, "owner")))
      .where(eq(businessProfile.creationKey, input.creationKey)).limit(1);
    if (existing) {
      await auth.api.setActiveOrganization({ headers, body: { organizationId: existing.id } });
      const claimed = await campaignOutcomeForBusiness(db, existing.id);
      return { id: existing.id, name: existing.name, replayed: true, promotion: claimed ?? (input.promotion ? { status: "unavailable" as const } : null), access: null };
    }
  }
  // Modèle commercial du 2026-11-16 : un commerce ne s'ouvre qu'avec un code d'accès vérifié (laissez-passer posé
  // par /api/public/access-codes/check). Le code est relu ici, puis consommé dans la transaction de création.
  const passCodeId = readAccessPass(headers);
  const usablePass = passCodeId && db ? await usableCommercialCodeById(db, passCodeId) : null;
  if (accessCodeRequired() && !usablePass) {
    throw new BusinessContextError("Un code d’accès Qadr Agency valide est nécessaire pour ouvrir un commerce.", 403, "access_code_required");
  }
  const activation: AccessActivationScope | undefined = usablePass ? { codeId: usablePass.id } : undefined;
  const scope: SignupCampaignScope | undefined = input.promotion ? { request: input.promotion } : undefined;
  try {
    const createOrganization = () => auth.api.createOrganization({ headers, body: {
      name: input.name, slug: businessSlug(input.name), logo: input.logo,
      metadata: {
        activity: input.activity, phone: input.phone ?? "", address: input.address ?? "", storeFormat: input.storeFormat ?? "",
        displayName: input.displayName ?? "", creationKey: input.creationKey ?? "",
      }, keepCurrentActiveOrganization: false } });
    const withCampaign = () => scope ? signupCampaignScope.run(scope, createOrganization) : createOrganization();
    const created = activation ? await accessActivationScope.run(activation, withCampaign) : await withCampaign();
    if (!created) throw new BusinessContextError("Le commerce n’a pas pu être créé.", 500);
    return {
      id: created.id, name: created.name, replayed: false, promotion: scope ? scope.outcome ?? { status: "unavailable" as const } : null,
      access: activation ? activation.outcome ?? { status: "failed" as const, code: "error" } : null,
    };
  } catch (error) {
    if (error instanceof BusinessContextError) throw error;
    return fromAuthError(error, "Le commerce n’a pas pu être créé.");
  }
}

export async function setActiveBusiness(auth: QadrAuth, db: CommercialDatabase, headers: Headers, userId: string, raw: unknown) {
  const { businessId } = z.object({ businessId: z.string().min(1).max(100) }).parse(raw);
  await assertActiveMembership(db, businessId, userId);
  try {
    await auth.api.setActiveOrganization({ headers, body: { organizationId: businessId } });
  } catch (error) { return fromAuthError(error, "Ce commerce n’est pas accessible avec ce compte."); }
  return { businessId };
}

/* ------------------------------------------------------------------ Équipe */

type TeamContext = { businessId: string; actorUserId: string };

async function requireTeamManager(db: CommercialDatabase, context: TeamContext) {
  const role = await assertActiveMembership(db, context.businessId, context.actorUserId);
  if (!hasBusinessPermission(role, "invitation", "create")) throw new BusinessContextError("Seuls le propriétaire et les administrateurs gèrent l’équipe.", 403);
  return role;
}

/** Matrice lisible des droits par rôle, issue de la même définition que les contrôles serveur. */
export function roleMatrix() {
  const resources = ["sale", "payment", "product", "inventory", "customer", "supplier", "purchase", "expense", "report", "invitation", "business"] as const;
  return assignableRoles.map((role) => ({
    role, permissions: Object.fromEntries(resources.map((resource) => [resource,
      ["create", "read", "update", "record", "count", "validate", "adjust", "archive", "refund"].filter((action) => hasBusinessPermission(role, resource, action))])),
  }));
}

export async function listTeam(db: CommercialDatabase, context: TeamContext) {
  await requireTeamManager(db, context);
  const [members, invitations] = await Promise.all([
    db.select({ memberId: member.id, userId: member.userId, name: user.name, email: user.email, username: user.displayUsername, role: member.role, joinedAt: member.createdAt, disabledAt: businessMemberAccess.disabledAt })
      .from(member).innerJoin(user, eq(user.id, member.userId))
      .leftJoin(businessMemberAccess, and(eq(businessMemberAccess.businessId, member.organizationId), eq(businessMemberAccess.userId, member.userId)))
      .where(eq(member.organizationId, context.businessId)).orderBy(asc(user.name)),
    db.select({ id: invitation.id, email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt, createdAt: invitation.createdAt })
      .from(invitation).where(and(eq(invitation.organizationId, context.businessId), eq(invitation.status, "pending"), gt(invitation.expiresAt, new Date())))
      .orderBy(asc(invitation.createdAt)),
  ]);
  return {
    members: members.map(({ disabledAt, ...row }) => ({ ...row, joinedAt: row.joinedAt.toISOString(), disabled: disabledAt !== null, self: row.userId === context.actorUserId })),
    invitations: invitations.map((row) => ({ ...row, expiresAt: row.expiresAt.toISOString(), createdAt: row.createdAt.toISOString(), path: `/invitations/${row.id}` })),
    roles: roleMatrix(),
  };
}

const inviteInput = z.object({ email: z.email().max(254), role: z.enum(assignableRoles), emailLocale: z.enum(locales).optional() });

/** Issue réelle de l'e-mail d'invitation : « sent » signifie accepté par Resend, pas lu par le destinataire. */
export type InvitationEmailStatus = "sent" | "failed" | "not_configured";

export async function inviteMember(auth: QadrAuth, db: CommercialDatabase, headers: Headers, context: TeamContext, raw: unknown) {
  const actorRole = await requireTeamManager(db, context);
  const input = inviteInput.parse(raw);
  if (input.role === "owner" && actorRole !== "owner") throw new BusinessContextError("Seul un propriétaire peut inviter un autre propriétaire.", 403);
  // 2026-11-16 : un administrateur ne délègue que les rôles inférieurs au sien (même règle que les codes d'équipe).
  if (input.role === "admin" && actorRole !== "owner") throw new BusinessContextError("Seul un propriétaire peut nommer un administrateur.", 403, "role_not_delegable");
  const email = input.email.trim().toLowerCase();
  const [existing] = await db.select({ id: member.id }).from(member).innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, context.businessId), sql`lower(${user.email}) = ${email}`)).limit(1);
  if (existing) throw new BusinessContextError("Cette personne fait déjà partie de l’équipe.", 409);
  // Une invitation renouvelée occupe déjà sa place ; une nouvelle doit tenir dans la limite du forfait.
  const [pendingForEmail] = await db.select({ id: invitation.id }).from(invitation)
    .where(and(eq(invitation.organizationId, context.businessId), eq(invitation.status, "pending"), gt(invitation.expiresAt, new Date()), sql`lower(${invitation.email}) = ${email}`)).limit(1);
  if (!pendingForEmail) {
    try { await assertPlanQuota(db, context.businessId, "users"); }
    catch (error) { if (error instanceof CommercialError) throw new BusinessContextError(error.message, error.status); throw error; }
  }
  try {
    // Langue choisie par la personne qui invite (le destinataire n'a pas encore de préférence), français par défaut.
    const scope: EmailRequestScope = { locale: input.emailLocale ?? "fr" };
    const created = await emailRequestScope.run(scope, () =>
      auth.api.createInvitation({ headers, body: { email, role: input.role, organizationId: context.businessId, resend: true } }));
    const delivery = scope.invitationDelivery ? await scope.invitationDelivery : null;
    const emailStatus: InvitationEmailStatus = delivery ? delivery.status : "not_configured";
    await db.insert(auditEvent).values({ id: randomUUID(), businessId: context.businessId, actorUserId: context.actorUserId, eventType: "team.invitation_created", entityType: "invitation", entityId: created.id, metadata: { role: input.role, email: emailStatus } });
    return { id: created.id, path: `/invitations/${created.id}`, expiresAt: new Date(created.expiresAt).toISOString(), emailStatus };
  } catch (error) {
    if (error instanceof BusinessContextError) throw error;
    return fromAuthError(error, "L’invitation n’a pas pu être créée.");
  }
}

export async function cancelInvitation(auth: QadrAuth, db: CommercialDatabase, headers: Headers, context: TeamContext, invitationId: string) {
  await requireTeamManager(db, context);
  const [row] = await db.select({ id: invitation.id }).from(invitation).where(and(eq(invitation.id, invitationId), eq(invitation.organizationId, context.businessId))).limit(1);
  if (!row) throw new BusinessContextError("Invitation introuvable.", 404);
  try { await auth.api.cancelInvitation({ headers, body: { invitationId } }); } catch (error) { return fromAuthError(error, "L’invitation n’a pas pu être annulée."); }
  await db.insert(auditEvent).values({ id: randomUUID(), businessId: context.businessId, actorUserId: context.actorUserId, eventType: "team.invitation_canceled", entityType: "invitation", entityId: invitationId, metadata: {} });
  return { canceled: true };
}

async function targetMember(db: CommercialDatabase, context: TeamContext, memberId: string, actorRole: string) {
  const [target] = await db.select({ id: member.id, userId: member.userId, role: member.role }).from(member)
    .where(and(eq(member.id, memberId), eq(member.organizationId, context.businessId))).limit(1);
  if (!target) throw new BusinessContextError("Membre introuvable dans ce commerce.", 404);
  if (target.userId === context.actorUserId) throw new BusinessContextError("Vous ne pouvez pas modifier votre propre accès.", 403);
  if (target.role === "owner" && actorRole !== "owner") throw new BusinessContextError("Seul un propriétaire peut modifier un autre propriétaire.", 403);
  if (target.role === "admin" && actorRole !== "owner") throw new BusinessContextError("Seul un propriétaire peut modifier un administrateur.", 403, "role_not_delegable");
  return target;
}

export async function changeMemberRole(auth: QadrAuth, db: CommercialDatabase, headers: Headers, context: TeamContext, memberId: string, raw: unknown) {
  const actorRole = await requireTeamManager(db, context);
  const { role } = z.object({ role: z.enum(assignableRoles) }).parse(raw);
  const target = await targetMember(db, context, memberId, actorRole);
  if (role === "owner" && actorRole !== "owner") throw new BusinessContextError("Seul un propriétaire peut nommer un autre propriétaire.", 403);
  if (role === "admin" && actorRole !== "owner") throw new BusinessContextError("Seul un propriétaire peut nommer un administrateur.", 403, "role_not_delegable");
  try { await auth.api.updateMemberRole({ headers, body: { memberId, role, organizationId: context.businessId } }); } catch (error) { return fromAuthError(error, "Le rôle n’a pas pu être modifié."); }
  await db.insert(auditEvent).values({ id: randomUUID(), businessId: context.businessId, actorUserId: context.actorUserId, eventType: "team.role_changed", entityType: "member", entityId: target.id, metadata: { from: target.role, to: role } });
  return { memberId, role };
}

/**
 * Désactive ou réactive l'accès d'un membre sans supprimer son historique. Les sessions où ce
 * commerce était actif perdent immédiatement leur commerce actif.
 */
export async function setMemberAccess(db: CommercialDatabase, context: TeamContext, memberId: string, raw: unknown) {
  const actorRole = await requireTeamManager(db, context);
  const { disabled } = z.object({ disabled: z.boolean() }).parse(raw);
  const target = await targetMember(db, context, memberId, actorRole);
  return db.transaction(async (tx) => {
    if (disabled && target.role === "owner") {
      const owners = await tx.select({ userId: member.userId }).from(member)
        .leftJoin(businessMemberAccess, and(eq(businessMemberAccess.businessId, member.organizationId), eq(businessMemberAccess.userId, member.userId)))
        .where(and(eq(member.organizationId, context.businessId), eq(member.role, "owner"), isNull(businessMemberAccess.disabledAt)));
      if (owners.filter((row) => row.userId !== target.userId).length === 0) throw new BusinessContextError("Le dernier propriétaire actif ne peut pas être désactivé.", 409);
    }
    await tx.insert(businessMemberAccess).values({ businessId: context.businessId, userId: target.userId, disabledAt: disabled ? new Date() : null, disabledByUserId: disabled ? context.actorUserId : null, updatedAt: new Date() })
      .onConflictDoUpdate({ target: [businessMemberAccess.businessId, businessMemberAccess.userId], set: { disabledAt: disabled ? new Date() : null, disabledByUserId: disabled ? context.actorUserId : null, updatedAt: new Date() } });
    if (disabled) await tx.update(session).set({ activeOrganizationId: null }).where(and(eq(session.userId, target.userId), eq(session.activeOrganizationId, context.businessId)));
    await tx.insert(auditEvent).values({ id: randomUUID(), businessId: context.businessId, actorUserId: context.actorUserId, eventType: disabled ? "team.access_disabled" : "team.access_enabled", entityType: "member", entityId: target.id, metadata: {} });
    return { memberId, disabled };
  });
}

/* ------------------------------------------------------------------ Invitation reçue */

/**
 * Invitation vue par le compte connecté. `needsEmailVerification` : l'adresse doit être confirmée avant
 * d'accepter (Better Auth le refuse de toute façon ; l'écran l'explique au lieu d'échouer).
 */
export async function getInvitationForUser(db: CommercialDatabase, invitationId: string, userEmail: string | null, verification = { required: false, emailVerified: true }) {
  const [row] = await db.select({ id: invitation.id, email: invitation.email, role: invitation.role, status: invitation.status, expiresAt: invitation.expiresAt, businessName: organization.name, logo: organization.logo })
    .from(invitation).innerJoin(organization, eq(organization.id, invitation.organizationId)).where(eq(invitation.id, invitationId)).limit(1);
  // Une invitation destinée à une autre adresse est traitée comme introuvable : rien n'est révélé.
  if (!row || !userEmail || row.email.toLowerCase() !== userEmail.toLowerCase()) throw new BusinessContextError("Invitation introuvable pour ce compte.", 404);
  const state = row.status !== "pending" ? row.status : row.expiresAt <= new Date() ? "expired" : "pending";
  return {
    id: row.id, role: row.role, businessName: row.businessName, logo: row.logo, state, expiresAt: row.expiresAt.toISOString(),
    email: row.email, needsEmailVerification: verification.required && !verification.emailVerified,
  };
}

export async function acceptInvitation(auth: QadrAuth, headers: Headers, invitationId: string) {
  try {
    const result = await auth.api.acceptInvitation({ headers, body: { invitationId } });
    const businessId = result?.member.organizationId;
    if (businessId) await auth.api.setActiveOrganization({ headers, body: { organizationId: businessId } });
    return { businessId: businessId ?? null };
  } catch (error) {
    const code = typeof error === "object" && error && "body" in error ? (error.body as { code?: string } | undefined)?.code : undefined;
    if (code?.startsWith("EMAIL_VERIFICATION_REQUIRED")) throw new BusinessContextError("Confirmez d’abord votre adresse e-mail pour rejoindre ce commerce.", 403);
    return fromAuthError(error, "Cette invitation n’est plus valable ou ne correspond pas à ce compte.");
  }
}


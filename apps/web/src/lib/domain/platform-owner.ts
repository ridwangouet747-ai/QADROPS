import { createHash, timingSafeEqual } from "node:crypto";
import { count, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { account, platformAdmin, session as sessionTable, twoFactor, user } from "../db/schema";
import type { QadrAuth } from "../auth/server";
import { consumeRateLimits, rateRules, refundRateLimit } from "../security/rate-limit";
import { CommercialError, type CommercialDatabase } from "./commercial";
import { writePlatformAudit } from "./platform";

/**
 * Compte propriétaire de la plateforme (mission 13). Créé par `scripts/platform-owner.ts` ou, depuis le
 * 2026-11-12, à la première connexion à partir de deux variables du serveur (`ensureSeededPlatformOwner`).
 * Jamais à partir d'une valeur envoyée par le navigateur, jamais d'une valeur écrite dans le code.
 *
 * - Mot de passe haché par Better Auth (`ctx.password.hash`, scrypt), jamais écrit ni journalisé.
 * - Nom d'utilisateur en minuscules et unique. Les routes Better Auth ne peuvent pas le modifier
 *   (`immutableUsername`) ; seul le propriétaire connecté le change, avec son mot de passe (`changeOwnerUsername`).
 * - Un seul propriétaire actif : l'initialisation est refusée dès qu'un droit `platform_admin` actif existe.
 */
export const OWNER_MIN_PASSWORD_LENGTH = 12;
const usernameSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._]{2,29}$/, "Nom d’utilisateur : 3 à 30 caractères (a-z, 0-9, point, tiret bas), commençant par une lettre ou un chiffre.");
const passwordSchema = z.string().min(OWNER_MIN_PASSWORD_LENGTH, `Mot de passe : au moins ${OWNER_MIN_PASSWORD_LENGTH} caractères.`).max(128);
const bootstrapSchema = z.object({
  username: usernameSchema,
  email: z.email().max(254),
  name: z.string().trim().min(2).max(100),
  password: passwordSchema,
}).strict();
const resetSchema = z.object({ username: usernameSchema, password: passwordSchema }).strict();

export async function bootstrapPlatformOwner(auth: QadrAuth, db: CommercialDatabase, raw: unknown, reason = "Initialisation du propriétaire (scripts/platform-owner.ts)") {
  const input = bootstrapSchema.parse(raw);
  const [active] = await db.select({ total: count() }).from(platformAdmin).where(isNull(platformAdmin.revokedAt));
  if (Number(active?.total ?? 0) > 0) throw new CommercialError("Un propriétaire de la plateforme est déjà actif : initialisation refusée.", 409);
  const [taken] = await db.select({ id: user.id }).from(user)
    .where(sql`lower(${user.email}) = ${input.email.toLowerCase()} or ${user.username} = ${input.username}`).limit(1);
  // Un compte de commerce existant n'est jamais promu ni modifié : le propriétaire a son propre compte.
  if (taken) throw new CommercialError("Adresse ou nom d’utilisateur déjà utilisé : choisissez un compte dédié à l’administration.", 409);

  const context = await auth.$context;
  const hash = await context.password.hash(input.password);
  const created = await context.internalAdapter.createUser({
    email: input.email.toLowerCase(), name: input.name, emailVerified: false, username: input.username, displayUsername: input.username,
  }, { method: "admin" });
  await context.internalAdapter.linkAccount({ userId: created.id, providerId: "credential", accountId: created.id, password: hash });
  await db.transaction(async (tx) => {
    await tx.insert(platformAdmin).values({ userId: created.id, grantedByUserId: null });
    await writePlatformAudit(tx as never, {
      actorUserId: null, eventType: "platform.owner_bootstrapped", entityType: "user", entityId: created.id,
      before: { admin: false }, after: { admin: true }, reason,
    });
  });
  return { userId: created.id, username: input.username };
}

/**
 * Renouvellement du mot de passe du propriétaire par un opérateur ayant accès à la base (mot de passe
 * oublié, suspicion de fuite). Toutes les sessions du compte sont fermées.
 */
export async function resetPlatformOwnerPassword(auth: QadrAuth, db: CommercialDatabase, raw: unknown) {
  const input = resetSchema.parse(raw);
  const [owner] = await db.select({ id: user.id }).from(user).innerJoin(platformAdmin, eq(platformAdmin.userId, user.id))
    .where(sql`${user.username} = ${input.username} and ${platformAdmin.revokedAt} is null`).limit(1);
  if (!owner) throw new CommercialError("Aucun propriétaire actif avec ce nom d’utilisateur.", 404);
  const context = await auth.$context;
  const hash = await context.password.hash(input.password);
  const updated = await db.update(account).set({ password: hash, updatedAt: new Date() })
    .where(sql`${account.userId} = ${owner.id} and ${account.providerId} = 'credential'`).returning({ id: account.id });
  if (!updated.length) throw new CommercialError("Le compte propriétaire n’a pas de mot de passe enregistré.", 409);
  const closed = await db.delete(sessionTable).where(eq(sessionTable.userId, owner.id)).returning({ id: sessionTable.id });
  await writePlatformAudit(db as never, {
    actorUserId: null, eventType: "platform.owner_password_reset", entityType: "user", entityId: owner.id,
    reason: "Renouvellement du mot de passe (scripts/platform-owner.ts)", metadata: { sessionsClosed: closed.length },
  });
  return { userId: owner.id, sessionsClosed: closed.length };
}

/**
 * Compte de départ (2026-11-12) : `QADR_OWNER_USERNAME` et `QADR_OWNER_PASSWORD`, posés dans l'hébergement,
 * créent le propriétaire à la première tentative de connexion, quand aucun propriétaire actif n'existe.
 *
 * - Les valeurs ne viennent que de l'environnement du serveur, jamais de la requête ni du code (dépôt public).
 * - Elles ne servent qu'une fois : dès qu'un propriétaire existe, elles sont ignorées. Le nom et le mot de
 *   passe se changent ensuite dans la console (Paramètres), et ces deux variables peuvent être retirées.
 * - Mêmes règles que `bootstrap` : mot de passe d'au moins 12 caractères, haché, aucun compte de commerce promu.
 * - L'adresse du compte est facultative (`QADR_OWNER_EMAIL`) ; à défaut, une adresse du domaine réservé
 *   `.invalid` (RFC 2606), qui ne peut recevoir aucun message : ce compte ne se récupère pas par e-mail.
 */
export type OwnerSeed = { username: string; password: string; email: string; name: string };
const optionalText = (value: string | undefined) => value?.trim() || undefined;

export function readOwnerSeed(source: Readonly<Record<string, string | undefined>> = process.env): OwnerSeed | null | "invalid" {
  const username = optionalText(source.QADR_OWNER_USERNAME);
  const password = source.QADR_OWNER_PASSWORD || undefined;
  if (!username && !password) return null;
  const parsed = bootstrapSchema.safeParse({
    username: username ?? "", password: password ?? "",
    email: optionalText(source.QADR_OWNER_EMAIL) ?? `${(username ?? "proprietaire").toLowerCase()}@console.qadr-ops.invalid`,
    name: optionalText(source.QADR_OWNER_NAME) ?? "Propriétaire Qadr Ops",
  });
  return parsed.success ? parsed.data : "invalid";
}

export type OwnerSeedOutcome = "exists" | "absent" | "invalid" | "created" | "refused";
/** Crée le propriétaire de départ s'il n'y en a aucun. N'échoue jamais : la connexion répond ensuite 401 ou 200. */
export async function ensureSeededPlatformOwner(auth: QadrAuth, db: CommercialDatabase, source: Readonly<Record<string, string | undefined>> = process.env): Promise<OwnerSeedOutcome> {
  const seed = readOwnerSeed(source);
  if (seed === null) return "absent";
  const [active] = await db.select({ total: count() }).from(platformAdmin).where(isNull(platformAdmin.revokedAt));
  if (Number(active?.total ?? 0) > 0) return "exists";
  if (seed === "invalid") {
    console.error("[plateforme] Compte de départ non créé : QADR_OWNER_USERNAME (3 à 30 caractères a-z, 0-9, point, tiret bas) ou QADR_OWNER_PASSWORD (12 caractères au moins) est invalide.");
    return "invalid";
  }
  try {
    await bootstrapPlatformOwner(auth, db, seed, "Compte de départ (QADR_OWNER_USERNAME, première connexion)");
    return "created";
  } catch (error) {
    // Nom ou adresse déjà pris, ou création simultanée : rien n'est modifié, le message ne contient aucun secret.
    console.error(`[plateforme] Compte de départ non créé : ${error instanceof CommercialError ? error.message : "erreur inattendue"}`);
    return "refused";
  }
}

/** Le mot de passe saisi est-il encore celui de départ ? Comparaison à durée constante, après connexion réussie seulement. */
export function isSeedPassword(password: string, source: Readonly<Record<string, string | undefined>> = process.env) {
  const seed = source.QADR_OWNER_PASSWORD;
  if (!seed) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(password), digest(seed));
}

const ACCOUNT_REFUSED = "Mot de passe actuel incorrect.";
const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema }).strict();
const changeUsernameSchema = z.object({ currentPassword: z.string().min(1).max(128), username: usernameSchema }).strict();
type OwnerSelf = { userId: string; sessionId: string; secret: string; now?: Date };

/**
 * Contrôle commun aux deux changements : quota réservé avant toute vérification (une session volée ne permet
 * pas de deviner le mot de passe actuel par essais), droit actif, puis mot de passe actuel.
 */
async function confirmOwnerPassword(auth: QadrAuth, db: CommercialDatabase, self: OwnerSelf, currentPassword: string) {
  const limits = await consumeRateLimits(db, [{ rule: rateRules.platformAccountChange, subject: self.userId }], self.secret, self.now ?? new Date());
  if (!limits.allowed) throw new CommercialError("Trop de tentatives. Patientez quelques minutes avant de réessayer.", 429, "too_many_attempts");
  const [credential] = await db.select({ id: account.id, hash: account.password }).from(account).innerJoin(platformAdmin, eq(platformAdmin.userId, account.userId))
    .where(sql`${account.userId} = ${self.userId} and ${account.providerId} = 'credential' and ${platformAdmin.revokedAt} is null`).limit(1);
  const context = await auth.$context;
  if (!credential?.hash || !(await context.password.verify({ hash: credential.hash, password: currentPassword }))) {
    await writePlatformAudit(db as never, {
      actorUserId: self.userId, eventType: "platform.owner_account_change_refused", entityType: "user", entityId: self.userId, result: "failure",
    });
    throw new CommercialError(ACCOUNT_REFUSED, 400, "invalid_current_password");
  }
  return { credentialId: credential.id, context, release: () => refundRateLimit(db, limits.decisions) };
}

/** Changement du mot de passe par le propriétaire connecté. Les autres sessions du compte sont fermées. */
export async function changeOwnerPassword(auth: QadrAuth, db: CommercialDatabase, self: OwnerSelf, raw: unknown) {
  const input = changePasswordSchema.parse(raw);
  if (input.newPassword === input.currentPassword) throw new CommercialError("Le nouveau mot de passe doit être différent de l’actuel.", 400, "same_password");
  const confirmed = await confirmOwnerPassword(auth, db, self, input.currentPassword);
  const hash = await confirmed.context.password.hash(input.newPassword);
  const sessionsClosed = await db.transaction(async (tx) => {
    await tx.update(account).set({ password: hash, updatedAt: new Date() }).where(eq(account.id, confirmed.credentialId));
    const closed = await tx.delete(sessionTable).where(sql`${sessionTable.userId} = ${self.userId} and ${sessionTable.id} <> ${self.sessionId}`).returning({ id: sessionTable.id });
    await writePlatformAudit(tx as never, {
      actorUserId: self.userId, eventType: "platform.owner_password_changed", entityType: "user", entityId: self.userId,
      metadata: { sessionsClosed: closed.length },
    });
    return closed.length;
  });
  await confirmed.release();
  return { sessionsClosed };
}

/** Changement du nom d'utilisateur par le propriétaire connecté (le nom sert seulement à la connexion). */
export async function changeOwnerUsername(auth: QadrAuth, db: CommercialDatabase, self: OwnerSelf, raw: unknown) {
  const input = changeUsernameSchema.parse(raw);
  const confirmed = await confirmOwnerPassword(auth, db, self, input.currentPassword);
  const [taken] = await db.select({ id: user.id }).from(user).where(sql`${user.username} = ${input.username} and ${user.id} <> ${self.userId}`).limit(1);
  if (taken) throw new CommercialError("Ce nom d’utilisateur est déjà pris.", 409, "username_taken");
  await db.transaction(async (tx) => {
    await tx.update(user).set({ username: input.username, displayUsername: input.username, updatedAt: new Date() }).where(eq(user.id, self.userId));
    // Le nom n'est pas écrit dans le journal : seulement le fait du changement.
    await writePlatformAudit(tx as never, { actorUserId: self.userId, eventType: "platform.owner_username_changed", entityType: "user", entityId: self.userId });
  });
  await confirmed.release();
  return { username: input.username };
}

type OwnerRow = { id: string; twoFactorEnabled: boolean };
async function activeOwnerByUsername(db: CommercialDatabase, rawUsername: unknown): Promise<OwnerRow> {
  const username = usernameSchema.parse(rawUsername);
  const [owner] = await db.select({ id: user.id, twoFactorEnabled: user.twoFactorEnabled }).from(user).innerJoin(platformAdmin, eq(platformAdmin.userId, user.id))
    .where(sql`${user.username} = ${username} and ${platformAdmin.revokedAt} is null`).limit(1);
  if (!owner) throw new CommercialError("Aucun propriétaire actif avec ce nom d’utilisateur.", 404);
  return owner;
}

function cookieHeaders(from: Headers) {
  const cookie = from.getSetCookie().map((value) => value.split(";")[0]).filter((pair) => !pair.endsWith("=")).join("; ");
  return new Headers({ cookie });
}

/**
 * Activation du second facteur du propriétaire (mission 14), par `scripts/platform-owner.ts enroll-2fa`.
 *
 * 1. `begin` vérifie le mot de passe (connexion serveur, aucune route HTTP), crée un secret TOTP et dix codes de
 *    secours, chiffrés par Better Auth. Le facteur n'est PAS encore actif.
 * 2. `confirm(code)` exige un premier code valide de l'application d'authentification : seulement alors le
 *    facteur devient obligatoire. Toutes les sessions du compte sont ensuite fermées.
 * Le secret et les codes ne sont remis qu'à l'appelant (le terminal de l'opérateur), jamais écrits ni journalisés.
 */
export async function beginOwnerTwoFactorEnrollment(auth: QadrAuth, db: CommercialDatabase, raw: { username: unknown; password: unknown }) {
  const owner = await activeOwnerByUsername(db, raw.username);
  if (owner.twoFactorEnabled) throw new CommercialError("Le second facteur est déjà actif : utilisez reset-2fa pour le remplacer.", 409);
  const password = z.string().min(1).max(128).parse(raw.password);
  const username = usernameSchema.parse(raw.username);
  type Signed = { headers: Headers; response: { token?: string; twoFactorRedirect?: boolean } };
  let signed: Signed;
  try {
    signed = await auth.api.signInUsername({ body: { username, password, rememberMe: false }, headers: new Headers(), returnHeaders: true }) as Signed;
  } catch {
    throw new CommercialError("Nom d’utilisateur ou mot de passe incorrect.", 401);
  }
  const session = cookieHeaders(signed.headers);
  const enabled = await auth.api.enableTwoFactor({ body: { password, method: "totp" }, headers: session }) as { totpURI?: string; backupCodes?: string[] };
  if (!enabled.totpURI || !enabled.backupCodes?.length) throw new CommercialError("Activation du second facteur impossible.", 500);
  const closeSessions = () => db.delete(sessionTable).where(eq(sessionTable.userId, owner.id));
  return {
    totpURI: enabled.totpURI,
    backupCodes: enabled.backupCodes,
    async confirm(code: string) {
      try {
        await auth.api.verifyTOTP({ body: { code: z.string().trim().regex(/^\d{6}$/).parse(code) }, headers: session });
      } catch {
        throw new CommercialError("Code refusé : le second facteur n’est pas activé. Relancez enroll-2fa.", 400);
      }
      await closeSessions();
      await writePlatformAudit(db as never, {
        actorUserId: null, eventType: "platform.owner_2fa_enrolled", entityType: "user", entityId: owner.id,
        reason: "Activation du second facteur (scripts/platform-owner.ts)", metadata: { backupCodes: enabled.backupCodes!.length },
      });
      return { userId: owner.id };
    },
    async cancel() {
      await db.delete(twoFactor).where(eq(twoFactor.userId, owner.id));
      await closeSessions();
    },
  };
}

/**
 * Récupération (téléphone perdu, codes de secours épuisés) par un opérateur ayant accès à la base :
 * le second facteur est retiré et toutes les sessions fermées. La console s'ouvre alors avec le seul mot de
 * passe (second facteur facultatif depuis le 2026-11-12) ; relancer enroll-2fa pour le rétablir.
 */
export async function resetOwnerTwoFactor(db: CommercialDatabase, raw: { username: unknown }) {
  const owner = await activeOwnerByUsername(db, raw.username);
  const result = await db.transaction(async (tx) => {
    await tx.delete(twoFactor).where(eq(twoFactor.userId, owner.id));
    await tx.update(user).set({ twoFactorEnabled: false, updatedAt: new Date() }).where(eq(user.id, owner.id));
    const closed = await tx.delete(sessionTable).where(eq(sessionTable.userId, owner.id)).returning({ id: sessionTable.id });
    await writePlatformAudit(tx as never, {
      actorUserId: null, eventType: "platform.owner_2fa_reset", entityType: "user", entityId: owner.id,
      reason: "Retrait du second facteur pour récupération (scripts/platform-owner.ts)", metadata: { sessionsClosed: closed.length },
    });
    return { sessionsClosed: closed.length };
  });
  return { userId: owner.id, ...result };
}

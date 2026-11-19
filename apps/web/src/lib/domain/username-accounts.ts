import { randomInt, randomUUID } from "node:crypto";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { account, accountRecoveryCode, auditEvent, session, twoFactor, user } from "../db/schema";
import { CODE_ALPHABET } from "../security/access-codes";
import { CommercialError, type CommercialDatabase } from "./commercial";
import { isPlatformOwnerUsername, usernameSchema, usernameTakenOnRace } from "./team-codes";

/*
 * Comptes sans adresse e-mail (mission CTO du 2026-11-17, § 7).
 *
 * Un commerçant peut créer son compte avec un nom, un nom d'utilisateur et un mot de passe, sans e-mail :
 * `user.email` reste NULL (jamais d'adresse inventée). Le compte est créé comme ceux des employés invités par code
 * (team-codes.ts) : ligne `user` + compte `credential` dont le mot de passe est haché par Better Auth
 * (`better-auth/crypto`, scrypt), puis la session est ouverte par `auth.api.signInUsername` côté serveur
 * (employee-auth.ts). La route qui appelle ce service applique les mêmes barrières qu'une inscription par e-mail
 * (Turnstile, compteur `auth.sign_up.ip`, liste d'inscription en production, code d'accès commercial).
 *
 * Mot de passe oublié sans e-mail : un **code de secours** (`SEC-XXXX-XXXX-XXXX-XXXX`, 16 symboles, environ 79 bits)
 * est montré une seule fois à l'inscription. Il est stocké haché comme un mot de passe (scrypt, jamais en clair,
 * indépendant de tout secret du serveur). Nom d'utilisateur + code de secours permettent de choisir un nouveau mot
 * de passe : toutes les sessions sont fermées et un nouveau code remplace l'ancien (usage unique). Jamais de
 * récupération par la seule connaissance d'un numéro de téléphone ; un employé n'a aucun moyen d'atteindre le
 * compte de son responsable (le code n'est remis qu'au titulaire, à l'écran). Resend n'intervient nulle part.
 */

const RECOVERY_PREFIX = "SEC";
const RECOVERY_GROUPS = 4;

/** Code de secours aléatoire (CSPRNG), au format lisible `SEC-XXXX-XXXX-XXXX-XXXX` (sans 0/O ni 1/I/L). */
export function generateRecoveryCode() {
  const groups = Array.from({ length: RECOVERY_GROUPS }, () => Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join(""));
  return `${RECOVERY_PREFIX}-${groups.join("-")}`;
}

/** Forme canonique d'un code saisi (majuscules, sans espaces ni tirets), ou `null` s'il ne peut pas en être un. */
export function normalizeRecoveryCode(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 64) return null;
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!compact.startsWith(RECOVERY_PREFIX)) return null;
  const body = compact.slice(RECOVERY_PREFIX.length);
  if (body.length !== RECOVERY_GROUPS * 4 || [...body].some((char) => !CODE_ALPHABET.includes(char))) return null;
  return `${RECOVERY_PREFIX}${body}`;
}

const passwordSchema = z.string().min(8, "Le mot de passe compte au moins 8 caractères.").max(128, "Le mot de passe compte au plus 128 caractères.");

export const usernameSignUpSchema = z.object({
  name: z.string().trim().min(2, "Indiquez votre nom.").max(100),
  username: usernameSchema,
  password: passwordSchema,
});

async function storeRecoveryCode(tx: CommercialDatabase, userId: string, now: Date) {
  const code = generateRecoveryCode();
  const codeHash = await hashPassword(normalizeRecoveryCode(code)!);
  await tx.insert(accountRecoveryCode).values({ userId, codeHash, createdAt: now })
    .onConflictDoUpdate({ target: accountRecoveryCode.userId, set: { codeHash, createdAt: now, lastUsedAt: null } });
  return code;
}

/**
 * Crée un compte sans e-mail et son code de secours, dans une seule transaction. Rend le code de secours en clair,
 * pour un affichage unique. Nom d'utilisateur déjà pris : 409 `username_taken` (comme pour un employé).
 */
export async function createUsernameAccount(db: CommercialDatabase, raw: unknown, now = new Date()) {
  const input = usernameSignUpSchema.parse(raw);
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    const [taken] = await tx.select({ id: user.id }).from(user).where(eq(user.username, input.username)).limit(1);
    if (taken) throw new CommercialError("Ce nom d’utilisateur est déjà pris. Choisissez-en un autre.", 409, "username_taken");
    const userId = randomUUID();
    await tx.insert(user).values({ id: userId, name: input.name, email: null, emailVerified: false, username: input.username, displayUsername: input.username, createdAt: now, updatedAt: now });
    await tx.insert(account).values({ id: randomUUID(), accountId: userId, providerId: "credential", userId, password: passwordHash, createdAt: now, updatedAt: now });
    const recoveryCode = await storeRecoveryCode(tx as CommercialDatabase, userId, now);
    await tx.insert(auditEvent).values({ id: randomUUID(), businessId: null, actorUserId: userId, eventType: "account.created_without_email", entityType: "user", entityId: userId, metadata: {}, occurredAt: now });
    return { userId, username: input.username, recoveryCode };
  }).catch(usernameTakenOnRace);
}

export const recoverySchema = z.object({ username: usernameSchema, recoveryCode: z.string().max(64), newPassword: passwordSchema });

// Empreinte jetable : un nom inconnu coûte le même calcul scrypt qu'un nom connu (pas d'indice par la durée).
let decoyHash: Promise<string> | null = null;
const decoy = () => (decoyHash ??= hashPassword(`${RECOVERY_PREFIX}DECOY${randomUUID()}`));

export type RecoveryResult = { ok: true; userId: string; recoveryCode: string } | { ok: false };

/**
 * Nouveau mot de passe avec le code de secours. Un nom inconnu, un code faux, un compte sans code, le propriétaire
 * de la plateforme ou un compte à second facteur reçoivent tous la même réponse `{ ok: false }`. En cas de succès :
 * mot de passe remplacé, toutes les sessions fermées, nouveau code de secours (l'ancien ne sert plus), audit.
 */
export async function recoverWithCode(db: CommercialDatabase, raw: unknown, now = new Date()): Promise<RecoveryResult> {
  const parsed = recoverySchema.safeParse(raw);
  const normalized = normalizeRecoveryCode(parsed.success ? parsed.data.recoveryCode : null);
  if (!parsed.success || !normalized) { await verifyPassword({ hash: await decoy(), password: "-" }); return { ok: false }; }
  const { username, newPassword } = parsed.data;
  const [row] = await db.select({ userId: user.id, codeHash: accountRecoveryCode.codeHash, twoFactorEnabled: user.twoFactorEnabled })
    .from(user).innerJoin(accountRecoveryCode, eq(accountRecoveryCode.userId, user.id)).where(eq(user.username, username)).limit(1);
  const matches = await verifyPassword({ hash: row?.codeHash ?? await decoy(), password: normalized });
  if (!row || !matches || row.twoFactorEnabled || await isPlatformOwnerUsername(db, username)) return { ok: false };
  const [secondFactor] = await db.select({ id: twoFactor.id }).from(twoFactor).where(eq(twoFactor.userId, row.userId)).limit(1);
  if (secondFactor) return { ok: false };
  const passwordHash = await hashPassword(newPassword);
  return db.transaction(async (tx) => {
    // Le code n'a pas changé entre la vérification et l'écriture (deux demandes simultanées : une seule réussit).
    const claimed = await tx.update(accountRecoveryCode).set({ lastUsedAt: now })
      .where(and(eq(accountRecoveryCode.userId, row.userId), eq(accountRecoveryCode.codeHash, row.codeHash))).returning({ userId: accountRecoveryCode.userId });
    if (!claimed.length) return { ok: false } as const;
    const updated = await tx.update(account).set({ password: passwordHash, updatedAt: now })
      .where(and(eq(account.userId, row.userId), eq(account.providerId, "credential"))).returning({ id: account.id });
    if (!updated.length) throw new CommercialError("Compte sans mot de passe.", 409, "no_password");
    await tx.delete(session).where(eq(session.userId, row.userId));
    const recoveryCode = await storeRecoveryCode(tx as CommercialDatabase, row.userId, now);
    await tx.insert(auditEvent).values({ id: randomUUID(), businessId: null, actorUserId: row.userId, eventType: "account.password_recovered_with_code", entityType: "user", entityId: row.userId, metadata: {}, occurredAt: now });
    return { ok: true, userId: row.userId, recoveryCode } as const;
  });
}

/**
 * Nouveau code de secours demandé par le titulaire connecté (code perdu ou montré à quelqu'un). Le mot de passe
 * actuel est exigé ; l'ancien code cesse aussitôt de fonctionner.
 */
export async function renewRecoveryCode(db: CommercialDatabase, userId: string, currentPassword: unknown, now = new Date()) {
  const [credential] = await db.select({ password: account.password }).from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "credential"))).limit(1);
  const valid = typeof currentPassword === "string" && currentPassword.length <= 128
    && await verifyPassword({ hash: credential?.password ?? await decoy(), password: currentPassword });
  if (!credential?.password || !valid) throw new CommercialError("Mot de passe actuel incorrect.", 403, "invalid_password");
  return db.transaction(async (tx) => {
    const recoveryCode = await storeRecoveryCode(tx as CommercialDatabase, userId, now);
    await tx.insert(auditEvent).values({ id: randomUUID(), businessId: null, actorUserId: userId, eventType: "account.recovery_code_renewed", entityType: "user", entityId: userId, metadata: {}, occurredAt: now });
    return { recoveryCode };
  });
}

/** Le compte a-t-il un code de secours (affichage des réglages du compte) ? */
export async function hasRecoveryCode(db: Pick<CommercialDatabase, "select">, userId: string) {
  const [row] = await db.select({ present: sql<number>`1` }).from(accountRecoveryCode).where(eq(accountRecoveryCode.userId, userId)).limit(1);
  return Boolean(row);
}

import { betterAuth } from "better-auth";
import { and, eq, gt, isNull } from "drizzle-orm";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { organization, twoFactor, username } from "better-auth/plugins";
import { after } from "next/server";
import { z } from "zod";
import { getDatabase } from "@/lib/db/client";
import { authSchema, businessProfile, invitation, platformAdmin, receiptSettings, user } from "@/lib/db/schema";
import { accessActivationScope, readAccessPass } from "@/lib/commercial/access-pass";
import { accessCodeRequired } from "@/lib/commercial/mode";
import { activateCommercialCode, usableCommercialCodeById } from "@/lib/domain/commercial-codes";
import { assertProductionAuthUrl, readEnvironment, socialProviders as configuredSocialProviders } from "@/lib/env";
import type { CommercialDatabase } from "@/lib/domain/commercial";
import { claimPublicCampaignSafely, signupCampaignScope } from "@/lib/domain/public-campaigns";
import { consumeRateLimits, rateRules, type RateRule } from "@/lib/security/rate-limit";
import { defaultLocale, localeCookie, resolveLocale, type Locale } from "@/lib/i18n/config";
import { clientIpFrom, clientIpHeaders } from "./client-ip-headers";
import { registrationAllows, registrationPolicy, type RegistrationPolicy } from "./registration";
import { deliverEmail, emailRequestScope, resolveEmailTransport, type EmailLogger, type EmailMessage, type EmailTransport } from "./email";
import { renderInvitationEmail, renderPasswordResetEmail, renderVerificationEmail } from "./email-templates";
import { businessAccess, businessRoles } from "./permissions";
import { turnstileHeader, verifyTurnstile, type TurnstileAction } from "./turnstile";

/** Routes Better Auth publiques protégées par Turnstile, avec l'action attendue du widget. */
const turnstileProtectedPaths: Record<string, TurnstileAction> = {
  "/sign-up/email": "register",
  "/sign-in/email": "login",
  "/request-password-reset": "password-reset",
};
export const businessActivities = ["hardware", "phones", "general", "clothing"] as const;
/** Format du point de vente, choisi à l'inscription (boutique, kiosque, dépôt de gros, autre). */
export const storeFormats = ["shop", "kiosk", "wholesale", "other"] as const;
export type BusinessActivity = (typeof businessActivities)[number];

/** Durées de vie retenues ; justifiées dans docs/authentication.md. */
export const authDurations = {
  sessionSeconds: 60 * 60 * 24 * 7,
  sessionRefreshSeconds: 60 * 60 * 24,
  invitationSeconds: 60 * 60 * 24 * 7,
  passwordResetSeconds: 60 * 60,
  emailVerificationSeconds: 60 * 60 * 24,
};

/** Langue de l'interface de la personne qui fait la demande (cookie), français par défaut. */
function requestLocale(request?: Request): Locale {
  const match = request?.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${localeCookie}=([^;]+)`));
  return resolveLocale(match?.[1]);
}

/**
 * Limites partagées (PostgreSQL) des routes HTTP sensibles de Better Auth (mission 14). Elles s'ajoutent à la
 * limitation en mémoire de Better Auth, qui ne vaut que pour une instance. Adresse IP inconnue : sujet commun
 * « inconnu » (plus strict, jamais une exemption). `sessionUserId` : compte de la session (jamais du corps),
 * seul sujet légitime d'une route qui modifie le compte connecté (`/change-password`).
 */
export function authRateChecks(path: string, body: unknown, ip: string | null | undefined, sessionUserId?: string | null): Array<{ rule: RateRule; subject: string }> {
  const address = ip?.trim() && ip.trim() !== "unknown" ? ip.trim() : "inconnu";
  const email = typeof (body as { email?: unknown } | undefined)?.email === "string" ? (body as { email: string }).email.trim().toLowerCase() : "";
  switch (path) {
    case "/sign-in/email": return [{ rule: rateRules.signInIp, subject: address }, ...(email ? [{ rule: rateRules.signInAccount, subject: email }] : [])];
    case "/sign-up/email": return [{ rule: rateRules.signUpIp, subject: address }];
    case "/request-password-reset": return [{ rule: rateRules.passwordResetRequestIp, subject: address }, ...(email ? [{ rule: rateRules.passwordResetRequestAccount, subject: email }] : [])];
    case "/reset-password": return [{ rule: rateRules.passwordResetIp, subject: address }];
    case "/send-verification-email": return [{ rule: rateRules.verificationEmailIp, subject: address }];
    case "/sign-in/social": return [{ rule: rateRules.socialSignInIp, subject: address }];
    case "/change-password": return [{ rule: rateRules.passwordChangeIp, subject: address }, ...(sessionUserId ? [{ rule: rateRules.passwordChangeAccount, subject: sessionUserId }] : [])];
    default: return [];
  }
}

/** Refus d'inscription renvoyés tels quels par Better Auth et réécrits en un refus unique (mission 16). */
const signUpRefusalCodes = new Set(["USER_ALREADY_EXISTS", "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL", "FAILED_TO_CREATE_USER"]);
/** Corps unique d'une inscription refusée : ni « adresse déjà utilisée », ni détail d'écriture. */
export const signUpRefusal = { code: "SIGN_UP_FAILED", message: "SIGN_UP_FAILED" } as const;

function apiErrorCode(value: unknown) {
  const body = (value as { body?: { code?: unknown } } | null | undefined)?.body;
  return typeof body?.code === "string" ? body.code : undefined;
}

/** Longueur maximale d'un mot de passe : la même valeur sert à la configuration et au refus du propriétaire. */
const maxPasswordLength = 128;

/** Droit actif de propriétaire de la plateforme (ligne `platform_admin` non révoquée). */
async function isActivePlatformOwner(db: CommercialDatabase, userId: string) {
  const [owner] = await db.select({ userId: platformAdmin.userId }).from(platformAdmin)
    .where(and(eq(platformAdmin.userId, userId), isNull(platformAdmin.revokedAt))).limit(1);
  return !!owner;
}

/** Règles qui protègent un compte précis : comptées seulement après le défi Turnstile. */
const accountRateRules = new Set<RateRule>([rateRules.signInAccount, rateRules.passwordResetRequestAccount, rateRules.passwordChangeAccount]);

/**
 * V-5 : routes Better Auth qui modifient les identifiants du compte connecté. Le propriétaire de la plateforme
 * change les siens uniquement dans la console (`/api/platform/account/*` : mot de passe actuel, audit, règle
 * `platformAccountChange`) ou par `scripts/platform-owner.ts` ; pour lui, ces routes répondent comme une route
 * fermée (404), quelle que soit sa session (console ou connexion ordinaire). État en 1.7.7 pour les autres
 * comptes : `/change-email` est désactivée par la configuration (400 CHANGE_EMAIL_DISABLED), `/delete-user`
 * aussi (404) ; `/link-social` et `/unlink-account` ajouteraient ou retireraient une façon de se connecter.
 * Elles restent listées pour le jour où l'une serait activée. `/set-password` est réservée au serveur (aucune
 * route HTTP) ; `/update-user` ne change que le nom et l'image (nom d'utilisateur refusé plus bas, adresse
 * refusée par Better Auth).
 */
const ownerClosedCredentialPaths = new Set(["/change-password", "/change-email", "/delete-user", "/link-social", "/unlink-account"]);

/**
 * Accepter (ou refuser) une invitation exige une adresse vérifiée dès que les e-mails fonctionnent, et
 * toujours en production : un lien transféré ne suffit pas à un tiers qui créerait un compte avec
 * l'adresse invitée. En développement sans Resend, la vérification serait impossible : elle est levée.
 * L'inscription elle-même n'exige pas d'adresse vérifiée.
 */
export function invitationRequiresVerifiedEmail(isProduction: boolean, hasEmailTransport: boolean) {
  return isProduction || hasEmailTransport;
}

/** Même règle, évaluée pour l'instance de l'application (affichage de l'écran d'invitation). */
export function currentInvitationPolicy() {
  const env = readEnvironment();
  const preview = process.env.QADR_PREVIEW_MODE === "true" && env.NODE_ENV === "development";
  return { requiresVerifiedEmail: invitationRequiresVerifiedEmail(!preview && env.NODE_ENV === "production", resolveEmailTransport() !== null) };
}

/**
 * Travail après réponse : `after()` de Next.js prolonge l'invocation (waitUntil sur Vercel) jusqu'à la
 * fin de l'envoi. Hors requête (script), la promesse continue simplement, sans garantie de durée.
 */
export function runAfterResponse(task: Promise<unknown>) {
  try { after(task); } catch { void task; }
}

type AuthOptions = {
  db: unknown; secret: string; baseURL: string; isProduction: boolean;
  emailTransport?: EmailTransport | null;
  /** Options d'envoi (journal, attente entre essais), remplaçables dans les tests. */
  emailDelivery?: { logger?: EmailLogger; sleep?: (ms: number) => Promise<void> };
  /** Exécution des envois après la réponse ; sans elle, Better Auth attend l'envoi. */
  backgroundTask?: (task: Promise<unknown>) => void;
  turnstile?: { secret?: string; siteKey?: string; fetcher?: typeof fetch };
  /** Connexions sociales configurées (`socialProviders()` de lib/env), aucune par défaut. */
  social?: ReturnType<typeof configuredSocialProviders>;
  /** Liste d'inscription (`registration.ts`), consultée seulement quand aucun code commercial n'est exigé ; ouverte par défaut. */
  registration?: RegistrationPolicy;
  /** Code d'accès commercial exigé à l'inscription ; lu dans l'environnement à chaque requête par défaut (`commercial/mode.ts`). */
  accessCodeRequired?: () => boolean;
};

/**
 * Configuration unique de Better Auth (Neon en production, PGlite pour la prévisualisation et les tests).
 * La création d'une organisation crée aussi, dans le même passage, le profil commerce et les
 * réglages de reçu dont dépendent toutes les tables métier.
 */
export function createQadrAuth(options: AuthOptions) {
  const transport = options.emailTransport ?? null;
  const db = options.db as CommercialDatabase;
  const deliver = (message: EmailMessage) => deliverEmail(transport!, message, options.emailDelivery);
  const expectedHostname = new URL(options.baseURL).hostname;
  const registration = options.registration ?? { mode: "open" };
  return betterAuth({
    appName: "QADR OPS",
    baseURL: options.baseURL,
    secret: options.secret,
    // Apple renvoie la réponse par un POST depuis appleid.apple.com : origine à approuver quand Apple est actif.
    trustedOrigins: options.social?.apple ? [options.baseURL, "https://appleid.apple.com"] : [options.baseURL],
    database: drizzleAdapter(options.db as Parameters<typeof drizzleAdapter>[0], { provider: "pg", schema: authSchema }),
    session: { expiresIn: authDurations.sessionSeconds, updateAge: authDurations.sessionRefreshSeconds },
    // Mission 13 : Google et Apple, seulement si leurs identifiants existent (jamais de bouton factice).
    socialProviders: {
      ...(options.social?.google ? { google: { ...options.social.google, prompt: "select_account" as const } } : {}),
      ...(options.social?.apple ? { apple: { clientId: options.social.apple.clientId, clientSecret: options.social.apple.clientSecret,
        ...(options.social.apple.appBundleIdentifier ? { appBundleIdentifier: options.social.apple.appBundleIdentifier } : {}) } } : {}),
    },
    // Association d'un compte social à un compte existant : seulement si le fournisseur a vérifié l'adresse ET
    // si l'adresse locale est déjà vérifiée (sinon, quelqu'un qui aurait pré-inscrit l'adresse d'autrui
    // récupérerait sa connexion Google). Aucun fournisseur n'est « de confiance » sans vérification.
    account: { accountLinking: { enabled: true, trustedProviders: [], requireLocalEmailVerified: true, allowDifferentEmails: false } },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      minPasswordLength: 8,
      maxPasswordLength,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: authDurations.passwordResetSeconds,
      // Sans fournisseur d'e-mail, le lien n'est ni envoyé ni journalisé : la réponse reste neutre.
      // Avec Resend, l'envoi part après la réponse (backgroundTasks) : même délai qu'un compte existe ou non.
      sendResetPassword: transport ? async ({ user: account, url, token }, request) => {
        // Mission 16 : le compte à second facteur (propriétaire de la plateforme) ne se récupère jamais par le
        // lien public ; son mot de passe se change par scripts/platform-owner.ts. Réponse HTTP inchangée (rien
        // n'est révélé), aucun e-mail : une boîte de réception compromise ne suffit pas à couper ses sessions.
        if ((account as { twoFactorEnabled?: boolean | null }).twoFactorEnabled) return;
        // 2026-11-12 : le second facteur du propriétaire est devenu facultatif. La règle vaut donc pour tout
        // propriétaire actif, avec ou sans facteur : son mot de passe se change dans la console (mot de passe
        // actuel exigé) ou par le script, jamais par un lien reçu par e-mail.
        if (await isActivePlatformOwner(db, account.id)) return;
        await deliver(renderPasswordResetEmail({ locale: requestLocale(request), to: account.email, url, token }));
      } : undefined,
    },
    // Mission 16 : le jeton de réinitialisation n'est conservé qu'en empreinte SHA-256 (une copie de la base
    // ne donne aucun lien utilisable). Les autres identifiants de vérification restent inchangés.
    verification: { storeIdentifier: { default: "plain", overrides: { "reset-password:": "hashed" } } },
    // Envoi disponible (authClient.sendVerificationEmail) mais non imposé : la vérification à l'inscription
    // changerait la politique d'accès et reste une décision du propriétaire (docs/authentication.md).
    emailVerification: transport ? {
      sendOnSignUp: false,
      autoSignInAfterVerification: false,
      expiresIn: authDurations.emailVerificationSeconds,
      sendVerificationEmail: async ({ user, url, token }, request) => {
        await deliver(renderVerificationEmail({ locale: requestLocale(request), to: user.email, url, token }));
      },
    } : undefined,
    plugins: [username({
      // Mission 13 : nom d'utilisateur réservé au propriétaire de la plateforme, attribué par
      // scripts/platform-owner.ts. Les routes HTTP qui permettraient de le choisir, de le modifier, de tester
      // son existence ou de se connecter sans passer par /api/platform/auth/sign-in sont fermées plus bas.
      minUsernameLength: 3, maxUsernameLength: 30, immutableUsername: true,
    }), twoFactor({
      // Mission 14 : second facteur du propriétaire de la plateforme (TOTP + codes de secours chiffrés).
      // Ses routes HTTP sont fermées plus bas : l'inscription passe par scripts/platform-owner.ts et la
      // vérification par /api/platform/auth/verify, qui seule ouvre la session plateforme. Jamais
      // d'« appareil de confiance » : chaque connexion à la console redemande le code.
      issuer: "Qadr Ops (plateforme)",
      totpOptions: { digits: 6, period: 30 },
      backupCodeOptions: { amount: 10, length: 12, storeBackupCodes: "encrypted" },
      twoFactorCookieMaxAge: 300,
      trustDeviceMaxAge: 1,
    }), organization({
      ac: businessAccess,
      roles: businessRoles,
      creatorRole: "owner",
      allowUserToCreateOrganization: true,
      organizationLimit: 20,
      disableOrganizationDeletion: true,
      teams: { enabled: false },
      invitationExpiresIn: authDurations.invitationSeconds,
      cancelPendingInvitationsOnReInvite: true,
      requireEmailVerificationOnInvitation: invitationRequiresVerifiedEmail(options.isProduction, transport !== null),
      // Sans fournisseur, l'invitation est créée et son lien est remis à la personne qui invite. Avec
      // Resend, la promesse d'envoi est confiée au service (emailRequestScope) pour qu'il en rende compte.
      sendInvitationEmail: async ({ id, email, role, organization: org, inviter, invitation: created }) => {
        if (!transport) return;
        const scope = emailRequestScope.getStore();
        const delivery = deliver(renderInvitationEmail({
          locale: scope?.locale ?? defaultLocale, to: email, invitationId: id, businessName: org.name,
          inviterName: inviter.user.name, role, expiresAt: new Date(created.expiresAt), baseURL: options.baseURL,
        }));
        if (scope) scope.invitationDelivery = delivery;
        await delivery;
      },
      organizationHooks: {
        beforeCreateOrganization: async ({ organization: draft }) => {
          const activity = (draft.metadata as { activity?: string } | undefined)?.activity;
          if (!businessActivities.includes(activity as BusinessActivity)) {
            throw new APIError("BAD_REQUEST", { message: "BUSINESS_ACTIVITY_REQUIRED" });
          }
        },
        afterCreateOrganization: async ({ organization: created, user }) => {
          const metadata = (typeof created.metadata === "string" ? JSON.parse(created.metadata) : created.metadata ?? {}) as {
            activity?: BusinessActivity; phone?: string; address?: string; storeFormat?: string; creationKey?: string; displayName?: string;
          };
          const storeFormat = (storeFormats as readonly string[]).includes(metadata.storeFormat ?? "") ? metadata.storeFormat! : null;
          // Campagne publique choisie à l'inscription (mission 12) : transmise par account.ts hors des métadonnées.
          const campaign = signupCampaignScope.getStore();
          // Profil, réglages de reçu et réclamation éventuelle de la campagne : une seule transaction.
          await db.transaction(async (tx) => {
            // Une clé déjà portée par un autre commerce n'est pas reprise : le profil est toujours créé.
            const [taken] = metadata.creationKey ? await tx.select({ id: businessProfile.businessId }).from(businessProfile).where(eq(businessProfile.creationKey, metadata.creationKey)).limit(1) : [];
            const inserted = await tx.insert(businessProfile).values({
              businessId: created.id, activity: metadata.activity ?? "general", phone: metadata.phone || null, address: metadata.address || null,
              storeFormat, creationKey: taken ? null : metadata.creationKey || null,
            }).onConflictDoNothing().returning({ businessId: businessProfile.businessId });
            await tx.insert(receiptSettings).values({ businessId: created.id, displayName: metadata.displayName || null }).onConflictDoNothing();
            // Sans profil créé ici (doublon strictement simultané), aucune réclamation : jamais deux fois.
            if (campaign && inserted.length) {
              campaign.outcome = await claimPublicCampaignSafely(tx, { businessId: created.id, userId: user.id, request: campaign.request });
            }
            // Code d'accès commercial (2026-11-16) : activé dans CETTE transaction, sous un point de sauvegarde.
            // Échec (code utilisé entre-temps, révoqué, expiré) : le code reste intact et le commerce reste fermé
            // tant qu'un code valide n'est pas saisi ; aucun abonnement partiel.
            const activation = accessActivationScope.getStore();
            if (activation && inserted.length) {
              try {
                const result = await tx.transaction((savepoint) => activateCommercialCode(savepoint as unknown as CommercialDatabase, { codeId: activation.codeId, businessId: created.id, actorUserId: user.id }));
                activation.outcome = { status: "activated", endsAt: result.endsAt, lifetime: result.lifetime, replayed: result.replayed };
              } catch (error) {
                activation.outcome = { status: "failed", code: (error as { code?: string }).code ?? "error" };
              }
            }
          });
        },
      },
    })],
    // Seconde barrière (2026-11-12) : aucune requête HTTP de Better Auth n'ouvre une session ordinaire au
    // propriétaire actif de la plateforme ni ne rattache un fournisseur social à son compte, quelle que soit la
    // route (connexion par e-mail, retour Google ou Apple, ou toute route ajoutée plus tard). Seuls les appels
    // serveur de la console (`auth.api.*` sans `request`, dans platform-auth.ts) ouvrent ses sessions, qui
    // reçoivent aussitôt leur session plateforme. `context.request` n'existe que pour une requête reçue par le
    // gestionnaire HTTP : aucun en-tête envoyé par le client ne peut le fabriquer.
    databaseHooks: {
      // Qui peut créer un compte par requête HTTP (registration.ts). Mode code (commercial/mode.ts) : le code
      // commercial vérifié est l'autorisation (laissez-passer en cours de validité, code toujours utilisable en
      // base) ou, à défaut, une invitation par e-mail en attente pour cette adresse ; la liste n'est pas consultée.
      // Sans code exigé : la liste d'inscription. Le refus est levé en 422 FAILED_TO_CREATE_USER (un simple
      // `false` donnerait 400), puis rendu générique par le hook `after` : même statut et même corps qu'une
      // adresse déjà inscrite.
      user: { create: { before: async (created, context) => {
        if (!context?.request) return;
        const allowed = (options.accessCodeRequired ?? accessCodeRequired)()
          ? await signUpHasAccessRight(db, context.request.headers, created.email)
          : registrationAllows(registration, created.email);
        if (!allowed) throw new APIError("UNPROCESSABLE_ENTITY", { message: "FAILED_TO_CREATE_USER", code: "FAILED_TO_CREATE_USER" });
      } } },
      session: { create: { before: async (created, context) => {
        if (context?.request && await isActivePlatformOwner(db, created.userId)) return false;
      } } },
      account: { create: { before: async (created, context) => {
        if (context?.request && created.providerId !== "credential" && await isActivePlatformOwner(db, created.userId)) return false;
      } } },
    },
    advanced: {
      useSecureCookies: options.isProduction,
      // Better Auth désactive par défaut ses contrôles d'origine et de liens de retour quand NODE_ENV=test :
      // forcés ici, les tests vérifient exactement ce que fait la production (mission 16).
      disableOriginCheck: false,
      ipAddress: { ipAddressHeaders: clientIpHeaders() },
      ...(options.backgroundTask ? { backgroundTasks: { handler: options.backgroundTask } } : {}),
    },
    hooks: {
      before: createAuthMiddleware(async (context) => {
        const enforceRateLimits = async (checks: Array<{ rule: RateRule; subject: string }>) => {
          if (!checks.length) return;
          const decision = await consumeRateLimits(db, checks, options.secret);
          if (!decision.allowed) {
            throw new APIError("TOO_MANY_REQUESTS", { message: "TOO_MANY_ATTEMPTS", code: "TOO_MANY_ATTEMPTS" },
              { "retry-after": String(decision.retryAfterSeconds) });
          }
        };
        // Les routes HTTP du plugin Organization ignorent business_member_access, les quotas et l'audit :
        // un membre désactivé pouvait retirer un propriétaire. Seuls les services de l'application
        // (account.ts, appels serveur sans `request`) y accèdent, après leurs propres contrôles.
        if (context.request && context.path.startsWith("/organization/")) {
          throw new APIError("NOT_FOUND", { message: "NOT_FOUND", code: "NOT_FOUND" });
        }
        // Plugin Username : la connexion par nom d'utilisateur passe uniquement par la route du propriétaire
        // (limitation des tentatives, audit, session plateforme) ; `/is-username-available` révélerait
        // l'existence du compte. Aucun nom d'utilisateur ne se choisit ni ne se modifie par HTTP.
        if (context.request && (context.path === "/sign-in/username" || context.path === "/is-username-available")) {
          throw new APIError("NOT_FOUND", { message: "NOT_FOUND", code: "NOT_FOUND" });
        }
        // Plugin twoFactor : aucune route HTTP directe (activation, désactivation, vérification, codes) ; sinon
        // une vérification réussie ouvrirait une session sans session plateforme ni audit, et un compte de
        // commerce pourrait activer un facteur que l'interface ne sait pas lui redemander.
        if (context.request && context.path.startsWith("/two-factor/")) {
          throw new APIError("NOT_FOUND", { message: "NOT_FOUND", code: "NOT_FOUND" });
        }
        // Routes qui modifient les identifiants : le compte visé est TOUJOURS celui de la session (relue en base,
        // sans cache de cookie), jamais une valeur du corps. Sans session, Better Auth répond 401 plus loin.
        const credentialSession = context.request && ownerClosedCredentialPaths.has(context.path)
          ? await getSessionFromCtx(context, { disableCookieCache: true }) : null;
        // Limites par adresse avant Turnstile ; limites par compte seulement APRÈS un défi Turnstile réussi
        // (mission 15) : sinon dix requêtes sans défi suffiraient à bloquer le compte d'un commerçant.
        const allChecks = context.request
          // Mêmes en-têtes de confiance que la limitation de Better Auth : cf-connecting-ip serait falsifiable hors Workers.
          ? authRateChecks(context.path, context.body, clientIpFrom(context.headers ?? context.request.headers), credentialSession?.user.id) : [];
        const accountChecks = allChecks.filter((check) => accountRateRules.has(check.rule));
        await enforceRateLimits(allChecks.filter((check) => !accountRateRules.has(check.rule)));
        // V-5 : propriétaire actif de la plateforme → même réponse qu'une route fermée, rien n'est modifié.
        if (credentialSession && await isActivePlatformOwner(db, credentialSession.user.id)) {
          throw new APIError("NOT_FOUND", { message: "NOT_FOUND", code: "NOT_FOUND" });
        }
        if (context.request && (context.path === "/sign-up/email" || context.path === "/update-user")) {
          const body = context.body as Record<string, unknown> | undefined;
          if (body && ("username" in body || "displayUsername" in body)) {
            throw new APIError("BAD_REQUEST", { message: "USERNAME_NOT_ALLOWED", code: "USERNAME_NOT_ALLOWED" });
          }
        }
        // Sans session, Better Auth enverrait la vérification à n'importe quelle adresse non vérifiée :
        // seul le titulaire connecté peut demander la sienne.
        if (context.path === "/send-verification-email" && !(await getSessionFromCtx(context))) {
          throw new APIError("UNAUTHORIZED", { message: "SESSION_REQUIRED", code: "SESSION_REQUIRED" });
        }
        const action = turnstileProtectedPaths[context.path];
        if (action) {
          const headers = context.headers ?? context.request?.headers;
          const result = await verifyTurnstile(headers?.get(turnstileHeader), {
            secret: options.turnstile?.secret, siteKey: options.turnstile?.siteKey, isProduction: options.isProduction,
            expectedHostname, expectedAction: action, remoteIp: (headers ? clientIpFrom(headers) : null) ?? undefined, fetcher: options.turnstile?.fetcher,
          });
          if (!result.ok) {
            // Raison seulement : ni jeton, ni e-mail, ni adresse IP dans les journaux.
            console.warn(JSON.stringify({ event: "turnstile.rejected", action, reason: result.reason }));
            throw new APIError("BAD_REQUEST", { message: "TURNSTILE_FAILED", code: "TURNSTILE_FAILED" });
          }
        }
        await enforceRateLimits(accountChecks);
        // Le propriétaire actif de la plateforme (avec OU sans second facteur, D-05) et tout compte à second
        // facteur ne se connectent que par /platform/login (limites de la console, audit, session plateforme).
        // Par /sign-in/email, même refus qu'un mauvais mot de passe : même statut, même corps, aucun cookie
        // (ni session, ni défi), et un hachage du mot de passe reçu pour une durée comparable (Better Auth
        // vérifie l'empreinte d'un compte existant, ou hache le mot de passe d'une adresse inconnue). Les
        // préconditions de Better Auth (adresse valide, mot de passe de 128 caractères au plus) sont reprises :
        // une requête mal formée reçoit son 400 habituel, quel que soit le compte visé. Mission 15, étendue le
        // 2026-11-12. Les appels serveur (`auth.api.*`, sans `request`) ne passent pas ici.
        if (context.request && context.path === "/sign-in/email") {
          const { email, password } = (context.body ?? {}) as { email?: unknown; password?: unknown };
          if (typeof email === "string" && typeof password === "string" && password.length <= maxPasswordLength && z.email().safeParse(email).success) {
            const [account] = await db.select({ id: user.id, twoFactorEnabled: user.twoFactorEnabled }).from(user)
              .where(eq(user.email, email.toLowerCase())).limit(1);
            if (account && (account.twoFactorEnabled || await isActivePlatformOwner(db, account.id))) {
              await context.context.password.hash(password);
              throw new APIError("UNAUTHORIZED", { message: "Invalid email or password", code: "INVALID_EMAIL_OR_PASSWORD" });
            }
          }
        }
        // V-6 : un changement de mot de passe ferme TOUJOURS les autres sessions du compte, quoi qu'envoie le
        // client (`revokeOtherSessions: false` est remplacé). Better Auth 1.7.7 supprime alors toutes les sessions
        // du compte, y compris la courante, puis en ouvre une nouvelle (nouveau cookie dans la réponse, sans
        // commerce actif). Les autres champs du corps sont laissés à la validation de Better Auth (schéma qui
        // ignore toute clé inconnue, comme `userId` ou `email`).
        if (context.path === "/change-password") {
          const body = context.body as Record<string, unknown> | undefined;
          if (body && typeof body === "object" && !Array.isArray(body)) return { context: { body: { ...body, revokeOtherSessions: true } } };
        }
      }),
      after: createAuthMiddleware(async (context) => {
        // Mission 16 : une inscription refusée ne dit plus pourquoi (adresse déjà inscrite ou écriture échouée).
        // Le refus « adresse existante » de Better Auth est rapide (aucun hachage) : on hache ici le mot de passe
        // reçu pour que sa durée rejoigne celle d'une création. Limite assumée (docs/authentication.md § 11) :
        // sans vérification d'adresse obligatoire, une inscription acceptée ouvre une session, un refus non.
        if (context.path !== "/sign-up/email" || !signUpRefusalCodes.has(apiErrorCode(context.context.returned) ?? "")) return;
        const password = (context.body as { password?: unknown } | undefined)?.password;
        if (typeof password === "string" && password) await context.context.password.hash(password);
        throw new APIError("UNPROCESSABLE_ENTITY", { message: signUpRefusal.message, code: signUpRefusal.code });
      }),
    },
  });
}

export type QadrAuth = ReturnType<typeof createQadrAuth>;
let authInstance: Promise<QadrAuth> | undefined;

/**
 * Instance de l'application. En prévisualisation locale (développement uniquement), Better Auth
 * fonctionne sur la base PGlite en mémoire avec un secret de développement : les vrais parcours
 * (inscription, connexion, invitations) sont donc testables sans Neon.
 */
/** Inscription autorisée en mode code : laissez-passer valide, ou invitation par e-mail en attente pour cette adresse. */
async function signUpHasAccessRight(db: CommercialDatabase, headers: Headers, email: unknown) {
  const codeId = readAccessPass(headers);
  if (codeId && await usableCommercialCodeById(db, codeId)) return true;
  if (typeof email !== "string" || !email) return false;
  const [pending] = await db.select({ id: invitation.id }).from(invitation)
    .where(and(eq(invitation.email, email.trim().toLowerCase()), eq(invitation.status, "pending"), gt(invitation.expiresAt, new Date()))).limit(1);
  return Boolean(pending);
}

export function getAuth(): Promise<QadrAuth> {
  if (!authInstance) {
    authInstance = (async () => {
      const env = readEnvironment();
      if (process.env.QADR_PREVIEW_MODE === "true" && env.NODE_ENV === "development") {
        const { getPreviewDatabase } = await import("@/lib/preview/database");
        const baseURL = process.env.BETTER_AUTH_URL ?? `http://localhost:${process.env.PORT ?? "3001"}`;
        return createQadrAuth({ db: await getPreviewDatabase(), secret: "qadr-preview-only-secret-never-in-production-000", baseURL, isProduction: false,
          emailTransport: resolveEmailTransport(), backgroundTask: runAfterResponse, social: configuredSocialProviders(),
          turnstile: { secret: env.TURNSTILE_SECRET_KEY, siteKey: env.NEXT_PUBLIC_TURNSTILE_SITE_KEY } });
      }
      if (!env.DATABASE_URL || !env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) {
        throw new Error("Better Auth nécessite DATABASE_URL et un BETTER_AUTH_SECRET d’au moins 32 caractères.");
      }
      if (env.NODE_ENV === "production") assertProductionAuthUrl(process.env.BETTER_AUTH_URL);
      return createQadrAuth({ db: getDatabase(env.DATABASE_URL), secret: env.BETTER_AUTH_SECRET, baseURL: env.BETTER_AUTH_URL,
        isProduction: env.NODE_ENV === "production", emailTransport: resolveEmailTransport(), backgroundTask: runAfterResponse, social: configuredSocialProviders(),
        turnstile: { secret: env.TURNSTILE_SECRET_KEY, siteKey: env.NEXT_PUBLIC_TURNSTILE_SITE_KEY }, registration: registrationPolicy() });
    })();
    authInstance.catch(() => { authInstance = undefined; });
  }
  return authInstance;
}

/** Capacités réellement disponibles, affichées honnêtement dans l'interface. */
export function emailCapabilities() {
  const social = configuredSocialProviders();
  return { emailConfigured: resolveEmailTransport() !== null, socialProviders: { google: social.google !== null, apple: social.apple !== null } };
}

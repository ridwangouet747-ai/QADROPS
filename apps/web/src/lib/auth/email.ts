/**
 * Point d'entrée unique des e-mails transactionnels (invitations, réinitialisation, vérification).
 * Le fournisseur est Resend, appelé uniquement côté serveur. Sans RESEND_API_KEY et RESEND_FROM_EMAIL,
 * aucun transport n'existe : les fonctions qui en dépendent sont désactivées et l'interface le dit,
 * au lieu de prétendre qu'un e-mail est parti. Configuration : docs/authentication.md.
 */
import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { Resend } from "resend";
import { readEnvironment } from "@/lib/env";
import type { Locale } from "@/lib/i18n/config";

export type EmailKind = "invitation" | "password_reset" | "email_verification";

export type EmailMessage = {
  kind: EmailKind;
  locale: Locale;
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Lien d'action contenu dans l'e-mail : jamais journalisé (il porte souvent un jeton). */
  actionUrl: string;
  /** Stable pour une même tentative (réessais compris), nouvelle pour chaque envoi volontaire. */
  idempotencyKey: string;
};

export type SendResult =
  | { ok: true; providerId?: string }
  | { ok: false; code: string; retryable: boolean; retryAfterMs?: number };

export type EmailTransport = { send: (message: EmailMessage) => Promise<SendResult> };

export type DeliveryOutcome = { status: "sent" | "failed"; attempts: number; code?: string };

/** Journal d'envoi : type, issue, nombre d'essais et code d'erreur. Jamais de destinataire, lien, jeton ni clé. */
export type EmailLogEntry = { event: "email.delivery"; kind: EmailKind; status: DeliveryOutcome["status"]; attempts: number; code?: string };
export type EmailLogger = (entry: EmailLogEntry) => void;

const defaultLogger: EmailLogger = (entry) => {
  const line = JSON.stringify(entry);
  if (entry.status === "sent") console.info(line); else console.warn(line);
};

/** Clé d'idempotence dérivée d'un jeton sans l'exposer (empreinte SHA-256 tronquée). */
export function idempotencyKeyFrom(prefix: string, secretPart: string) {
  return `${prefix}/${createHash("sha256").update(secretPart).digest("hex").slice(0, 40)}`;
}

/**
 * Envoie un message avec au plus `maxAttempts` essais. Seules les erreurs temporaires (limitation de
 * débit, panne du fournisseur, réseau) sont réessayées, toujours avec la même clé d'idempotence pour
 * qu'un réessai ne produise jamais un second e-mail. Ne lève jamais d'exception.
 */
export async function deliverEmail(
  transport: EmailTransport,
  message: EmailMessage,
  options: { logger?: EmailLogger; maxAttempts?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<DeliveryOutcome> {
  const { logger = defaultLogger, maxAttempts = 3, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = options;
  let outcome: DeliveryOutcome = { status: "failed", attempts: 0, code: "not_attempted" };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let result: SendResult;
    try {
      result = await transport.send(message);
    } catch {
      result = { ok: false, code: "network_error", retryable: true };
    }
    if (result.ok) { outcome = { status: "sent", attempts: attempt }; break; }
    outcome = { status: "failed", attempts: attempt, code: result.code };
    if (!result.retryable || attempt === maxAttempts) break;
    await sleep(Math.min(result.retryAfterMs ?? 800 * 3 ** (attempt - 1), 5000));
  }
  logger({ event: "email.delivery", kind: message.kind, status: outcome.status, attempts: outcome.attempts, ...(outcome.code ? { code: outcome.code } : {}) });
  return outcome;
}

/** Sous-ensemble du SDK Resend utilisé ici ; permet de le remplacer par un faux dans les tests. */
type ResendSendResponse = {
  data: { id: string } | null;
  error: { name: string; statusCode: number | null; message: string } | null;
  headers?: Record<string, string> | null;
};
export type ResendClient = { emails: { send: (payload: Record<string, unknown>, options?: { idempotencyKey?: string }) => Promise<ResendSendResponse> } };

const retryableResendErrors = new Set(["rate_limit_exceeded", "internal_server_error", "application_error", "concurrent_idempotent_requests"]);

export function createResendTransport(config: { apiKey: string; from: string; replyTo?: string; client?: ResendClient; timeoutMs?: number }): EmailTransport {
  const client = config.client ?? (new Resend(config.apiKey) as unknown as ResendClient);
  const timeoutMs = config.timeoutMs ?? 10_000;
  return {
    async send(message) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), timeoutMs); });
      try {
        const response = await Promise.race([
          client.emails.send({
            from: config.from, to: [message.to], subject: message.subject, html: message.html, text: message.text,
            ...(config.replyTo ? { replyTo: config.replyTo } : {}),
            tags: [{ name: "category", value: message.kind }],
          }, { idempotencyKey: message.idempotencyKey }),
          timeout,
        ]);
        if (response === "timeout") return { ok: false, code: "timeout", retryable: true };
        if (!response.error) return { ok: true, providerId: response.data?.id };
        const status = response.error.statusCode ?? 0;
        const retryAfter = Number(response.headers?.["retry-after"]);
        return {
          ok: false, code: response.error.name || "provider_error",
          retryable: retryableResendErrors.has(response.error.name) || status === 429 || status >= 500,
          ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterMs: retryAfter * 1000 } : {}),
        };
      } catch {
        return { ok: false, code: "network_error", retryable: true };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

let cachedTransport: { key: string; transport: EmailTransport | null } | undefined;

/** Transport Resend si les variables serveur sont présentes, sinon `null` (aucun envoi simulé). */
export function resolveEmailTransport(source: NodeJS.ProcessEnv = process.env): EmailTransport | null {
  const env = readEnvironment(source);
  const key = `${env.RESEND_API_KEY ?? ""}|${env.RESEND_FROM_EMAIL ?? ""}|${env.RESEND_REPLY_TO ?? ""}`;
  if (cachedTransport?.key === key) return cachedTransport.transport;
  const transport = env.RESEND_API_KEY && env.RESEND_FROM_EMAIL
    ? createResendTransport({ apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM_EMAIL, replyTo: env.RESEND_REPLY_TO || undefined })
    : null;
  cachedTransport = { key, transport };
  return transport;
}

/**
 * Contexte d'une requête qui déclenche un e-mail Better Auth : langue choisie pour le destinataire et,
 * pour une invitation, la promesse d'envoi que le service attend pour dire honnêtement si l'e-mail est parti.
 */
export type EmailRequestScope = { locale?: Locale; invitationDelivery?: Promise<DeliveryOutcome> };
export const emailRequestScope = new AsyncLocalStorage<EmailRequestScope>();

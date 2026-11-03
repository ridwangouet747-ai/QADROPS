import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import * as authRoute from "@/app/api/auth/[...all]/route";
import * as accountBusinessesRoute from "@/app/api/account/businesses/route";
import * as acceptInvitationRoute from "@/app/api/account/invitations/[invitationId]/route";
import * as teamInvitationsRoute from "@/app/api/business/team/invitations/route";
import { databaseSchema } from "@/lib/db/schema";
import type { CommercialDatabase } from "@/lib/domain/commercial";
import { installHarnessDatabase } from "./harness-database";

/*
 * Harnais de test des routes HTTP (mission 11, phase 7).
 *
 * - Base : PGlite en mémoire avec TOUTES les migrations de `drizzle/`.
 * - Session : la vraie instance Better Auth de l'application (`getAuth()`), construite sur cette base ;
 *   les comptes sont créés par la vraie route `/api/auth/sign-up/email` et chaque requête porte le cookie
 *   de session renvoyé. `getBusinessContext`, `assertActiveMembership` et les permissions ne sont PAS
 *   remplacés : un test qui passe prouve le comportement réel de la route.
 * - Le seul remplacement est `@/lib/db/client` (voir `harness-database.ts`), à déclarer dans le fichier
 *   de test : `vi.mock("@/lib/db/client", () => import("@/test/harness-database"))`.
 * - Aucun service distant : pas de Neon (URL factice jamais contactée), pas de Resend, pas de Turnstile,
 *   pas de clés VAPID (les notifications internes sont écrites, aucun push n'est envoyé).
 */

export const HARNESS_ORIGIN = "http://localhost:3000";
const PASSWORD = "mot-de-passe-de-test-harnais";

/** Variables lues par `readEnvironment()` : valeurs de test évidentes, aucune vraie clé. */
function prepareEnvironment() {
  const env = process.env as Record<string, string | undefined>;
  for (const name of ["QADR_PREVIEW_MODE", "RESEND_API_KEY", "RESEND_FROM_EMAIL", "TURNSTILE_SECRET_KEY", "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
    "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT", "SENTRY_DSN", "NEXT_PUBLIC_SENTRY_DSN", "NEXT_PUBLIC_POSTHOG_KEY"]) delete env[name];
  // URL factice : `getDatabase` est remplacé, cette adresse n'est jamais contactée.
  env.DATABASE_URL = "postgres://harnais:harnais@harnais.invalid/qadr";
  env.BETTER_AUTH_SECRET = "secret-de-test-du-harnais-http-qadr-ops-0123456789";
  env.BETTER_AUTH_URL = HARNESS_ORIGIN;
}

type Params = Record<string, string>;
type RouteHandler<P extends Params> = (request: Request, context: { params: Promise<P> }) => Response | Promise<Response>;

export type HttpResult = {
  status: number;
  headers: Headers;
  bytes: Uint8Array;
  text: string;
  /** Corps JSON décodé (null si la réponse n'est pas du JSON). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
};

/** Compte connecté : cookie de session réel émis par Better Auth. */
export type Actor = { name: string; email: string; userId: string; cookie: string };

export type CallOptions<P extends Params> = {
  method?: string;
  path: string;
  actor?: Actor | null;
  body?: unknown;
  params?: P;
  headers?: Record<string, string>;
  form?: FormData;
};

function cookiesFrom(response: Response) {
  return response.headers.getSetCookie().map((value) => value.split(";")[0]).filter((pair) => !pair.endsWith("=")).join("; ");
}

export class HttpHarness {
  constructor(readonly client: PGlite, readonly db: CommercialDatabase) {}

  /** Appelle directement le gestionnaire exporté d'une route avec une requête construite. */
  async call<P extends Params = Params>(handler: RouteHandler<P>, options: CallOptions<P>): Promise<HttpResult> {
    const method = options.method ?? (options.body === undefined && !options.form ? "GET" : "POST");
    const headers = new Headers({ origin: HARNESS_ORIGIN, ...options.headers });
    if (options.actor) headers.set("cookie", options.actor.cookie);
    let body: BodyInit | undefined;
    if (options.form) body = options.form;
    else if (options.body !== undefined) {
      body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
      headers.set("content-type", "application/json");
    }
    const request = new Request(new URL(options.path, HARNESS_ORIGIN), { method, headers, body });
    const response = await handler(request, { params: Promise.resolve((options.params ?? {}) as P) });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    let parsed: unknown = null;
    if ((response.headers.get("content-type") ?? "").includes("json")) {
      try { parsed = JSON.parse(text); } catch { parsed = null; }
    }
    return { status: response.status, headers: response.headers, bytes, text, body: parsed };
  }

  /** Inscription par la vraie route Better Auth ; renvoie le compte connecté. */
  async signUp(name: string, email: string): Promise<Actor> {
    const response = await authRoute.POST(new Request(`${HARNESS_ORIGIN}/api/auth/sign-up/email`, {
      method: "POST", headers: { "content-type": "application/json", origin: HARNESS_ORIGIN },
      body: JSON.stringify({ name, email, password: PASSWORD }),
    }));
    if (!response.ok) throw new Error(`Harnais : inscription refusée (${response.status}) ${await response.text()}`);
    const { user } = await response.json() as { user: { id: string } };
    return { name, email, userId: user.id, cookie: cookiesFrom(response) };
  }

  /** Nouvelle connexion du même compte (nouvelle session, sans commerce actif). */
  async signIn(actor: Actor): Promise<Actor> {
    const response = await authRoute.POST(new Request(`${HARNESS_ORIGIN}/api/auth/sign-in/email`, {
      method: "POST", headers: { "content-type": "application/json", origin: HARNESS_ORIGIN },
      body: JSON.stringify({ email: actor.email, password: PASSWORD }),
    }));
    if (!response.ok) throw new Error(`Harnais : connexion refusée (${response.status})`);
    return { ...actor, cookie: cookiesFrom(response) };
  }

  /** Commerce créé par la route d'inscription ; il devient le commerce actif de la session du propriétaire. */
  async createBusiness(owner: Actor, name: string, activity: "hardware" | "phones" | "general" | "clothing" = "general") {
    const result = await this.call(accountBusinessesRoute.POST, { path: "/api/account/businesses", actor: owner, body: { name, activity } });
    if (result.status !== 201) throw new Error(`Harnais : création du commerce refusée (${result.status}) ${result.text}`);
    return result.body.business.id as string;
  }

  /** Invitation par la route d'équipe, puis inscription et acceptation par la personne invitée. */
  async addMember(owner: Actor, name: string, email: string, role: "admin" | "cashier" | "stock_manager" | "accountant" | "member") {
    const invited = await this.call(teamInvitationsRoute.POST, { path: "/api/business/team/invitations", actor: owner, body: { email, role } });
    if (invited.status !== 201) throw new Error(`Harnais : invitation refusée (${invited.status}) ${invited.text}`);
    const actor = await this.signUp(name, email);
    const accepted = await this.call(acceptInvitationRoute.POST, { path: `/api/account/invitations/${invited.body.invitation.id}`, actor,
      params: { invitationId: invited.body.invitation.id as string } });
    if (accepted.status !== 200) throw new Error(`Harnais : acceptation refusée (${accepted.status}) ${accepted.text}`);
    return actor;
  }

  /** Accorde le droit Super Admin comme `scripts/platform-admin.ts` (ligne dans `platform_admin`). */
  async grantPlatformAdmin(actor: Actor) {
    await this.client.query("insert into platform_admin (user_id) values ($1)", [actor.userId]);
  }

  async count(sql: string, params: unknown[] = []) {
    return Number((await this.client.query<{ n: string }>(sql, params)).rows[0]!.n);
  }

  async close() { await this.client.close(); }
}

/** Démarre PGlite, applique toutes les migrations et branche la base sur l'application. */
export async function startHttpHarness() {
  prepareEnvironment();
  const client = new PGlite();
  const db = drizzle(client, { schema: databaseSchema });
  await migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  installHarnessDatabase(db);
  return new HttpHarness(client, db as unknown as CommercialDatabase);
}

/** Clé d'idempotence fraîche, au format accepté par `idempotencyKeySchema`. */
export function newKey(prefix = "cle") {
  return `${prefix}-${randomUUID()}`;
}

/** Date du jour au fuseau des commerces de test (Africa/Abidjan = UTC). */
export function todayAbidjan(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

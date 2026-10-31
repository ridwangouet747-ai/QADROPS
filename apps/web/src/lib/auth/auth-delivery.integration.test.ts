import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { databaseSchema } from "../db/schema";
import { acceptInvitation, cancelInvitation, createBusiness, getInvitationForUser, inviteMember } from "../domain/account";
import type { CommercialDatabase } from "../domain/commercial";
import type { EmailLogEntry, EmailMessage, SendResult } from "./email";
import { createQadrAuth } from "./server";
import { turnstileHeader } from "./turnstile";

/*
 * Mission 07.1 : Better Auth réel (PGlite), requêtes passées par son gestionnaire HTTP, avec un faux
 * Siteverify et un faux transport Resend. Prouve que la protection Turnstile est appliquée côté
 * serveur en configuration de production et que les e-mails partent avec la bonne langue et le bon lien.
 */
describe("mission 07.1 : Turnstile et e-mails Resend branchés sur Better Auth", () => {
  const baseURL = "http://localhost:3000";
  const client = new PGlite();
  const db = drizzle(client, { schema: databaseSchema });
  const commercial = db as unknown as CommercialDatabase;

  // Faux Siteverify : « ok-<action> » est valide une seule fois, tout le reste est refusé.
  const spent = new Set<string>();
  const siteverify = vi.fn<typeof fetch>(async (_url, init) => {
    const { response: token } = JSON.parse(String(init!.body)) as { response: string };
    if (spent.has(token)) return new Response(JSON.stringify({ success: false, "error-codes": ["timeout-or-duplicate"] }));
    if (!token.startsWith("ok-")) return new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }));
    spent.add(token);
    return new Response(JSON.stringify({ success: true, hostname: "localhost", action: token.replace(/^ok-/, "").replace(/-\d+$/, "") }));
  });

  // Faux Resend : enregistre les messages ; peut échouer ou retenir l'envoi pour observer le travail après réponse.
  const outbox: EmailMessage[] = [];
  let mode: "ok" | "fail" | "hold" = "ok";
  let release: () => void = () => undefined;
  const transport = {
    send: async (message: EmailMessage): Promise<SendResult> => {
      if (mode === "fail") return { ok: false, code: "validation_error", retryable: false };
      if (mode === "hold") await new Promise<void>((resolveHold) => { release = resolveHold; });
      outbox.push(message);
      return { ok: true };
    },
  };
  const background: Promise<unknown>[] = [];
  const deliveryLog: EmailLogEntry[] = [];
  const auth = createQadrAuth({
    db, secret: "test-secret-qadr-ops-0123456789-abcdefghij", baseURL, isProduction: true,
    emailTransport: transport, emailDelivery: { logger: (entry) => deliveryLog.push(entry), sleep: () => Promise.resolve() },
    backgroundTask: (task) => { background.push(task); },
    turnstile: { secret: "0x4AAAAAAA-secret-de-production", siteKey: "0x4AAAAAAA-cle-publique", fetcher: siteverify },
  });

  const consoleLines: string[] = [];
  let tokenCounter = 0;
  const token = (action: string) => `ok-${action}-${++tokenCounter}`;

  /** Appel HTTP réel du gestionnaire Better Auth, comme depuis le navigateur. */
  function call(path: string, body: unknown, headers: Record<string, string> = {}) {
    return auth.handler(new Request(`${baseURL}/api/auth${path}`, {
      method: "POST", body: JSON.stringify(body),
      headers: { "content-type": "application/json", origin: baseURL, ...headers },
    }));
  }
  const sessionHeaders = (response: Response) => new Headers({ cookie: response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ") });

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
    for (const level of ["info", "warn", "error", "log"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { consoleLines.push(args.map(String).join(" ")); });
    }
  });
  afterAll(async () => { vi.restoreAllMocks(); await client.close(); });

  describe("Turnstile appliqué côté serveur", () => {
    it("refuse une inscription sans jeton et n’enregistre aucun compte", async () => {
      const response = await call("/sign-up/email", { name: "Sans Jeton", email: "sans-jeton@qadr.test", password: "mot-de-passe-solide" });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "TURNSTILE_FAILED" });
      const rows = await client.query("select id from \"user\" where email = 'sans-jeton@qadr.test'");
      expect(rows.rows).toHaveLength(0);
    });

    it("refuse un jeton invalide puis accepte un jeton valide", async () => {
      const body = { name: "Awa Koné", email: "awa@qadr.test", password: "mot-de-passe-solide" };
      expect((await call("/sign-up/email", body, { [turnstileHeader]: "jeton-invente" })).status).toBe(400);
      expect((await call("/sign-up/email", body, { [turnstileHeader]: token("register") })).status).toBe(200);
    });

    it("refuse un jeton déjà utilisé et un jeton prévu pour une autre action", async () => {
      const used = token("login");
      const credentials = { email: "awa@qadr.test", password: "mot-de-passe-solide" };
      expect((await call("/sign-in/email", credentials, { [turnstileHeader]: used })).status).toBe(200);
      expect((await call("/sign-in/email", credentials, { [turnstileHeader]: used })).status).toBe(400);
      expect((await call("/sign-in/email", credentials, { [turnstileHeader]: token("register") })).status).toBe(400);
    });

    it("protège aussi la demande de réinitialisation", async () => {
      expect((await call("/request-password-reset", { email: "awa@qadr.test", redirectTo: "/reset-password" })).status).toBe(400);
    });
  });

  describe("e-mails envoyés par Resend", () => {
    it("envoie la réinitialisation après la réponse, dans la langue du demandeur, avec le lien de Better Auth", async () => {
      mode = "hold";
      const before = outbox.length;
      const response = await call("/request-password-reset", { email: "awa@qadr.test", redirectTo: "/reset-password" },
        { [turnstileHeader]: token("password-reset"), cookie: "qadr-locale=ar" });
      expect(response.status).toBe(200);
      // La réponse est partie alors que l'envoi est encore retenu : rien n'attend le fournisseur.
      expect(outbox.length).toBe(before);
      mode = "ok";
      release();
      await Promise.all(background);
      const message = outbox.at(-1)!;
      expect(message).toMatchObject({ kind: "password_reset", to: "awa@qadr.test", locale: "ar" });
      expect(message.html).toContain('dir="rtl"');
      expect(message.actionUrl).toMatch(/^http:\/\/localhost:3000\/api\/auth\/reset-password\/[\w-]+\?callbackURL=%2Freset-password$/);
    });

    it("répond pareil pour une adresse inconnue, sans e-mail", async () => {
      const before = outbox.length;
      background.length = 0;
      const unknown = await call("/request-password-reset", { email: "personne@qadr.test", redirectTo: "/reset-password" }, { [turnstileHeader]: token("password-reset") });
      const known = await call("/request-password-reset", { email: "awa@qadr.test", redirectTo: "/reset-password" }, { [turnstileHeader]: token("password-reset") });
      expect(unknown.status).toBe(known.status);
      expect(await unknown.json()).toEqual(await known.json());
      await Promise.all(background);
      expect(outbox.length).toBe(before + 1);
      expect(outbox.at(-1)!.to).toBe("awa@qadr.test");
    });

    it("envoie l’invitation dans la langue choisie, au bon destinataire, avec le lien d’acceptation existant", async () => {
      const signedIn = await call("/sign-in/email", { email: "awa@qadr.test", password: "mot-de-passe-solide" }, { [turnstileHeader]: token("login") });
      const headers = sessionHeaders(signedIn);
      const business = await createBusiness(auth, headers, { name: "Quincaillerie Koné & Fils", activity: "hardware" });
      const userId = (await auth.api.getSession({ headers }))!.user.id;
      const context = { businessId: business.id, actorUserId: userId };

      const invited = await inviteMember(auth, commercial, headers, context, { email: "Moussa@Qadr.test", role: "cashier", emailLocale: "en" });
      expect(invited.emailStatus).toBe("sent");
      const first = outbox.at(-1)!;
      expect(first).toMatchObject({ kind: "invitation", to: "moussa@qadr.test", locale: "en", actionUrl: `${baseURL}/invitations/${invited.id}` });
      expect(first.text).toContain("Quincaillerie Koné & Fils");
      expect(first.text).toContain("Cashier");

      // Nouvel envoi volontaire : même invitation (Better Auth la renouvelle), mais nouvelle clé, donc nouvel e-mail.
      await new Promise((wait) => setTimeout(wait, 5));
      const again = await inviteMember(auth, commercial, headers, context, { email: "moussa@qadr.test", role: "cashier" });
      const second = outbox.at(-1)!;
      expect(again.id).toBe(invited.id);
      expect(second.locale).toBe("fr");
      expect(second.idempotencyKey).not.toBe(first.idempotencyKey);

      // Échec du fournisseur : l'invitation existe, mais l'e-mail n'est pas annoncé comme envoyé.
      mode = "fail";
      const failed = await inviteMember(auth, commercial, headers, context, { email: "fatou@qadr.test", role: "accountant" });
      mode = "ok";
      expect(failed.emailStatus).toBe("failed");
      const stored = await client.query<{ status: string }>("select status from invitation where id = $1", [failed.id]);
      expect(stored.rows[0]!.status).toBe("pending");
    });

    it("envoie la vérification d’adresse sur demande du titulaire connecté, sans l’imposer à l’inscription", async () => {
      const before = outbox.filter((message) => message.kind === "email_verification").length;
      expect(before).toBe(0);
      // Sans session, personne ne peut déclencher un envoi vers une adresse non vérifiée.
      const anonymous = await call("/send-verification-email", { email: "awa@qadr.test" });
      expect(anonymous.status).toBe(401);
      expect(outbox.filter((message) => message.kind === "email_verification")).toHaveLength(0);
      const signedIn = await call("/sign-in/email", { email: "awa@qadr.test", password: "mot-de-passe-solide" }, { [turnstileHeader]: token("login") });
      await auth.api.sendVerificationEmail({ headers: sessionHeaders(signedIn), body: { email: "awa@qadr.test", callbackURL: "/" } });
      await Promise.all(background);
      const message = outbox.at(-1)!;
      expect(message).toMatchObject({ kind: "email_verification", to: "awa@qadr.test", locale: "fr" });
      expect(message.actionUrl).toContain("/api/auth/verify-email?token=");
    });

    describe("mission 07.2 : adresse vérifiée exigée pour accepter une invitation", () => {
      const state: { owner?: Headers; businessId?: string; ownerId?: string } = {};
      async function signUp(name: string, email: string) {
        const response = await call("/sign-up/email", { name, email, password: "mot-de-passe-solide" }, { [turnstileHeader]: token("register") });
        expect(response.status).toBe(200);
        return sessionHeaders(response);
      }
      async function verify(headers: Headers, email: string) {
        await auth.api.sendVerificationEmail({ headers, body: { email } });
        await Promise.all(background);
        const message = outbox.filter((sent) => sent.kind === "email_verification" && sent.to === email).at(-1)!;
        await auth.api.verifyEmail({ query: { token: new URL(message.actionUrl).searchParams.get("token")! } });
      }
      const context = () => ({ businessId: state.businessId!, actorUserId: state.ownerId! });
      const invite = (email: string) => inviteMember(auth, commercial, state.owner!, context(), { email, role: "cashier" });

      beforeAll(async () => {
        state.owner = await signUp("Aminata", "aminata@qadr.test");
        state.businessId = (await createBusiness(auth, state.owner, { name: "Boutique Aminata", activity: "general" })).id;
        state.ownerId = (await auth.api.getSession({ headers: state.owner }))!.user.id;
      });

      it("envoie l’invitation à Moussa et la laisse accepter une fois son adresse vérifiée", async () => {
        const invited = await invite("moussa.k@qadr.test");
        expect(outbox.at(-1)).toMatchObject({ kind: "invitation", to: "moussa.k@qadr.test" });
        const moussa = await signUp("Moussa", "moussa.k@qadr.test");
        const view = await getInvitationForUser(commercial, invited.id, "moussa.k@qadr.test", { required: true, emailVerified: false });
        expect(view).toMatchObject({ state: "pending", needsEmailVerification: true });
        await expect(acceptInvitation(auth, moussa, invited.id)).rejects.toMatchObject({ status: 403, message: expect.stringContaining("Confirmez") });
        await verify(moussa, "moussa.k@qadr.test");
        await expect(acceptInvitation(auth, moussa, invited.id)).resolves.toEqual({ businessId: state.businessId });
        const role = await client.query<{ role: string }>("select m.role from member m join \"user\" u on u.id = m.user_id where u.email = 'moussa.k@qadr.test' and m.organization_id = $1", [state.businessId]);
        expect(role.rows[0]!.role).toBe("cashier");

        // Invitation déjà acceptée : un second passage est refusé.
        await expect(getInvitationForUser(commercial, invited.id, "moussa.k@qadr.test")).resolves.toMatchObject({ state: "accepted" });
        await expect(acceptInvitation(auth, moussa, invited.id)).rejects.toThrow();
      });

      it("refuse l’invitation ouverte avec une autre adresse, même vérifiée", async () => {
        const invited = await invite("ibrahim@qadr.test");
        const other = await signUp("Autre", "autre@qadr.test");
        await verify(other, "autre@qadr.test");
        await expect(getInvitationForUser(commercial, invited.id, "autre@qadr.test")).rejects.toMatchObject({ status: 404 });
        await expect(acceptInvitation(auth, other, invited.id)).rejects.toThrow();
      });

      it("refuse un lien transféré à un tiers qui crée un compte avec l’adresse invitée", async () => {
        const invited = await invite("fatou.d@qadr.test");
        // Le tiers a reçu le lien et s'inscrit le premier avec l'adresse de Fatou : il ne peut pas la confirmer.
        const impostor = await signUp("Tiers", "fatou.d@qadr.test");
        await expect(acceptInvitation(auth, impostor, invited.id)).rejects.toMatchObject({ status: 403, message: expect.stringContaining("Confirmez") });
        const members = await client.query("select m.id from member m join \"user\" u on u.id = m.user_id where u.email = 'fatou.d@qadr.test'");
        expect(members.rows).toHaveLength(0);
      });

      it("refuse une invitation expirée, même avec une adresse vérifiée", async () => {
        const invited = await invite("salif@qadr.test");
        await client.query("update invitation set expires_at = now() - interval '1 hour' where id = $1", [invited.id]);
        const salif = await signUp("Salif", "salif@qadr.test");
        await verify(salif, "salif@qadr.test");
        await expect(getInvitationForUser(commercial, invited.id, "salif@qadr.test")).resolves.toMatchObject({ state: "expired" });
        await expect(acceptInvitation(auth, salif, invited.id)).rejects.toThrow();
      });

      it("refuse une invitation révoquée, même avec une adresse vérifiée", async () => {
        const invited = await invite("awa.t@qadr.test");
        await cancelInvitation(auth, commercial, state.owner!, context(), invited.id);
        const awa = await signUp("Awa T", "awa.t@qadr.test");
        await verify(awa, "awa.t@qadr.test");
        await expect(getInvitationForUser(commercial, invited.id, "awa.t@qadr.test")).resolves.toMatchObject({ state: "canceled" });
        await expect(acceptInvitation(auth, awa, invited.id)).rejects.toThrow();
      });
    });

    it("ne journalise ni jeton, ni lien, ni destinataire, ni secret", async () => {
      await Promise.all(background);
      const written = [...consoleLines, ...deliveryLog.map((entry) => JSON.stringify(entry))].join("\n");
      expect(deliveryLog.length).toBeGreaterThan(0);
      for (const message of outbox) {
        expect(written).not.toContain(message.to);
        expect(written).not.toContain(message.actionUrl);
        expect(written).not.toContain(message.idempotencyKey);
      }
      for (const used of spent) expect(written).not.toContain(used);
      expect(written).not.toContain("0x4AAAAAAA-secret-de-production");
      expect(written).toContain('"event":"turnstile.rejected"');
    });
  });
});

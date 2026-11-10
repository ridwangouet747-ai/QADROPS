import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as businessesRoute from "@/app/api/account/businesses/route";
import * as authRoute from "@/app/api/auth/[...all]/route";
import * as customersRoute from "@/app/api/business/customers/route";
import * as reportExportRoute from "@/app/api/business/reports/export/route";
import * as platformPlansRoute from "@/app/api/platform/plans/route";
import type { EmailMessage, SendResult } from "@/lib/auth/email";
import { createQadrAuth, signUpRefusal } from "@/lib/auth/server";
import { EXPORT_LIMITS } from "@/lib/domain/exports";
import { HARNESS_ORIGIN, startHttpHarness, type Actor, type HttpHarness } from "./http-harness";

vi.mock("@/lib/db/client", () => import("@/test/harness-database"));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

/*
 * Mission 16 : inscription sans révélation d'adresse, récupération du mot de passe de bout en bout, contrôle
 * d'origine des routes de l'application et bornes de taille des exports. Vraie instance Better Auth sur PGlite
 * migrée ; seul le transport d'e-mail est un faux (option `emailTransport`, aucun appel à Resend).
 */
const PASSWORD = "mot-de-passe-de-test-harnais";
let ipCounter = 0;
/** Adresse IP distincte par requête : les limites par adresse ne se mêlent pas aux assertions. */
const nextIp = () => `198.18.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;

function authPost(path: string, body: unknown, headers: Record<string, string> = {}) {
  return authRoute.POST(new Request(`${HARNESS_ORIGIN}/api/auth${path}`, {
    method: "POST", headers: { "content-type": "application/json", origin: HARNESS_ORIGIN, "x-forwarded-for": nextIp(), ...headers }, body: JSON.stringify(body),
  }));
}
async function sessionOf(cookie: string) {
  const response = await authRoute.GET(new Request(`${HARNESS_ORIGIN}/api/auth/get-session`, { headers: { cookie } }));
  return response.json() as Promise<{ user: { email: string } } | null>;
}

describe("mission 16 : sécurité des comptes et des routes", () => {
  let h: HttpHarness;
  beforeAll(async () => { h = await startHttpHarness(); });
  afterAll(async () => { await h?.close(); });

  describe("inscription : une adresse déjà inscrite n'est pas révélée", () => {
    it("refus unique, sans session ni modification du compte existant", async () => {
      await h.signUp("Awa Boutique", "awa@boutique.test");
      const users = await h.count(`select count(*) as n from "user"`);
      for (const email of ["awa@boutique.test", "AWA@Boutique.test"]) {
        const response = await authPost("/sign-up/email", { name: "Intrus", email, password: "autre-mot-de-passe-1" });
        expect(response.status).toBe(422);
        expect(await response.json()).toEqual(signUpRefusal);
        expect(response.headers.getSetCookie().some((value) => /session_token=[^;]/.test(value))).toBe(false);
      }
      expect(signUpRefusal).toEqual({ code: "SIGN_UP_FAILED", message: "SIGN_UP_FAILED" });
      expect(await h.count(`select count(*) as n from "user"`)).toBe(users);
      // Le mot de passe du vrai titulaire n'a pas changé ; l'essai de l'intrus ne connecte pas.
      expect((await authPost("/sign-in/email", { email: "awa@boutique.test", password: PASSWORD })).status).toBe(200);
      expect((await authPost("/sign-in/email", { email: "awa@boutique.test", password: "autre-mot-de-passe-1" })).status).toBe(401);
    });

    it("les erreurs de saisie restent dites avant tout test d'existence (aucun indice sans création possible)", async () => {
      const short = await authPost("/sign-up/email", { name: "Awa", email: "awa@boutique.test", password: "court" });
      const shortUnknown = await authPost("/sign-up/email", { name: "Inconnu", email: "inconnu@boutique.test", password: "court" });
      expect(short.status).toBe(400);
      expect(shortUnknown.status).toBe(400);
      expect(await short.json()).toEqual(await shortUnknown.json());
    });

    it("durée comparable : le refus hache le mot de passe comme une création", async () => {
      const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
      const created: number[] = []; const refused: number[] = [];
      for (let index = 0; index < 5; index += 1) {
        let start = performance.now();
        expect((await authPost("/sign-up/email", { name: `Nouveau ${index}`, email: `nouveau-${index}@duree.test`, password: "mot-de-passe-solide" })).status).toBe(200);
        created.push(performance.now() - start);
        start = performance.now();
        expect((await authPost("/sign-up/email", { name: `Doublon ${index}`, email: `nouveau-${index}@duree.test`, password: "mot-de-passe-solide" })).status).toBe(422);
        refused.push(performance.now() - start);
      }
      // Sans le hachage du refus, sa durée tombait à une petite fraction de celle d'une création (scrypt).
      expect(median(refused), JSON.stringify({ created, refused })).toBeGreaterThan(median(created) * 0.5);
    });

    it("le parcours normal (inscription puis création du commerce) est inchangé", async () => {
      const owner = await h.signUp("Koffi Quincaillerie", "koffi@quincaillerie.test");
      const businessId = await h.createBusiness(owner, "Quincaillerie Koffi", "hardware");
      expect(businessId).toEqual(expect.any(String));
    });
  });

  describe("mot de passe oublié, de bout en bout", () => {
    const outbox: EmailMessage[] = [];
    const background: Promise<unknown>[] = [];
    let mailer: ReturnType<typeof createQadrAuth>;
    let victim: Actor;

    const request = (email: string, redirectTo = "/reset-password") => mailer.handler(new Request(`${HARNESS_ORIGIN}/api/auth/request-password-reset`, {
      method: "POST", headers: { "content-type": "application/json", origin: HARNESS_ORIGIN, "x-forwarded-for": nextIp() }, body: JSON.stringify({ email, redirectTo }),
    }));
    const reset = (token: string, newPassword: string) => mailer.handler(new Request(`${HARNESS_ORIGIN}/api/auth/reset-password`, {
      method: "POST", headers: { "content-type": "application/json", origin: HARNESS_ORIGIN, "x-forwarded-for": nextIp() }, body: JSON.stringify({ token, newPassword }),
    }));
    async function latestToken(email: string) {
      await Promise.all(background);
      const message = outbox.filter((sent) => sent.to === email).at(-1)!;
      return { message, token: new URL(message.actionUrl).pathname.split("/").at(-1)! };
    }

    beforeAll(async () => {
      const transport = { send: async (message: EmailMessage): Promise<SendResult> => { outbox.push(message); return { ok: true }; } };
      // Même base et même secret que l'application : les sessions de l'une sont celles de l'autre.
      mailer = createQadrAuth({ db: h.db, secret: process.env.BETTER_AUTH_SECRET!, baseURL: HARNESS_ORIGIN, isProduction: false,
        emailTransport: transport, emailDelivery: { logger: () => undefined, sleep: () => Promise.resolve() }, backgroundTask: (task) => { background.push(task); } });
      victim = await h.signUp("Mariam Tissus", "mariam@tissus.test");
    });

    it("même statut, même corps, adresse connue ou non ; un seul e-mail, au titulaire", async () => {
      const known = await request("mariam@tissus.test");
      const unknown = await request("personne@tissus.test");
      expect(known.status).toBe(200);
      expect(unknown.status).toBe(200);
      const body = await known.json();
      expect(await unknown.json()).toEqual(body);
      expect(body).toEqual({ status: true, message: "If this email exists in our system, check your email for the reset link" });
      await Promise.all(background);
      expect(outbox.map((message) => message.to)).toEqual(["mariam@tissus.test"]);
    });

    it("jeton de 24 caractères aléatoires, conservé seulement en empreinte, lien vers la page de l'application", async () => {
      const { message, token } = await latestToken("mariam@tissus.test");
      expect(token).toMatch(/^[A-Za-z0-9]{24}$/);
      expect(message.actionUrl).toBe(`${HARNESS_ORIGIN}/api/auth/reset-password/${token}?callbackURL=%2Freset-password`);
      const stored = await h.client.query<{ identifier: string; value: string; expires_at: Date }>("select identifier, value, expires_at from verification");
      expect(JSON.stringify(stored.rows)).not.toContain(token);
      const row = stored.rows.find((entry) => entry.value === victim.userId)!;
      expect(row.identifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
      // Valable une heure (authDurations.passwordResetSeconds).
      expect(new Date(row.expires_at).getTime() - Date.now()).toBeGreaterThan(55 * 60_000);
      expect(new Date(row.expires_at).getTime() - Date.now()).toBeLessThanOrEqual(60 * 60_000);

      const opened = await mailer.handler(new Request(message.actionUrl, { headers: { "x-forwarded-for": nextIp() } }));
      expect(opened.status).toBe(302);
      expect(opened.headers.get("location")).toBe(`${HARNESS_ORIGIN}/reset-password?token=${token}`);
      const forged = await mailer.handler(new Request(`${HARNESS_ORIGIN}/api/auth/reset-password/${"A".repeat(24)}?callbackURL=%2Freset-password`, { headers: { "x-forwarded-for": nextIp() } }));
      expect(forged.headers.get("location")).toBe(`${HARNESS_ORIGIN}/reset-password?error=INVALID_TOKEN`);
    });

    it("refuse un lien de retour vers un autre site", async () => {
      // Sans ce refus, le lien de l'e-mail renverrait la victime, jeton compris, vers le site de l'attaquant.
      const response = await request("mariam@tissus.test", "https://attaquant.example/vol");
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "INVALID_REDIRECT_URL" });
      await Promise.all(background);
      expect(outbox.filter((message) => message.actionUrl.includes("attaquant"))).toHaveLength(0);
    });

    it("nouveau mot de passe : toutes les sessions fermées, jeton à usage unique, ancien mot de passe refusé", async () => {
      const second = await h.signIn(victim);
      expect(await sessionOf(victim.cookie)).toMatchObject({ user: { email: "mariam@tissus.test" } });
      expect(await sessionOf(second.cookie)).toMatchObject({ user: { email: "mariam@tissus.test" } });
      const { token } = await latestToken("mariam@tissus.test");

      // Mot de passe trop court : refus, sans consommer le jeton.
      const short = await reset(token, "court");
      expect(short.status).toBe(400);
      expect(await short.json()).toMatchObject({ code: "PASSWORD_TOO_SHORT" });

      const done = await reset(token, "nouveau-mot-de-passe-solide");
      expect(done.status).toBe(200);
      expect(await done.json()).toEqual({ status: true });
      expect(await sessionOf(victim.cookie)).toBeNull();
      expect(await sessionOf(second.cookie)).toBeNull();
      expect(await h.count("select count(*) as n from session where user_id = $1", [victim.userId])).toBe(0);

      const again = await reset(token, "encore-un-autre-mot-de-passe");
      expect(again.status).toBe(400);
      expect(await again.json()).toMatchObject({ code: "INVALID_TOKEN" });
      expect((await authPost("/sign-in/email", { email: "mariam@tissus.test", password: PASSWORD })).status).toBe(401);
      expect((await authPost("/sign-in/email", { email: "mariam@tissus.test", password: "nouveau-mot-de-passe-solide" })).status).toBe(200);
    });

    it("lien expiré refusé", async () => {
      await h.signUp("Yao Téléphones", "yao@telephones.test");
      expect((await request("yao@telephones.test")).status).toBe(200);
      const { token } = await latestToken("yao@telephones.test");
      await h.client.query("update verification set expires_at = $1 where value = (select id from \"user\" where email = 'yao@telephones.test')", [new Date(Date.now() - 60_000)]);
      const expired = await reset(token, "nouveau-mot-de-passe-solide");
      expect(expired.status).toBe(400);
      expect(await expired.json()).toMatchObject({ code: "INVALID_TOKEN" });
    });

    it("compte à second facteur (propriétaire de la plateforme) : même réponse, aucun e-mail", async () => {
      const owner = await h.signUp("Propriétaire Plateforme", "proprietaire@qadr.test");
      await h.client.query("update \"user\" set two_factor_enabled = true where id = $1", [owner.userId]);
      const before = outbox.length;
      const response = await request("proprietaire@qadr.test");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: true, message: "If this email exists in our system, check your email for the reset link" });
      await Promise.all(background);
      expect(outbox.length).toBe(before);
    });
  });

  describe("contrôle d'origine des routes authentifiées par cookie", () => {
    let owner: Actor;
    const refusal = { error: "Origine de la requête refusée.", code: "invalid_origin" };
    beforeAll(async () => {
      owner = await h.signUp("Fatou Vêtements", "fatou@vetements.test");
      await h.createBusiness(owner, "Vêtements Fatou", "clothing");
    });
    const organizations = () => h.count("select count(*) as n from organization");

    it("POST /api/account/businesses : origine étrangère, « null » ou requête intersite sans Origin refusées (403), rien n'est créé", async () => {
      const before = await organizations();
      const body = { name: "Commerce imposé", activity: "general" };
      for (const headers of [{ origin: "https://attaquant.example" }, { origin: "null" }, { origin: "https://boutique.localhost.attaquant.example" }]) {
        const result = await h.call(businessesRoute.POST, { path: "/api/account/businesses", actor: owner, body, headers });
        expect(result.status, headers.origin).toBe(403);
        expect(result.body).toEqual(refusal);
      }
      // Formulaire intersite sans en-tête Origin (cas défensif) : Sec-Fetch-Site suffit à refuser une écriture.
      const crossSite = await businessesRoute.POST(new Request(`${HARNESS_ORIGIN}/api/account/businesses`, {
        method: "POST", headers: { "content-type": "text/plain", cookie: owner.cookie, "sec-fetch-site": "cross-site" }, body: JSON.stringify(body),
      }));
      expect(crossSite.status).toBe(403);
      expect(await crossSite.json()).toEqual(refusal);
      expect(await organizations()).toBe(before);
    });

    it("POST /api/account/businesses : même origine, ou même hôte (aperçu local), ou client hors navigateur acceptés", async () => {
      const sameOrigin = await h.call(businessesRoute.POST, { path: "/api/account/businesses", actor: owner, body: { name: "Deuxième boutique", activity: "general" } });
      expect(sameOrigin.status).toBe(201);
      const sameHost = await h.call(businessesRoute.POST, { path: "/api/account/businesses", actor: owner, body: { name: "Boutique aperçu", activity: "general" },
        headers: { origin: "http://127.0.0.1:3005", host: "127.0.0.1:3005" } });
      expect(sameHost.status).toBe(201);
      const noBrowser = await businessesRoute.POST(new Request(`${HARNESS_ORIGIN}/api/account/businesses`, {
        method: "POST", headers: { "content-type": "application/json", cookie: owner.cookie }, body: JSON.stringify({ name: "Boutique script", activity: "general" }),
      }));
      expect(noBrowser.status).toBe(201);
    });

    it("routes Better Auth avec cookie : origine étrangère refusée, comme en production (contrôle forcé en test)", async () => {
      const session = await h.signIn(owner);
      const forged = await authRoute.POST(new Request(`${HARNESS_ORIGIN}/api/auth/sign-out`, {
        method: "POST", headers: { cookie: session.cookie, origin: "https://attaquant.example", "x-forwarded-for": nextIp() },
      }));
      expect(forged.status).toBe(403);
      expect(await forged.json()).toMatchObject({ code: "INVALID_ORIGIN" });
      expect(await sessionOf(session.cookie)).toMatchObject({ user: { email: "fatou@vetements.test" } });
    });

    it("routes de commerce et de la console : même refus avant toute lecture ou écriture", async () => {
      const customers = () => h.count("select count(*) as n from customer");
      const before = await customers();
      const forged = await h.call(customersRoute.POST, { path: "/api/business/customers", actor: owner, body: { name: "Client imposé" }, headers: { origin: "https://attaquant.example" } });
      expect(forged.status).toBe(403);
      expect(forged.body).toEqual(refusal);
      expect(await customers()).toBe(before);
      expect((await h.call(customersRoute.POST, { path: "/api/business/customers", actor: owner, body: { name: "Client réel" } })).status).toBe(201);

      const admin = await h.signUp("Console", "console@qadr.test");
      await h.grantPlatformAdmin(admin);
      const plans = () => h.count("select count(*) as n from subscription_plan");
      const plansBefore = await plans();
      const platform = await h.call(platformPlansRoute.POST, { path: "/api/platform/plans", actor: admin, body: { code: "imposee", name: "Formule imposée", priceXof: "1000", durationDays: 30 },
        headers: { origin: "https://attaquant.example" } });
      expect(platform.status).toBe(403);
      expect(platform.body).toEqual(refusal);
      expect(await plans()).toBe(plansBefore);
      expect((await h.call(platformPlansRoute.GET, { path: "/api/platform/plans", actor: admin })).status).toBe(200);
    });
  });

  describe("exports : bornes de taille", () => {
    let owner: Actor;
    const saved = { ...EXPORT_LIMITS };
    beforeAll(async () => {
      owner = await h.signUp("Salif Général", "salif@general.test");
      await h.createBusiness(owner, "Commerce Salif");
    });
    afterAll(() => { Object.assign(EXPORT_LIMITS, saved); });
    const exportAs = (format: string) => h.call(reportExportRoute.GET, { path: `/api/business/reports/export?format=${format}&period=monthly`, actor: owner });
    const tooLarge = { error: "Le fichier dépasse la taille autorisée : choisissez une période plus courte.", code: "export_too_large" };

    it("classeur XLSX : refus 422 au-delà des octets de XML ou du fichier, accepté sous les bornes", async () => {
      const normal = await exportAs("xlsx");
      expect(normal.status).toBe(200);
      expect(normal.bytes.byteLength).toBeGreaterThan(1_000);

      EXPORT_LIMITS.xlsxXmlBytes = 200;
      const xml = await exportAs("xlsx");
      expect(xml.status).toBe(422);
      expect(xml.body).toEqual(tooLarge);
      Object.assign(EXPORT_LIMITS, saved);

      EXPORT_LIMITS.fileBytes = normal.bytes.byteLength - 1;
      const file = await exportAs("xlsx");
      expect(file.status).toBe(422);
      expect(file.body).toEqual(tooLarge);
      expect(file.headers.get("content-disposition")).toBeNull();
      Object.assign(EXPORT_LIMITS, saved);
      expect((await exportAs("xlsx")).status).toBe(200);
    });

    it("CSV et PDF soumis à la même borne de fichier", async () => {
      EXPORT_LIMITS.fileBytes = 10;
      for (const format of ["csv", "pdf"]) {
        const result = await exportAs(format);
        expect(result.status, format).toBe(422);
        expect(result.body).toEqual(tooLarge);
      }
      Object.assign(EXPORT_LIMITS, saved);
      expect((await exportAs("csv")).status).toBe(200);
    });
  });
});

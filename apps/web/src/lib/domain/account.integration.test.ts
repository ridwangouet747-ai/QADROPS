import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EmailMessage } from "../auth/email";
import { createQadrAuth } from "../auth/server";
import { databaseSchema } from "../db/schema";
import {
  acceptInvitation, cancelInvitation, changeMemberRole, createBusiness, getAccountOverview, getInvitationForUser,
  inviteMember, listTeam, logoBytesMatch, setActiveBusiness, setMemberAccess,
} from "./account";
import { assertActiveMembership } from "./business-context";
import type { CommercialDatabase } from "./commercial";

const PNG = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).toString("base64")}`;

describe("mission 07 : authentification, commerces et équipes (Better Auth sur PGlite)", () => {
  const client = new PGlite();
  const db = drizzle(client, { schema: databaseSchema });
  const commercial = db as unknown as CommercialDatabase;
  const outbox: EmailMessage[] = [];
  const auth = createQadrAuth({ db, secret: "test-secret-qadr-ops-0123456789-abcdefghij", baseURL: "http://localhost:3000", isProduction: false,
    emailTransport: { send: async (message) => { outbox.push(message); return { ok: true }; } } });
  const ids: Record<string, string> = {};

  /** Connecte un compte et renvoie des en-têtes porteurs du cookie de session. */
  async function signIn(email: string, password = "mot-de-passe-solide") {
    const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
    if (!response.ok) throw new Error(`connexion refusée (${response.status})`);
    const cookies = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    return new Headers({ cookie: cookies });
  }
  async function signUp(name: string, email: string) {
    await auth.api.signUpEmail({ body: { name, email, password: "mot-de-passe-solide" } });
    return signIn(email);
  }
  const userId = async (headers: Headers) => (await auth.api.getSession({ headers }))!.user.id;
  /** Confirme l'adresse du compte connecté avec le vrai lien envoyé par e-mail (faux transport). */
  async function verifyEmail(headers: Headers, email: string) {
    await auth.api.sendVerificationEmail({ headers, body: { email } });
    const message = outbox.filter((sent) => sent.kind === "email_verification" && sent.to === email).at(-1)!;
    await auth.api.verifyEmail({ query: { token: new URL(message.actionUrl).searchParams.get("token")! } });
  }

  beforeAll(async () => { await migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") }); });
  afterAll(async () => { await client.close(); });

  describe("comptes et sessions", () => {
    it("inscrit, connecte puis déconnecte un utilisateur sans stocker son mot de passe en clair", async () => {
      const headers = await signUp("Awa Koné", "awa@qadr.test");
      const current = await auth.api.getSession({ headers });
      expect(current?.user.email).toBe("awa@qadr.test");
      const stored = await client.query<{ password: string }>("select password from account where provider_id='credential' and user_id=$1", [current!.user.id]);
      expect(stored.rows[0]!.password).not.toContain("mot-de-passe-solide");
      await expect(auth.api.signInEmail({ body: { email: "awa@qadr.test", password: "mauvais-mot-de-passe" } })).rejects.toThrow();
      await auth.api.signOut({ headers });
      expect(await auth.api.getSession({ headers })).toBeNull();
    });

    it("refuse un mot de passe trop court", async () => {
      await expect(auth.api.signUpEmail({ body: { name: "Court", email: "court@qadr.test", password: "1234" } })).rejects.toThrow();
    });

    it("considère une session expirée comme déconnectée", async () => {
      const headers = await signIn("awa@qadr.test");
      await client.query("update session set expires_at = now() - interval '1 minute' where user_id = $1", [await userId(headers)]);
      expect(await auth.api.getSession({ headers })).toBeNull();
    });
  });

  describe("création et sélection du commerce", () => {
    it("crée un commerce avec son profil, ses réglages de reçu et le créateur comme propriétaire actif", async () => {
      const headers = await signIn("awa@qadr.test");
      const created = await createBusiness(auth, headers, { name: "Quincaillerie du Plateau", activity: "hardware", phone: "+225 07 00 00 00 00", logo: PNG });
      ids.a1 = created.id;
      const profile = await client.query<{ activity: string; currency: string; phone: string }>("select activity,currency,phone from business_profile where business_id=$1", [created.id]);
      expect(profile.rows[0]).toEqual({ activity: "hardware", currency: "XOF", phone: "+225 07 00 00 00 00" });
      const receipt = await client.query<{ n: string }>("select count(*)::text n from receipt_settings where business_id=$1", [created.id]);
      expect(receipt.rows[0]!.n).toBe("1");
      const current = await auth.api.getSession({ headers });
      expect(current?.session.activeOrganizationId).toBe(created.id);
      expect(await assertActiveMembership(commercial, created.id, current!.user.id)).toBe("owner");
    });

    it("rejoue une création interrompue sans doublon et conserve le type et le nom des documents (mission 08)", async () => {
      const headers = await signIn("awa@qadr.test");
      const body = { name: "Kiosque Awa", activity: "phones", storeFormat: "kiosk", displayName: "Awa Phones", creationKey: "brouillon-awa-0123456789abcdef" };
      const first = await createBusiness(auth, headers, body, commercial);
      const replay = await createBusiness(auth, headers, body, commercial);
      expect(first.replayed).toBe(false);
      expect(replay).toMatchObject({ id: first.id, replayed: true });
      const stored = await client.query<{ n: string; store_format: string; display_name: string }>("select (select count(*)::text from business_profile where creation_key=$1) n, p.store_format, r.display_name from business_profile p join receipt_settings r on r.business_id=p.business_id where p.business_id=$2", [body.creationKey, first.id]);
      expect(stored.rows[0]).toEqual({ n: "1", store_format: "kiosk", display_name: "Awa Phones" });
      // Un autre compte qui rejoue la même clé obtient son propre commerce, complet, jamais celui d'Awa.
      const other = await signUp("Intrus", "intrus@qadr.test");
      const own = await createBusiness(auth, other, body, commercial);
      expect(own.id).not.toBe(first.id);
      const profile = await client.query<{ creation_key: string | null }>("select creation_key from business_profile where business_id=$1", [own.id]);
      expect(profile.rows[0]).toEqual({ creation_key: null });
      await expect(createBusiness(auth, headers, { ...body, storeFormat: "casino" }, commercial)).rejects.toThrow();
    });

    it("refuse une activité inconnue et un logo dont le contenu ne correspond pas au type", async () => {
      const headers = await signIn("awa@qadr.test");
      await expect(createBusiness(auth, headers, { name: "Inconnu", activity: "casino" })).rejects.toThrow();
      const fake = `data:image/png;base64,${Buffer.from("<svg onload=alert(1)>").toString("base64")}`;
      expect(logoBytesMatch(fake)).toBe(false);
      await expect(createBusiness(auth, headers, { name: "Logo piégé", activity: "general", logo: fake })).rejects.toThrow();
    });

    it("liste plusieurs commerces et ne permet de sélectionner que ceux dont on est membre", async () => {
      const awa = await signIn("awa@qadr.test");
      ids.a2 = (await createBusiness(auth, awa, { name: "Boutique Mode Awa", activity: "clothing" })).id;
      const bruno = await signUp("Bruno", "bruno@qadr.test");
      ids.b1 = (await createBusiness(auth, bruno, { name: "Téléphonie Bruno", activity: "phones" })).id;

      const awaId = await userId(awa);
      const overview = await getAccountOverview(commercial, awaId, ids.a2);
      expect(overview.businesses.map((row) => row.name)).toEqual(["Boutique Mode Awa", "Kiosque Awa", "Quincaillerie du Plateau"]);
      expect(overview.isPlatformAdmin).toBe(false);
      await expect(setActiveBusiness(auth, commercial, awa, awaId, { businessId: ids.a1 })).resolves.toEqual({ businessId: ids.a1 });
      // Un identifiant de commerce fourni par le navigateur ne suffit jamais.
      await expect(setActiveBusiness(auth, commercial, awa, awaId, { businessId: ids.b1 })).rejects.toMatchObject({ status: 403 });
      await expect(assertActiveMembership(commercial, ids.b1!, awaId)).rejects.toMatchObject({ status: 403 });
      expect((await auth.api.getSession({ headers: awa }))?.session.activeOrganizationId).toBe(ids.a1);
    });
  });

  describe("équipe et invitations", () => {
    it("invite un caissier, refuse l’invitation à un autre compte, puis l’accepte avec le bon compte", async () => {
      const awa = await signIn("awa@qadr.test");
      const context = { businessId: ids.a1!, actorUserId: await userId(awa) };
      const invited = await inviteMember(auth, commercial, awa, context, { email: "Chantal@Qadr.test", role: "cashier" });
      expect(invited.path).toBe(`/invitations/${invited.id}`);
      expect(new Date(invited.expiresAt).getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 3600 * 1000);
      expect(outbox.at(-1)).toMatchObject({ kind: "invitation", to: "chantal@qadr.test" });

      const bruno = await signIn("bruno@qadr.test");
      await expect(getInvitationForUser(commercial, invited.id, "bruno@qadr.test")).rejects.toMatchObject({ status: 404 });
      await expect(acceptInvitation(auth, bruno, invited.id)).rejects.toThrow();

      const chantal = await signUp("Chantal", "chantal@qadr.test");
      await expect(getInvitationForUser(commercial, invited.id, "chantal@qadr.test")).resolves.toMatchObject({ businessName: "Quincaillerie du Plateau", role: "cashier", state: "pending" });
      // Adresse non confirmée : Better Auth refuse, le service le dit clairement.
      await expect(acceptInvitation(auth, chantal, invited.id)).rejects.toMatchObject({ status: 403, message: expect.stringContaining("Confirmez") });
      await verifyEmail(chantal, "chantal@qadr.test");
      await expect(acceptInvitation(auth, chantal, invited.id)).resolves.toEqual({ businessId: ids.a1 });
      expect(await assertActiveMembership(commercial, ids.a1!, await userId(chantal))).toBe("cashier");
      expect((await auth.api.getSession({ headers: chantal }))?.session.activeOrganizationId).toBe(ids.a1);
      await expect(inviteMember(auth, commercial, awa, context, { email: "chantal@qadr.test", role: "cashier" })).rejects.toMatchObject({ status: 409 });
    });

    it("refuse une invitation expirée ou annulée", async () => {
      const awa = await signIn("awa@qadr.test");
      const context = { businessId: ids.a1!, actorUserId: await userId(awa) };
      const expired = await inviteMember(auth, commercial, awa, context, { email: "daouda@qadr.test", role: "stock_manager" });
      await client.query("update invitation set expires_at = now() - interval '1 hour' where id=$1", [expired.id]);
      const daouda = await signUp("Daouda", "daouda@qadr.test");
      await expect(getInvitationForUser(commercial, expired.id, "daouda@qadr.test")).resolves.toMatchObject({ state: "expired" });
      await expect(acceptInvitation(auth, daouda, expired.id)).rejects.toThrow();
      const canceled = await inviteMember(auth, commercial, awa, context, { email: "daouda@qadr.test", role: "stock_manager" });
      await cancelInvitation(auth, commercial, awa, context, canceled.id);
      await expect(acceptInvitation(auth, daouda, canceled.id)).rejects.toThrow();
    });

    it("applique les règles de rôles : pas d’auto-modification, owner réservé au propriétaire, équipe réservée aux gérants", async () => {
      const awa = await signIn("awa@qadr.test");
      const context = { businessId: ids.a1!, actorUserId: await userId(awa) };
      const team = await listTeam(commercial, context);
      const chantal = team.members.find((row) => row.email === "chantal@qadr.test")!;
      const self = team.members.find((row) => row.self)!;
      await expect(changeMemberRole(auth, commercial, awa, context, self.memberId, { role: "admin" })).rejects.toMatchObject({ status: 403 });
      await expect(changeMemberRole(auth, commercial, awa, context, chantal.memberId, { role: "admin" })).resolves.toEqual({ memberId: chantal.memberId, role: "admin" });

      const chantalHeaders = await signIn("chantal@qadr.test");
      const asAdmin = { businessId: ids.a1!, actorUserId: await userId(chantalHeaders) };
      await expect(inviteMember(auth, commercial, chantalHeaders, asAdmin, { email: "eric@qadr.test", role: "owner" })).rejects.toMatchObject({ status: 403 });
      await expect(changeMemberRole(auth, commercial, chantalHeaders, asAdmin, self.memberId, { role: "cashier" })).rejects.toMatchObject({ status: 403 });
      await changeMemberRole(auth, commercial, awa, context, chantal.memberId, { role: "cashier" });
      await expect(listTeam(commercial, asAdmin)).rejects.toMatchObject({ status: 403 });
      // Un gérant d'un autre commerce ne voit ni ne modifie rien ici.
      const bruno = await signIn("bruno@qadr.test");
      await expect(listTeam(commercial, { businessId: ids.a1!, actorUserId: await userId(bruno) })).rejects.toMatchObject({ status: 403 });
      await expect(changeMemberRole(auth, commercial, bruno, { businessId: ids.b1!, actorUserId: await userId(bruno) }, chantal.memberId, { role: "admin" })).rejects.toMatchObject({ status: 404 });
    });

    it("désactive un accès sans supprimer l’historique, coupe le commerce actif puis le réactive", async () => {
      const awa = await signIn("awa@qadr.test");
      const context = { businessId: ids.a1!, actorUserId: await userId(awa) };
      const chantal = (await listTeam(commercial, context)).members.find((row) => row.email === "chantal@qadr.test")!;
      const chantalHeaders = await signIn("chantal@qadr.test");
      await setActiveBusiness(auth, commercial, chantalHeaders, chantal.userId, { businessId: ids.a1 });

      await expect(setMemberAccess(commercial, context, chantal.memberId, { disabled: true })).resolves.toEqual({ memberId: chantal.memberId, disabled: true });
      await expect(assertActiveMembership(commercial, ids.a1!, chantal.userId)).rejects.toThrow(/désactivé/);
      expect((await auth.api.getSession({ headers: chantalHeaders }))?.session.activeOrganizationId ?? null).toBeNull();
      await expect(setActiveBusiness(auth, commercial, chantalHeaders, chantal.userId, { businessId: ids.a1 })).rejects.toMatchObject({ status: 403 });
      const stillMember = await client.query<{ n: string }>("select count(*)::text n from member where organization_id=$1 and user_id=$2", [ids.a1, chantal.userId]);
      expect(stillMember.rows[0]!.n).toBe("1");
      expect((await getAccountOverview(commercial, chantal.userId, null)).businesses.find((row) => row.id === ids.a1)?.disabled).toBe(true);

      await setMemberAccess(commercial, context, chantal.memberId, { disabled: false });
      expect(await assertActiveMembership(commercial, ids.a1!, chantal.userId)).toBe("cashier");
      const audit = await client.query<{ event_type: string }>("select event_type from audit_event where business_id=$1 and event_type like 'team.access_%' order by occurred_at", [ids.a1]);
      expect(audit.rows.map((row) => row.event_type)).toEqual(["team.access_disabled", "team.access_enabled"]);
    });
  });

  describe("mot de passe oublié", () => {
    it("répond pareil qu’un compte existe ou non, et n’envoie un lien qu’au vrai compte", async () => {
      const before = outbox.length;
      const unknown = await auth.api.requestPasswordReset({ body: { email: "personne@qadr.test", redirectTo: "/reset-password" } });
      expect(outbox.length).toBe(before);
      const known = await auth.api.requestPasswordReset({ body: { email: "bruno@qadr.test", redirectTo: "/reset-password" } });
      expect(known).toEqual(unknown);
      const message = outbox.at(-1)!;
      expect(message).toMatchObject({ kind: "password_reset", to: "bruno@qadr.test" });

      const oldSession = await signIn("bruno@qadr.test");
      const token = new URL(message.actionUrl).pathname.split("/").at(-1)!;
      await auth.api.resetPassword({ body: { newPassword: "nouveau-mot-de-passe-1", token } });
      expect(await auth.api.getSession({ headers: oldSession })).toBeNull();
      await expect(signIn("bruno@qadr.test")).rejects.toThrow();
      await expect(signIn("bruno@qadr.test", "nouveau-mot-de-passe-1")).resolves.toBeInstanceOf(Headers);
      await expect(auth.api.resetPassword({ body: { newPassword: "encore-un-autre-1", token } })).rejects.toThrow();
    });
  });
});

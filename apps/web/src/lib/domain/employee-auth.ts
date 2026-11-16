import { and, eq } from "drizzle-orm";
import type { QadrAuth } from "@/lib/auth/server";
import { session as sessionTable } from "@/lib/db/schema";
import type { CommercialDatabase } from "./commercial";
import { isPlatformOwnerUsername, usernameSchema } from "./team-codes";

/**
 * Connexion par nom d'utilisateur des comptes de commerce (employés invités par code, 2026-11-16).
 *
 * La route HTTP `/sign-in/username` de Better Auth reste fermée (server.ts) : elle ignorerait nos limites et
 * notre refus du compte de la plateforme. Cette fonction appelle `signInUsername` côté serveur, sans `request`,
 * après avoir écarté le propriétaire de la plateforme (même réponse qu'un mauvais mot de passe) et rend les
 * en-têtes `set-cookie` de la session ordinaire à transmettre au navigateur.
 */
export type EmployeeSignIn = { ok: true; userId: string; setCookies: string[] } | { ok: false };

export async function signInByUsername(auth: QadrAuth, db: CommercialDatabase, raw: { username: unknown; password: unknown }, activeBusinessId?: string): Promise<EmployeeSignIn> {
  const username = usernameSchema.safeParse(raw.username);
  if (!username.success || typeof raw.password !== "string" || raw.password.length < 1 || raw.password.length > 128) return { ok: false };
  if (await isPlatformOwnerUsername(db, username.data)) return { ok: false };
  type Signed = { headers: Headers; response: { twoFactorRedirect?: boolean; token?: string; user?: { id: string } } };
  let signed: Signed;
  try {
    signed = await auth.api.signInUsername({ body: { username: username.data, password: raw.password, rememberMe: true }, headers: new Headers(), returnHeaders: true }) as Signed;
  } catch {
    return { ok: false };
  }
  const token = signed.response.token;
  const userId = signed.response.user?.id;
  // Un compte de commerce n'a pas de second facteur ; s'il en avait un, cette voie ne l'ouvre pas.
  if (signed.response.twoFactorRedirect || !token || !userId) {
    if (token) await db.delete(sessionTable).where(eq(sessionTable.token, token));
    return { ok: false };
  }
  if (activeBusinessId) {
    await db.update(sessionTable).set({ activeOrganizationId: activeBusinessId }).where(and(eq(sessionTable.token, token), eq(sessionTable.userId, userId)));
  }
  return { ok: true, userId, setCookies: signed.headers.getSetCookie() };
}

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { createDatabase } from "@/lib/db/client";
import { authSchema } from "@/lib/db/schema";
import { readEnvironment } from "@/lib/env";
import { verifyTurnstile } from "./turnstile";
import { businessAccess, businessRoles } from "./permissions";
import { organization } from "better-auth/plugins";

const protectedAuthPaths = new Set(["/sign-up/email", "/sign-in/email"]);
function createAuth() {
  const env = readEnvironment();
  if (!env.DATABASE_URL || !env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) {
    throw new Error("Better Auth nécessite DATABASE_URL et un BETTER_AUTH_SECRET d’au moins 32 caractères.");
  }

  return betterAuth({
    appName: "QADR OPS",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.BETTER_AUTH_URL],
    database: drizzleAdapter(createDatabase(env.DATABASE_URL), {
      provider: "pg",
      schema: authSchema,
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    plugins: [organization({
      ac: businessAccess,
      roles: businessRoles,
      creatorRole: "owner",
      allowUserToCreateOrganization: true,
      disableOrganizationDeletion: true,
      teams: { enabled: false },
    })],
    advanced: {
      useSecureCookies: env.NODE_ENV === "production",
    },
    hooks: {
      before: createAuthMiddleware(async (context) => {
        if (!protectedAuthPaths.has(context.path)) return;
        const result = await verifyTurnstile(context.body?.turnstileToken, {
          secret: env.TURNSTILE_SECRET_KEY,
          siteKey: env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
          isProduction: env.NODE_ENV === "production",
        });
        if (!result.ok) {
          throw new APIError("BAD_REQUEST", { message: "Security verification failed." });
        }
      }),
    },
  });
}

let authInstance: ReturnType<typeof createAuth> | undefined;

export function getAuth(): ReturnType<typeof createAuth> {
  if (!authInstance) authInstance = createAuth();
  return authInstance;
}

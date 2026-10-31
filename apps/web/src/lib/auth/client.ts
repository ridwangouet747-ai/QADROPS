import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";
import { businessAccess, businessRoles } from "./permissions";

export const authClient = createAuthClient({
  // Sans valeur, le client appelle l'origine courante (utile en prévisualisation sur un autre port).
  baseURL: process.env.NEXT_PUBLIC_AUTH_URL || undefined,
  plugins: [organizationClient({ ac: businessAccess, roles: businessRoles })],
});

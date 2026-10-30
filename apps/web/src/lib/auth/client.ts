import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";
import { businessAccess, businessRoles } from "./permissions";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:3000",
  plugins: [organizationClient({ ac: businessAccess, roles: businessRoles })],
});

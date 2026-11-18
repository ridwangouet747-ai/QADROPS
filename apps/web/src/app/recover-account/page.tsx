import { Suspense } from "react";
import { RecoverAccountForm } from "@/components/auth/auth-forms";
import { localizedPageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => localizedPageMetadata("meta.recoverAccount");

/** Mot de passe oublié d'un compte sans e-mail : code de secours (docs/authentication.md § 12). */
export default function Page() {
  return <Suspense><RecoverAccountForm /></Suspense>;
}

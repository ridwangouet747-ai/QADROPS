import { Suspense } from "react";
import { ForgotPasswordForm } from "@/components/auth/auth-forms";

export const metadata = { title: "Mot de passe oublié · QADR OPS", robots: { index: false } };

export default function Page() {
  return <Suspense><ForgotPasswordForm /></Suspense>;
}

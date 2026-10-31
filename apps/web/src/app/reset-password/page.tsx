import { Suspense } from "react";
import { ResetPasswordForm } from "@/components/auth/auth-forms";

export const metadata = { title: "Nouveau mot de passe · QADR OPS", robots: { index: false } };

export default function Page() {
  return <Suspense><ResetPasswordForm /></Suspense>;
}

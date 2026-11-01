import { localizedPageMetadata } from "@/lib/i18n/server";
import { Suspense } from "react";
import { ForgotPasswordForm } from "@/components/auth/auth-forms";

export const generateMetadata = () => localizedPageMetadata("meta.forgotPassword");

export default function Page() {
  return <Suspense><ForgotPasswordForm /></Suspense>;
}

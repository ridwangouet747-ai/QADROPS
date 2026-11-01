import { localizedPageMetadata } from "@/lib/i18n/server";
import { Suspense } from "react";
import { ResetPasswordForm } from "@/components/auth/auth-forms";

export const generateMetadata = () => localizedPageMetadata("meta.resetPassword");

export default function Page() {
  return <Suspense><ResetPasswordForm /></Suspense>;
}

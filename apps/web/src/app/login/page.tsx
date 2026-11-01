import { localizedPageMetadata } from "@/lib/i18n/server";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/auth-forms";

export const generateMetadata = () => localizedPageMetadata("meta.login");

export default function Page() {
  return <Suspense><LoginForm /></Suspense>;
}

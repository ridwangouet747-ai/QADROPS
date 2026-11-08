import { Suspense } from "react";
import { localizedPageMetadata } from "@/lib/i18n/server";
import { PlatformLoginForm } from "@/components/platform/platform-login";

export const dynamic = "force-dynamic";
export const generateMetadata = () => localizedPageMetadata("meta.platform");

/** Page publique, sans donnée : la console elle-même reste protégée côté serveur (`getPlatformContext`). */
export default function PlatformLoginPage() {
  return <Suspense><PlatformLoginForm /></Suspense>;
}

import { localizedPageMetadata } from "@/lib/i18n/server";
import { Suspense } from "react";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";

export const generateMetadata = () => localizedPageMetadata("meta.onboarding");

/** Parcours en cinq étapes (mission 08) ; les anciens formulaires restent disponibles dans components/auth. */
export default function Page() {
  return <Suspense><OnboardingWizard entry="onboarding" /></Suspense>;
}

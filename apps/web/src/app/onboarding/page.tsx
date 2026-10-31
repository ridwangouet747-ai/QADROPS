import { Suspense } from "react";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";

export const metadata = { title: "Créer un commerce · QADR OPS", robots: { index: false } };

/** Parcours en cinq étapes (mission 08) ; les anciens formulaires restent disponibles dans components/auth. */
export default function Page() {
  return <Suspense><OnboardingWizard entry="onboarding" /></Suspense>;
}

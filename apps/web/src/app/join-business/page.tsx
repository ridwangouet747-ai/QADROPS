import { localizedPageMetadata } from "@/lib/i18n/server";
import { JoinBusinessForm } from "@/components/commercial/join-business-form";

export const generateMetadata = () => localizedPageMetadata("meta.join");

/** Un employé rejoint un commerce avec un code d'invitation EQP-… (2026-11-16) : page publique. */
export default function Page() {
  return <JoinBusinessForm />;
}

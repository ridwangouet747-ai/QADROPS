import { localizedPageMetadata } from "@/lib/i18n/server";
import { RedeemCodeForm } from "@/components/commercial/redeem-code-form";

export const generateMetadata = () => localizedPageMetadata("meta.redeem");

/** « Vous avez un code Qadr Agency ? » (2026-11-16) : page publique, sans session obligatoire. */
export default function Page() {
  return <RedeemCodeForm />;
}

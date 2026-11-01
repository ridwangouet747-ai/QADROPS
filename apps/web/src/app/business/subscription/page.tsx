import { BusinessShell } from "@/components/business/business-shell";
import { SubscriptionWorkspace } from "@/components/business/subscription-workspace";
import { localizedPageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => localizedPageMetadata("meta.subscription");

export default function SubscriptionPage() {
  const preview = process.env.NODE_ENV === "development" && process.env.QADR_PREVIEW_MODE === "true";
  return <BusinessShell active="subscription" preview={preview}><SubscriptionWorkspace /></BusinessShell>;
}

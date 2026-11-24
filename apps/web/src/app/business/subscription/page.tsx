import { SubscriptionWorkspace } from "@/components/business/subscription-workspace";
import { localizedPageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => localizedPageMetadata("meta.subscription");

export default function SubscriptionPage() {
  return <SubscriptionWorkspace />;
}

import { SubscriptionPaymentReturn } from "@/components/business/subscription-payment";
import { localizedPageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => localizedPageMetadata("meta.subscription");

/**
 * Retour de GeniusPay (`success_url` comme `error_url`). Le paramètre `result` est ignoré : seul l'état vérifié
 * par le serveur auprès de GeniusPay est affiché (« paiement en cours de vérification » tant qu'il n'est pas final).
 */
export default async function SubscriptionPaymentReturnPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { attempt } = await searchParams;
  const attemptId = typeof attempt === "string" && /^[0-9a-f-]{36}$/i.test(attempt) ? attempt : null;
  return <SubscriptionPaymentReturn attemptId={attemptId} />;
}

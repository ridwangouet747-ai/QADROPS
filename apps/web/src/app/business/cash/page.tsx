import { CashWorkspace } from "@/components/business/cash-workspace";
import { localizedPageMetadata } from "@/lib/i18n/server";
import { requireBusinessPageAccess } from "@/lib/domain/business-page-access";

export const generateMetadata = () => localizedPageMetadata("meta.cash");

export default async function CashPage() {
  await requireBusinessPageAccess();
  return <CashWorkspace />;
}

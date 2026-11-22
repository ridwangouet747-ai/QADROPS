import { BusinessShell } from "@/components/business/business-shell";
import { CashWorkspace } from "@/components/business/cash-workspace";
import { localizedPageMetadata } from "@/lib/i18n/server";
import { requireBusinessPageAccess } from "@/lib/domain/business-page-access";

export const generateMetadata = () => localizedPageMetadata("meta.cash");

export default async function CashPage() {
  const initialRole = await requireBusinessPageAccess();
  const preview = process.env.NODE_ENV === "development" && process.env.QADR_PREVIEW_MODE === "true";
  return <BusinessShell initialRole={initialRole} active="cash" preview={preview}><CashWorkspace /></BusinessShell>;
}

import { BusinessShell } from "@/components/business/business-shell";
import { CashWorkspace } from "@/components/business/cash-workspace";
import { localizedPageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => localizedPageMetadata("meta.cash");

export default function CashPage() {
  const preview = process.env.NODE_ENV === "development" && process.env.QADR_PREVIEW_MODE === "true";
  return <BusinessShell active="cash" preview={preview}><CashWorkspace /></BusinessShell>;
}

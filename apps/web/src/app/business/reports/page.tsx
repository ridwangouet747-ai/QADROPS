import { ReportsWorkspace } from "@/components/business/reports-workspace";
import { BusinessShell } from "@/components/business/business-shell";
import { localizedPageMetadata } from "@/lib/i18n/server";
import { requireBusinessPageAccess } from "@/lib/domain/business-page-access";

export const generateMetadata = () => localizedPageMetadata("meta.reports");

export default async function ReportsPage() {
  await requireBusinessPageAccess();
  const preview = process.env.NODE_ENV === "development" && process.env.QADR_PREVIEW_MODE === "true";
  return <BusinessShell active="reports" preview={preview}><ReportsWorkspace /></BusinessShell>;
}

import { ReportsWorkspace } from "@/components/business/reports-workspace";
import { BusinessShell } from "@/components/business/business-shell";
import { localizedPageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => localizedPageMetadata("meta.reports");

export default function ReportsPage() {
  const preview = process.env.NODE_ENV === "development" && process.env.QADR_PREVIEW_MODE === "true";
  return <BusinessShell active="reports" preview={preview}><ReportsWorkspace /></BusinessShell>;
}

import { BusinessShell } from "@/components/business/business-shell";
import { PrintingWorkspace } from "@/components/printing/printing-workspace";
import { localizedPageMetadata } from "@/lib/i18n/server";
import { requireBusinessPageAccess } from "@/lib/domain/business-page-access";

export const generateMetadata = () => localizedPageMetadata("meta.printing");

export default async function PrintingPage() {
  const initialRole = await requireBusinessPageAccess();
  const preview = process.env.NODE_ENV === "development" && process.env.QADR_PREVIEW_MODE === "true";
  return <BusinessShell initialRole={initialRole} active="printing" preview={preview}><PrintingWorkspace /></BusinessShell>;
}

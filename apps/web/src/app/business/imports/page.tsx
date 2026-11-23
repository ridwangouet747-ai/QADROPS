import { BusinessShell } from "@/components/business/business-shell";
import { ImportsWorkspace } from "@/components/business/imports-workspace";
import { localizedPageMetadata } from "@/lib/i18n/server";
import { requireBusinessPageAccess } from "@/lib/domain/business-page-access";

export const generateMetadata = () => localizedPageMetadata("meta.imports");

export default async function ImportsPage() {
  const initialRole = await requireBusinessPageAccess();
  const preview = process.env.NODE_ENV === "development" && process.env.QADR_PREVIEW_MODE === "true";
  return <BusinessShell initialRole={initialRole} active="imports" preview={preview}><ImportsWorkspace /></BusinessShell>;
}

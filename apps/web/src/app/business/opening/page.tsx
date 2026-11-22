import { BusinessShell } from "@/components/business/business-shell";
import { OpeningWorkspace } from "@/components/business/opening-workspace";
import { localizedPageMetadata } from "@/lib/i18n/server";
import { requireBusinessPageAccess } from "@/lib/domain/business-page-access";

export const generateMetadata = () => localizedPageMetadata("meta.opening");

export default async function OpeningPage() {
  const initialRole = await requireBusinessPageAccess();
  const preview = process.env.NODE_ENV === "development" && process.env.QADR_PREVIEW_MODE === "true";
  return <BusinessShell initialRole={initialRole} active="opening" preview={preview}><OpeningWorkspace /></BusinessShell>;
}

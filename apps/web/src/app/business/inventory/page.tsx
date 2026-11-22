import { InventoryWorkspace } from "@/components/business/inventory-workspace";
import { BusinessShell } from "@/components/business/business-shell";
import { localizedPageMetadata } from "@/lib/i18n/server";
import { requireBusinessPageAccess } from "@/lib/domain/business-page-access";

export const generateMetadata = () => localizedPageMetadata("meta.inventory");

export default async function InventoryPage() {
  const initialRole = await requireBusinessPageAccess();
  const preview = process.env.NODE_ENV === "development" && process.env.QADR_PREVIEW_MODE === "true";
  return <BusinessShell initialRole={initialRole} active="inventory" preview={preview}><InventoryWorkspace /></BusinessShell>;
}

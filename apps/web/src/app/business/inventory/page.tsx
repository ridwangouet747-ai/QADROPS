import { InventoryWorkspace } from "@/components/business/inventory-workspace";
import { BusinessShell } from "@/components/business/business-shell";
import { localizedPageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => localizedPageMetadata("meta.inventory");

export default function InventoryPage() {
  const preview = process.env.NODE_ENV === "development" && process.env.QADR_PREVIEW_MODE === "true";
  return <BusinessShell active="inventory" preview={preview}><InventoryWorkspace /></BusinessShell>;
}

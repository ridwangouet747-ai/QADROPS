import { InventoryWorkspace } from "@/components/business/inventory-workspace";
import { localizedPageMetadata } from "@/lib/i18n/server";
import { requireBusinessPageAccess } from "@/lib/domain/business-page-access";

export const generateMetadata = () => localizedPageMetadata("meta.inventory");

export default async function InventoryPage() {
  await requireBusinessPageAccess();
  return <InventoryWorkspace />;
}

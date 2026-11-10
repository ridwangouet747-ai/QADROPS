import { BusinessShell } from "@/components/business/business-shell";
import { SaleDetailWorkspace } from "@/components/business/sale-detail-workspace";
import { localizedPageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => localizedPageMetadata("meta.sale");

export default async function SaleDetailPage({ params }: { params: Promise<{ saleId: string }> }) {
  const { saleId } = await params;
  const preview = process.env.NODE_ENV === "development" && process.env.QADR_PREVIEW_MODE === "true";
  return <BusinessShell active="sales" preview={preview}><SaleDetailWorkspace saleId={saleId} /></BusinessShell>;
}

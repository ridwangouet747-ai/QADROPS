import { SaleDetailWorkspace } from "@/components/business/sale-detail-workspace";
import { localizedPageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => localizedPageMetadata("meta.sale");

export default async function SaleDetailPage({ params }: { params: Promise<{ saleId: string }> }) {
  const { saleId } = await params;
  return <SaleDetailWorkspace saleId={saleId} />;
}

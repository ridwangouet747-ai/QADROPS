import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ThermalReceipt } from "@/components/receipts/thermal-receipt";
import { getBusinessContext } from "@/lib/domain/business-context";
import { CommercialError } from "@/lib/domain/commercial";
import { getSaleReceipt } from "@/lib/domain/receipt";

export const runtime = "nodejs";

export default async function SaleReceiptPage({ params }: { params: Promise<{ saleId: string }> }) {
  const [{ saleId }, requestHeaders] = await Promise.all([params, headers()]);
  try {
    const context = await getBusinessContext(requestHeaders);
    const receipt = await getSaleReceipt(context.db, { businessId: context.businessId, actorUserId: context.userId, saleId });
    return <ThermalReceipt data={receipt} />;
  } catch (error) {
    if (error instanceof CommercialError && error.status === 404) notFound();
    const message = error instanceof Error ? error.message : "Le reçu ne peut pas être affiché.";
    return <main className="receipt-page"><p role="alert">{message}</p></main>;
  }
}

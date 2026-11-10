import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ThermalReceipt } from "@/components/receipts/thermal-receipt";
import { getBusinessContext } from "@/lib/domain/business-context";
import { CommercialError } from "@/lib/domain/commercial";
import { getSaleReceiptDocument } from "@/lib/domain/receipt";
import { getRequestLocale, localizedPageMetadata } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import { isReceiptLanguage } from "@/lib/printing/receipt-document";

export const runtime = "nodejs";
export const generateMetadata = () => localizedPageMetadata("meta.receipt");

/**
 * Ticket à l'écran : le commerce vient de la session, la vente doit lui appartenir. La langue du ticket
 * suit celle de l'interface, sauf choix explicite (`?lang=fr|en|ar`) : on peut remettre un ticket en
 * arabe à un client en gardant l'interface en français. Les erreurs sont traduites (I-9).
 */
export default async function SaleReceiptPage({ params, searchParams }: { params: Promise<{ saleId: string }>; searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const [{ saleId }, query, requestHeaders, locale] = await Promise.all([params, searchParams, headers(), getRequestLocale()]);
  const language = isReceiptLanguage(query.lang) ? query.lang : locale;
  try {
    const context = await getBusinessContext(requestHeaders);
    const document = await getSaleReceiptDocument(context.db, { businessId: context.businessId, actorUserId: context.userId, saleId, language });
    return <ThermalReceipt document={document} />;
  } catch (error) {
    if (error instanceof CommercialError && error.status === 404) notFound();
    const t = createTranslator(locale);
    // CommercialError ou BusinessContextError : seul le statut compte, le message brut n'est jamais affiché.
    const forbidden = error instanceof Error && "status" in error && error.status === 403;
    return <main className="receipt-page"><p role="alert">{t(forbidden ? "printing.screen.errors.forbidden" : "printing.screen.errors.generic")}</p></main>;
  }
}

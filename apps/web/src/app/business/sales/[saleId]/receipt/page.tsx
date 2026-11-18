import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ThermalReceipt } from "@/components/receipts/thermal-receipt";
import { getBusinessContext } from "@/lib/domain/business-context";
import { CommercialError } from "@/lib/domain/commercial";
import { getSaleReceiptPage } from "@/lib/domain/receipt";
import { getRequestLocale, localizedPageMetadata } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import { isReceiptLanguage } from "@/lib/printing/receipt-document";
import { receiptOrigin, receiptReturnPath } from "@/lib/printing/receipt-return";

export const runtime = "nodejs";
export const generateMetadata = () => localizedPageMetadata("meta.receipt");

/**
 * Ticket à l'écran : le commerce vient de la session, la vente doit lui appartenir. La langue du ticket
 * suit celle de l'interface, sauf choix explicite (`?lang=fr|en|ar`) : on peut remettre un ticket en
 * arabe à un client en gardant l'interface en français. Les erreurs sont traduites (I-9). Le logo du commerce ramène à
 * l'écran d'origine (`?from=`, liste fermée, caisse par défaut : lib/printing/receipt-return.ts).
 */
export default async function SaleReceiptPage({ params, searchParams }: { params: Promise<{ saleId: string }>; searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const [{ saleId }, query, requestHeaders, locale] = await Promise.all([params, searchParams, headers(), getRequestLocale()]);
  const language = isReceiptLanguage(query.lang) ? query.lang : locale;
  const origin = receiptOrigin(query.from);
  try {
    const context = await getBusinessContext(requestHeaders);
    const { document, identity } = await getSaleReceiptPage(context.db, { businessId: context.businessId, actorUserId: context.userId, saleId, language });
    return <ThermalReceipt document={document} identity={identity} back={{ origin, href: receiptReturnPath(origin, saleId) }} />;
  } catch (error) {
    if (error instanceof CommercialError && error.status === 404) notFound();
    const t = createTranslator(locale);
    // CommercialError ou BusinessContextError : seul le statut compte, le message brut n'est jamais affiché.
    const forbidden = error instanceof Error && "status" in error && error.status === 403;
    return (
      <main className="receipt-page">
        <p role="alert">{t(forbidden ? "printing.screen.errors.forbidden" : "printing.screen.errors.generic")}</p>
        <a href={receiptReturnPath(origin, saleId)} className="inline-flex min-h-11 items-center font-semibold text-brand-strong">{t(`printing.screen.back.${origin}`)}</a>
      </main>
    );
  }
}

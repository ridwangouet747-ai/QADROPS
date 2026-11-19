import { and, eq } from "drizzle-orm";
import { hasBusinessPermission } from "../auth/permissions";
import type { CommercialDatabase } from "./commercial";
import { CommercialError } from "./commercial";
import { businessProfile, member, organization, payment, receiptSettings, sale, saleLine, user } from "../db/schema";
import { buildReceiptDocument, type ReceiptLanguage } from "../printing/receipt-document";

/**
 * Données d'une vente pour son ticket : le commerce vient toujours de la session (jamais de la requête),
 * et la vente doit appartenir à ce commerce. Les erreurs portent un code stable que l'interface traduit (I-9).
 */
export async function getSaleReceipt(db: CommercialDatabase, input: { businessId: string; actorUserId: string; saleId: string }) {
  const [membership] = await db.select({ role: member.role }).from(member).where(and(
    eq(member.organizationId, input.businessId), eq(member.userId, input.actorUserId),
  )).limit(1);
  if (!membership || !hasBusinessPermission(membership.role, "sale", "read")) {
    throw new CommercialError("Permission de lecture de vente refusée.", 403, "forbidden");
  }
  const [saleRecord] = await db.select({
    id: sale.id, reference: sale.reference, status: sale.status, totalXof: sale.totalXof, occurredAt: sale.occurredAt,
    subtotalXof: sale.subtotalXof, discountXof: sale.discountXof, cashierName: user.name,
  }).from(sale).leftJoin(user, eq(user.id, sale.cashierUserId)).where(and(
    eq(sale.businessId, input.businessId), eq(sale.id, input.saleId),
  )).limit(1);
  if (!saleRecord) throw new CommercialError("Vente introuvable.", 404, "not_found");

  const [identity] = await db.select({
    name: organization.name, logo: organization.logo, phone: businessProfile.phone,
    address: businessProfile.address, email: businessProfile.businessEmail,
    currency: businessProfile.currency, paperWidthMm: receiptSettings.paperWidthMm,
    showLogo: receiptSettings.showLogo, footer: receiptSettings.footer,
    displayName: receiptSettings.displayName, timezone: businessProfile.timezone,
  }).from(businessProfile).innerJoin(organization, eq(organization.id, businessProfile.businessId))
    .leftJoin(receiptSettings, eq(receiptSettings.businessId, businessProfile.businessId))
    .where(eq(businessProfile.businessId, input.businessId)).limit(1);
  if (!identity) throw new CommercialError("Configuration du commerce introuvable.", 404, "not_found");

  const lines = await db.select({
    name: saleLine.productNameSnapshot, variant: saleLine.variantSnapshot,
    quantity: saleLine.quantity, unitPriceXof: saleLine.unitPriceXof, totalXof: saleLine.lineTotalXof, lineDiscountXof: saleLine.lineDiscountXof,
  }).from(saleLine).where(and(eq(saleLine.businessId, input.businessId), eq(saleLine.saleId, input.saleId)));
  const payments = await db.select({ method: payment.method, amountXof: payment.amountXof, status: payment.status, tenderedXof: payment.tenderedXof, changeXof: payment.changeXof, reference: payment.providerReference })
    .from(payment).where(and(eq(payment.businessId, input.businessId), eq(payment.saleId, input.saleId)));

  return { business: identity, sale: saleRecord, lines, payments };
}

/** Ticket unique (I-5) d'une vente de ce commerce, dans la langue demandée : écran et imprimante l'affichent tel quel. */
export async function getSaleReceiptDocument(db: CommercialDatabase, input: { businessId: string; actorUserId: string; saleId: string; language: ReceiptLanguage }) {
  return buildReceiptDocument(await getSaleReceipt(db, input), { language: input.language });
}

/**
 * Page du reçu : le ticket, plus l'identité du commerce pour l'en-tête de retour (logo du commerce même si le ticket
 * est réglé sans logo, et nom du commerce plutôt que le nom d'affichage du ticket).
 */
export async function getSaleReceiptPage(db: CommercialDatabase, input: { businessId: string; actorUserId: string; saleId: string; language: ReceiptLanguage }) {
  const source = await getSaleReceipt(db, input);
  return { document: buildReceiptDocument(source, { language: input.language }), identity: { name: source.business.name, logo: source.business.logo ?? null } };
}

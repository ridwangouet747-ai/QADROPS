import { and, eq } from "drizzle-orm";
import { hasBusinessPermission } from "../auth/permissions";
import type { CommercialDatabase } from "./commercial";
import { CommercialError } from "./commercial";
import { businessProfile, member, organization, payment, receiptSettings, sale, saleLine } from "../db/schema";

export async function getSaleReceipt(db: CommercialDatabase, input: { businessId: string; actorUserId: string; saleId: string }) {
  const [membership] = await db.select({ role: member.role }).from(member).where(and(
    eq(member.organizationId, input.businessId), eq(member.userId, input.actorUserId),
  )).limit(1);
  if (!membership || !hasBusinessPermission(membership.role, "sale", "read")) {
    throw new CommercialError("Permission de lecture de vente refusée.", 403);
  }
  const [saleRecord] = await db.select({
    id: sale.id, reference: sale.reference, totalXof: sale.totalXof, occurredAt: sale.occurredAt,
  }).from(sale).where(and(
    eq(sale.businessId, input.businessId), eq(sale.id, input.saleId),
  )).limit(1);
  if (!saleRecord) throw new CommercialError("Vente introuvable.", 404);

  const [identity] = await db.select({
    name: organization.name, logo: organization.logo, phone: businessProfile.phone,
    address: businessProfile.address, email: businessProfile.businessEmail,
    currency: businessProfile.currency, paperWidthMm: receiptSettings.paperWidthMm,
    showLogo: receiptSettings.showLogo, footer: receiptSettings.footer,
  }).from(businessProfile).innerJoin(organization, eq(organization.id, businessProfile.businessId))
    .leftJoin(receiptSettings, eq(receiptSettings.businessId, businessProfile.businessId))
    .where(eq(businessProfile.businessId, input.businessId)).limit(1);
  if (!identity) throw new CommercialError("Configuration du commerce introuvable.", 404);

  const lines = await db.select({
    name: saleLine.productNameSnapshot, variant: saleLine.variantSnapshot,
    quantity: saleLine.quantity, unitPriceXof: saleLine.unitPriceXof, totalXof: saleLine.lineTotalXof,
  }).from(saleLine).where(and(eq(saleLine.businessId, input.businessId), eq(saleLine.saleId, input.saleId)));
  const payments = await db.select({ method: payment.method, amountXof: payment.amountXof, status: payment.status })
    .from(payment).where(and(eq(payment.businessId, input.businessId), eq(payment.saleId, input.saleId)));

  return { business: identity, sale: saleRecord, lines, payments };
}

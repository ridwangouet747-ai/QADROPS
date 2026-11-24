import { notFound } from "next/navigation";
import type { BusinessArea } from "@/components/business/business-shell";
import { BusinessSuiteWorkspace } from "@/components/business/business-suite-workspace";
import { DashboardWorkspace } from "@/components/business/dashboard-workspace";
import { PosWorkspace } from "@/components/business/pos-workspace";
import { ProductsWorkspace } from "@/components/business/products-workspace";
import { StockWorkspace } from "@/components/business/stock-workspace";
import { localizedPageMetadata } from "@/lib/i18n/server";
import { requireBusinessPageAccess } from "@/lib/domain/business-page-access";

type BusinessRouteSection = Exclude<BusinessArea, "inventory" | "reports">;
const sections = new Set<BusinessRouteSection>(["dashboard", "pos", "products", "sales", "customers", "stock", "suppliers", "purchases", "expenses", "settings", "modules"]);

/** Titre d’onglet propre à chaque section (mission 16 : ces écrans gardaient le titre de la page d’accueil). */
export async function generateMetadata({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!sections.has(section as BusinessRouteSection)) return {};
  return localizedPageMetadata(`meta.${section as BusinessRouteSection}`);
}

/** L'en-tête vient de app/business/layout.tsx (monté une fois) ; la page n'affiche que son module. */
export default async function BusinessSectionPage({ params }: { params: Promise<{ section: string }> }) {
  await requireBusinessPageAccess();
  const { section } = await params;
  if (!sections.has(section as BusinessRouteSection)) notFound();
  const area = section as BusinessRouteSection;
  if (area === "dashboard") return <DashboardWorkspace />;
  if (area === "products") return <ProductsWorkspace />;
  if (area === "stock") return <StockWorkspace />;
  if (area === "pos") return <PosWorkspace />;
  return <BusinessSuiteWorkspace key={area} section={area} />;
}

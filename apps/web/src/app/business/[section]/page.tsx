import { notFound } from "next/navigation";
import { BusinessShell, type BusinessArea } from "@/components/business/business-shell";
import { BusinessSuiteWorkspace } from "@/components/business/business-suite-workspace";
import { PosWorkspace } from "@/components/business/pos-workspace";

type BusinessRouteSection = Exclude<BusinessArea, "inventory" | "reports">;
const sections = new Set<BusinessRouteSection>(["dashboard", "pos", "products", "sales", "customers", "stock", "suppliers", "purchases", "expenses", "settings", "modules"]);

export default async function BusinessSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!sections.has(section as BusinessRouteSection)) notFound();
  const area = section as BusinessRouteSection;
  const preview = process.env.NODE_ENV === "development" && process.env.QADR_PREVIEW_MODE === "true";
  if (area === "pos") return <BusinessShell active={area} preview={preview}><PosWorkspace /></BusinessShell>;
  return <BusinessShell active={area} preview={preview}><BusinessSuiteWorkspace section={area} /></BusinessShell>;
}

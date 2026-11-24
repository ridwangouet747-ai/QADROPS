import { ReportsWorkspace } from "@/components/business/reports-workspace";
import { localizedPageMetadata } from "@/lib/i18n/server";
import { requireBusinessPageAccess } from "@/lib/domain/business-page-access";

export const generateMetadata = () => localizedPageMetadata("meta.reports");

export default async function ReportsPage() {
  await requireBusinessPageAccess();
  return <ReportsWorkspace />;
}

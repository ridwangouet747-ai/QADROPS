import { ImportsWorkspace } from "@/components/business/imports-workspace";
import { localizedPageMetadata } from "@/lib/i18n/server";
import { requireBusinessPageAccess } from "@/lib/domain/business-page-access";

export const generateMetadata = () => localizedPageMetadata("meta.imports");

export default async function ImportsPage() {
  await requireBusinessPageAccess();
  return <ImportsWorkspace />;
}

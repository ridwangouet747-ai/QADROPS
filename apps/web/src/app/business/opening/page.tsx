import { OpeningWorkspace } from "@/components/business/opening-workspace";
import { localizedPageMetadata } from "@/lib/i18n/server";
import { requireBusinessPageAccess } from "@/lib/domain/business-page-access";

export const generateMetadata = () => localizedPageMetadata("meta.opening");

export default async function OpeningPage() {
  await requireBusinessPageAccess();
  return <OpeningWorkspace />;
}

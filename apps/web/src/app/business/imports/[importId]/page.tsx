import { ImportReviewWorkspace } from "@/components/business/imports-workspace";
import { localizedPageMetadata } from "@/lib/i18n/server";
import { requireBusinessPageAccess } from "@/lib/domain/business-page-access";

export const generateMetadata = () => localizedPageMetadata("meta.imports");

export default async function ImportReviewPage({ params, searchParams }: { params: Promise<{ importId: string }>; searchParams: Promise<{ existing?: string }> }) {
  await requireBusinessPageAccess();
  const [{ importId }, { existing }] = await Promise.all([params, searchParams]);
  return <ImportReviewWorkspace key={importId} importId={importId} existing={existing === "1"} />;
}

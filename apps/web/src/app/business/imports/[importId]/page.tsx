import { BusinessShell } from "@/components/business/business-shell";
import { ImportReviewWorkspace } from "@/components/business/imports-workspace";
import { localizedPageMetadata } from "@/lib/i18n/server";
import { requireBusinessPageAccess } from "@/lib/domain/business-page-access";

export const generateMetadata = () => localizedPageMetadata("meta.imports");

export default async function ImportReviewPage({ params, searchParams }: { params: Promise<{ importId: string }>; searchParams: Promise<{ existing?: string }> }) {
  const initialRole = await requireBusinessPageAccess();
  const [{ importId }, { existing }] = await Promise.all([params, searchParams]);
  const preview = process.env.NODE_ENV === "development" && process.env.QADR_PREVIEW_MODE === "true";
  return <BusinessShell initialRole={initialRole} active="imports" preview={preview}><ImportReviewWorkspace key={importId} importId={importId} existing={existing === "1"} /></BusinessShell>;
}

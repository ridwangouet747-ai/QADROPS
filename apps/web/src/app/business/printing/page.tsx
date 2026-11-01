import { BusinessShell } from "@/components/business/business-shell";
import { PrintingWorkspace } from "@/components/printing/printing-workspace";
import { localizedPageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => localizedPageMetadata("meta.printing");

export default function PrintingPage() {
  const preview = process.env.NODE_ENV === "development" && process.env.QADR_PREVIEW_MODE === "true";
  return <BusinessShell active="printing" preview={preview}><PrintingWorkspace /></BusinessShell>;
}

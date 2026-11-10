import { BusinessShell } from "@/components/business/business-shell";
import { OpeningWorkspace } from "@/components/business/opening-workspace";
import { localizedPageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => localizedPageMetadata("meta.opening");

export default function OpeningPage() {
  const preview = process.env.NODE_ENV === "development" && process.env.QADR_PREVIEW_MODE === "true";
  return <BusinessShell active="opening" preview={preview}><OpeningWorkspace /></BusinessShell>;
}

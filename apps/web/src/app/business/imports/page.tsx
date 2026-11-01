import { BusinessShell } from "@/components/business/business-shell";
import { ImportsWorkspace } from "@/components/business/imports-workspace";
import { localizedPageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => localizedPageMetadata("meta.imports");

export default function ImportsPage() {
  const preview = process.env.NODE_ENV === "development" && process.env.QADR_PREVIEW_MODE === "true";
  return <BusinessShell active="imports" preview={preview}><ImportsWorkspace /></BusinessShell>;
}

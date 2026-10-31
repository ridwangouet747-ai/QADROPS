import { BusinessShell } from "@/components/business/business-shell";
import { OpeningWorkspace } from "@/components/business/opening-workspace";

export default function OpeningPage() {
  const preview = process.env.NODE_ENV === "development" && process.env.QADR_PREVIEW_MODE === "true";
  return <BusinessShell active="opening" preview={preview}><OpeningWorkspace /></BusinessShell>;
}

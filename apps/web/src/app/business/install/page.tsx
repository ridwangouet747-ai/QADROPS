import { BusinessShell } from "@/components/business/business-shell";
import { InstallWorkspace } from "@/components/pwa/install-workspace";
import { localizedPageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => localizedPageMetadata("meta.install");

export default function InstallPage() {
  const preview = process.env.NODE_ENV === "development" && process.env.QADR_PREVIEW_MODE === "true";
  return <BusinessShell active="install" preview={preview}><InstallWorkspace /></BusinessShell>;
}

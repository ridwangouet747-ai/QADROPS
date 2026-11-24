import { InstallWorkspace } from "@/components/pwa/install-workspace";
import { localizedPageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => localizedPageMetadata("meta.install");

export default function InstallPage() {
  return <InstallWorkspace />;
}

import { BusinessShell } from "@/components/business/business-shell";
import { TeamWorkspace } from "@/components/business/team-workspace";
import { localizedPageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => localizedPageMetadata("meta.team");

export default function TeamPage() {
  const preview = process.env.NODE_ENV === "development" && process.env.QADR_PREVIEW_MODE === "true";
  return <BusinessShell active="team" preview={preview}><TeamWorkspace /></BusinessShell>;
}

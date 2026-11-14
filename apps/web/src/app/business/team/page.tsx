import { BusinessShell } from "@/components/business/business-shell";
import { TeamWorkspace } from "@/components/business/team-workspace";
import { localizedPageMetadata } from "@/lib/i18n/server";
import { requireBusinessPageAccess } from "@/lib/domain/business-page-access";

export const generateMetadata = () => localizedPageMetadata("meta.team");

export default async function TeamPage() {
  await requireBusinessPageAccess();
  const preview = process.env.NODE_ENV === "development" && process.env.QADR_PREVIEW_MODE === "true";
  return <BusinessShell active="team" preview={preview}><TeamWorkspace /></BusinessShell>;
}

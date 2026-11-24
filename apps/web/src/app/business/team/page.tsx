import { TeamWorkspace } from "@/components/business/team-workspace";
import { localizedPageMetadata } from "@/lib/i18n/server";
import { requireBusinessPageAccess } from "@/lib/domain/business-page-access";

export const generateMetadata = () => localizedPageMetadata("meta.team");

export default async function TeamPage() {
  await requireBusinessPageAccess();
  return <TeamWorkspace />;
}

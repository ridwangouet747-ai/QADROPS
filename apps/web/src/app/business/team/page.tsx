import { BusinessShell } from "@/components/business/business-shell";
import { TeamWorkspace } from "@/components/business/team-workspace";

export default function TeamPage() {
  const preview = process.env.NODE_ENV === "development" && process.env.QADR_PREVIEW_MODE === "true";
  return <BusinessShell active="team" preview={preview}><TeamWorkspace /></BusinessShell>;
}

import { localizedPageMetadata } from "@/lib/i18n/server";
import { InvitationView } from "@/components/auth/account-screens";

export const generateMetadata = () => localizedPageMetadata("meta.invitation");

export default async function InvitationPage({ params }: { params: Promise<{ invitationId: string }> }) {
  const { invitationId } = await params;
  return <InvitationView invitationId={invitationId} />;
}

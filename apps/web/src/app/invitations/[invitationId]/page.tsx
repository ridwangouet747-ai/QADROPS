import { InvitationView } from "@/components/auth/account-screens";

export const metadata = { title: "Invitation · QADR OPS", robots: { index: false } };

export default async function InvitationPage({ params }: { params: Promise<{ invitationId: string }> }) {
  const { invitationId } = await params;
  return <InvitationView invitationId={invitationId} />;
}

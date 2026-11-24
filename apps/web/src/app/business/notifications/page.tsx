import { NotificationsWorkspace } from "@/components/notifications/notifications-workspace";
import { localizedPageMetadata } from "@/lib/i18n/server";
import { requireBusinessPageAccess } from "@/lib/domain/business-page-access";

export const generateMetadata = () => localizedPageMetadata("meta.notifications");

export default async function NotificationsPage() {
  await requireBusinessPageAccess();
  return <NotificationsWorkspace />;
}

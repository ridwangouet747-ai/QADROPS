import { BusinessShell } from "@/components/business/business-shell";
import { NotificationsWorkspace } from "@/components/notifications/notifications-workspace";
import { localizedPageMetadata } from "@/lib/i18n/server";
import { requireBusinessPageAccess } from "@/lib/domain/business-page-access";

export const generateMetadata = () => localizedPageMetadata("meta.notifications");

export default async function NotificationsPage() {
  const initialRole = await requireBusinessPageAccess();
  const preview = process.env.NODE_ENV === "development" && process.env.QADR_PREVIEW_MODE === "true";
  return <BusinessShell initialRole={initialRole} active="notifications" preview={preview}><NotificationsWorkspace /></BusinessShell>;
}

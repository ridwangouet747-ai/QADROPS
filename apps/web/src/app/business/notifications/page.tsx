import { BusinessShell } from "@/components/business/business-shell";
import { NotificationsWorkspace } from "@/components/notifications/notifications-workspace";
import { localizedPageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => localizedPageMetadata("meta.notifications");

export default function NotificationsPage() {
  const preview = process.env.NODE_ENV === "development" && process.env.QADR_PREVIEW_MODE === "true";
  return <BusinessShell active="notifications" preview={preview}><NotificationsWorkspace /></BusinessShell>;
}

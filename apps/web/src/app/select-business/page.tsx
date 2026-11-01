import { localizedPageMetadata } from "@/lib/i18n/server";
import { Suspense } from "react";
import { BusinessPicker } from "@/components/auth/account-screens";

export const generateMetadata = () => localizedPageMetadata("meta.selectBusiness");

export default function Page() {
  return <Suspense><BusinessPicker /></Suspense>;
}

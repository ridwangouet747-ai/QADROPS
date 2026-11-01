import { localizedPageMetadata } from "@/lib/i18n/server";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { PlatformConsole } from "@/components/platform/platform-console";
import { getPlatformContext } from "@/lib/domain/platform-context";

export const dynamic = "force-dynamic";
export const generateMetadata = () => localizedPageMetadata("meta.platform");
const allowed = ["businesses", "subscriptions", "plans", "promotions", "notifications", "audit", "settings"] as const;

export default async function PlatformSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!allowed.includes(section as (typeof allowed)[number])) notFound();
  try {
    const context = await getPlatformContext(await headers());
    return <PlatformConsole section={section as (typeof allowed)[number]} preview={context.preview} />;
  } catch {
    notFound();
  }
}

import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { PlatformWorkspace } from "@/components/platform/platform-workspace";
import { getPlatformContext } from "@/lib/domain/platform-context";

export const dynamic = "force-dynamic";
const allowed = ["businesses", "subscriptions", "plans", "promotions", "audit"] as const;

export default async function PlatformSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!allowed.includes(section as (typeof allowed)[number])) notFound();
  try {
    const context = await getPlatformContext(await headers());
    return <PlatformWorkspace section={section as (typeof allowed)[number]} preview={context.preview} />;
  } catch {
    notFound();
  }
}

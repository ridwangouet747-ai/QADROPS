import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { PlatformConsole } from "@/components/platform/platform-console";
import { getPlatformContext } from "@/lib/domain/platform-context";

export const dynamic = "force-dynamic";
export const metadata = { title: "Qadr Ops Platform", robots: { index: false } };

export default async function PlatformDashboardPage() {
  try {
    const context = await getPlatformContext(await headers());
    return <PlatformConsole section="overview" preview={context.preview} />;
  } catch {
    notFound();
  }
}

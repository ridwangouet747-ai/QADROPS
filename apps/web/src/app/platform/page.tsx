import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { PlatformWorkspace } from "@/components/platform/platform-workspace";
import { getPlatformContext } from "@/lib/domain/platform-context";

export const dynamic = "force-dynamic";

export default async function PlatformDashboardPage() {
  try {
    const context = await getPlatformContext(await headers());
    return <PlatformWorkspace section="dashboard" preview={context.preview} />;
  } catch {
    notFound();
  }
}

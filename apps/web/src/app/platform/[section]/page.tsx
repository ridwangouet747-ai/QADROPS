import { localizedPageMetadata } from "@/lib/i18n/server";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { PlatformConsole } from "@/components/platform/platform-console";
import { getPlatformContext, PlatformReauthRequired } from "@/lib/domain/platform-context";

export const dynamic = "force-dynamic";
export const generateMetadata = () => localizedPageMetadata("meta.platform");
const allowed = ["businesses", "subscriptions", "plans", "promotions", "notifications", "audit", "settings"] as const;

export default async function PlatformSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!allowed.includes(section as (typeof allowed)[number])) notFound();
  try {
    const context = await getPlatformContext(await headers());
    return <PlatformConsole section={section as (typeof allowed)[number]} preview={context.preview} />;
  } catch (error) {
    // Le droit existe mais la session plateforme manque ou a expiré : page de connexion. Sinon, 404 neutre.
    if (error instanceof PlatformReauthRequired) redirect(`/platform/login?next=${encodeURIComponent(`/platform/${section}`)}`);
    notFound();
  }
}

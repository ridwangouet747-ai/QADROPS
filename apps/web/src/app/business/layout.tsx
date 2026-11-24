import { BusinessFrame } from "@/components/business/business-frame";
import { readBusinessShellState } from "@/lib/domain/business-page-access";

/**
 * Mise en page commune de l'espace commerçant : l'en-tête reste monté d'une page à l'autre. Elle ne protège
 * rien : chaque page appelle sa garde serveur (`requireBusinessPageAccess`) et chaque API revérifie l'accès.
 */
export default async function BusinessLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const preview = process.env.NODE_ENV === "development" && process.env.QADR_PREVIEW_MODE === "true";
  const { role, scope } = await readBusinessShellState();
  return <BusinessFrame initialRole={role} cacheScope={scope} preview={preview}>{children}</BusinessFrame>;
}

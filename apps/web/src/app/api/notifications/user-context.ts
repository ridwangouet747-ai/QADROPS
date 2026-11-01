import { getBusinessContext } from "@/lib/domain/business-context";
import { getPlatformContext } from "@/lib/domain/platform-context";

/**
 * Préférences et appareils appartiennent à la personne, pas à un commerce : `?scope=platform` pour la
 * console Qadr Agency, sinon le contexte commerçant. L'identifiant vient toujours de la session.
 */
export async function notificationUser(request: Request) {
  if (new URL(request.url).searchParams.get("scope") === "platform") {
    const context = await getPlatformContext(request.headers);
    return { db: context.db, userId: context.actorUserId };
  }
  const context = await getBusinessContext(request.headers);
  return { db: context.db, userId: context.userId };
}

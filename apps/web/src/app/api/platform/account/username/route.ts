import { ownerAccountRoute } from "@/lib/domain/platform-account-route";
import { changeOwnerUsername } from "@/lib/domain/platform-owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Le propriétaire connecté change son nom d'utilisateur : `{ currentPassword, username }`. */
export async function POST(request: Request) {
  return ownerAccountRoute(request, changeOwnerUsername);
}

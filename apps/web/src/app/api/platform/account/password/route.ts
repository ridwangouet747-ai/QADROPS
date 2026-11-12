import { ownerAccountRoute } from "@/lib/domain/platform-account-route";
import { changeOwnerPassword } from "@/lib/domain/platform-owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Le propriétaire connecté change son mot de passe : `{ currentPassword, newPassword }`. */
export async function POST(request: Request) {
  return ownerAccountRoute(request, changeOwnerPassword);
}

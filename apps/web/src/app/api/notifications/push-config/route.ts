import { vapidFromEnvironment } from "@/lib/notifications/server";

export const runtime = "nodejs";

/** Clé publique VAPID (publique par nature) ; null tant que le push n'est pas configuré. */
export function GET() {
  return Response.json({ publicKey: vapidFromEnvironment()?.publicKey ?? null }, { headers: { "cache-control": "private, max-age=300" } });
}

import { timingSafeEqual } from "node:crypto";
import { createDatabase } from "@/lib/db/client";
import { errorResponse } from "@/lib/domain/business-context";
import { expireDueSubscriptions } from "@/lib/domain/subscription-lifecycle";

export const runtime = "nodejs";

/**
 * Passage planifié d'expiration des abonnements (Vercel Cron ou équivalent), protégé par CRON_SECRET.
 * Sans secret configuré, la route n'existe pas. L'accès est de toute façon refusé dès l'échéance
 * par assertBusinessOperational, et la console normalise les statuts à chaque lecture.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) return new Response(null, { status: 404 });
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return new Response(null, { status: 401 });
  try {
    return Response.json(await expireDueSubscriptions(createDatabase()));
  } catch (error) { return errorResponse(error); }
}

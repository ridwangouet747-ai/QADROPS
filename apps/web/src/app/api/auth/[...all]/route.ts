import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth/server";

async function handle(request: Request) {
  try {
    const handler = toNextJsHandler(getAuth());
    return request.method === "GET" ? handler.GET(request) : handler.POST(request);
  } catch {
    return Response.json({ error: "AUTH_CONFIGURATION_REQUIRED" }, { status: 503 });
  }
}

export const GET = handle;
export const POST = handle;
export const runtime = "nodejs";

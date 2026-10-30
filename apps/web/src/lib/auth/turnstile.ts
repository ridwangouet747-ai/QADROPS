export type TurnstileResult = { ok: true } | { ok: false; reason: "missing" | "invalid" | "unavailable" | "not_configured" };

type VerifyResponse = { success?: boolean };

export async function verifyTurnstile(
  token: unknown,
  options: {
    secret: string | undefined;
    siteKey: string | undefined;
    isProduction: boolean;
    remoteIp?: string;
    fetcher?: typeof fetch;
  },
): Promise<TurnstileResult> {
  const { secret, siteKey, isProduction, remoteIp, fetcher = fetch } = options;
  if (!secret && !siteKey && !isProduction) return { ok: true };
  if (!secret || !siteKey) return { ok: false, reason: "not_configured" };
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) {
    return { ok: false, reason: "missing" };
  }

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set("remoteip", remoteIp);
    const response = await fetcher("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
    });
    if (!response.ok) return { ok: false, reason: "unavailable" };
    const result = (await response.json()) as VerifyResponse;
    return result.success === true ? { ok: true } : { ok: false, reason: "invalid" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

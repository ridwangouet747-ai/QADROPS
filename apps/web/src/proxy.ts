import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Redirection optimiste : sans cookie de session, les pages protégées renvoient vers la connexion.
 * Ce n'est PAS le contrôle de sécurité : chaque route API et chaque service revérifie la session,
 * l'appartenance au commerce et les permissions côté serveur.
 */
export function proxy(request: NextRequest) {
  // Prévisualisation locale : le commerce de démonstration reste accessible sans compte.
  if (process.env.QADR_PREVIEW_MODE === "true" && process.env.NODE_ENV === "development") return NextResponse.next();
  if (getSessionCookie(request)) return NextResponse.next();
  const login = new URL("/login", request.url);
  login.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/business/:path*", "/platform/:path*", "/onboarding", "/select-business", "/invitations/:path*"],
};

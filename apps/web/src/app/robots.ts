import type { MetadataRoute } from "next";

/**
 * Seule la page publique est indexable, et seulement en production Vercel : une préproduction ou un
 * aperçu ne doit jamais apparaître dans un moteur de recherche (mission 16). Aucune carte du site tant que
 * le domaine canonique n'est pas choisi (D11 de docs/product/landing-page-plan.md).
 */
export default function robots(): MetadataRoute.Robots {
  if (process.env.VERCEL_ENV !== "production") return { rules: { userAgent: "*", disallow: "/" } };
  return { rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/business/", "/platform/", "/onboarding", "/select-business", "/invitations/", "/reset-password", "/design-system"] } };
}

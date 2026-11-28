import { and, asc, eq } from "drizzle-orm";
import { revalidateTag, unstable_cache } from "next/cache";
import { subscriptionPlan } from "@/lib/db/schema";
import { getRuntimeDatabase } from "@/lib/db/runtime";
import type { CommercialDatabase } from "@/lib/domain/commercial";
import { readPlanFeatures } from "@/lib/domain/plan-limits";
import { isLocalPreview } from "@/lib/preview/mode";

/**
 * Formules affichées sur la page publique. Lecture seule, sans session ni commerce : seules les formules
 * actives en XOF, avec leurs limites lisibles. Aucun prix n'est écrit dans le code de la page.
 */
export type PublicPlan = {
  code: string;
  name: string;
  /** Entier XOF sérialisé en chaîne (jamais de flottant). */
  priceXof: string;
  /** `lifetime` : accès sans date d'expiration (`durationDays` nul), jamais une durée inventée. */
  durationKind: "fixed_duration" | "lifetime";
  durationDays: number | null;
  description: string | null;
  productLimit: number | null;
  userLimit: number | null;
};

export type PublicPlansResult =
  | { status: "ok"; plans: PublicPlan[]; preview: boolean }
  | { status: "unavailable"; preview: boolean };

export async function readPublicPlans(db: Pick<CommercialDatabase, "select">): Promise<PublicPlan[]> {
  const rows = await db.select({
    code: subscriptionPlan.code, name: subscriptionPlan.name, priceXof: subscriptionPlan.priceXof,
    durationKind: subscriptionPlan.durationKind, durationDays: subscriptionPlan.durationDays, description: subscriptionPlan.description, features: subscriptionPlan.features,
  }).from(subscriptionPlan)
    .where(and(eq(subscriptionPlan.active, true), eq(subscriptionPlan.currency, "XOF")))
    .orderBy(asc(subscriptionPlan.priceXof), asc(subscriptionPlan.code));
  return rows.map(({ features, ...row }) => {
    const limits = readPlanFeatures(features);
    return { ...row, durationKind: row.durationKind === "lifetime" ? "lifetime" as const : "fixed_duration" as const, priceXof: row.priceXof.toString(), productLimit: limits.productLimit, userLimit: limits.userLimit };
  });
}

/**
 * Mise en cache 10 minutes : la page publique ne doit pas interroger la base à chaque visite. Depuis le
 * 2026-11-19, toute création ou modification de forfait dans la console appelle `invalidatePublicPlans()` : la
 * visite suivante relit la base. Les 10 minutes ne restent qu'un filet (docs/product/landing-page.md).
 */
export const PUBLIC_PLANS_TAG = "public-plans";
const cachedPublicPlans = unstable_cache(async () => readPublicPlans(await getRuntimeDatabase()), ["landing-public-plans-v1"], { revalidate: 600, tags: [PUBLIC_PLANS_TAG] });

/**
 * Rend périmée la liste publique des forfaits, appelée par les routes de la console après une écriture réussie.
 * `expire: 0` : la visite suivante relit la base au lieu de servir l'ancienne liste. Hors d'une requête Next.js
 * (tests, scripts), il n'existe aucun cache à invalider : l'appel ne fait rien.
 */
export function invalidatePublicPlans(): void {
  try {
    revalidateTag(PUBLIC_PLANS_TAG, { expire: 0 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("static generation store missing")) return;
    throw error;
  }
}

/** Ne lève jamais : une base indisponible donne un état « indisponible », jamais une page en erreur ni un prix inventé. */
export async function getPublicPlans(): Promise<PublicPlansResult> {
  const preview = isLocalPreview();
  try {
    return { status: "ok", plans: await (preview ? readPublicPlans(await getRuntimeDatabase()) : cachedPublicPlans()), preview };
  } catch (error) {
    // Ni message ni donnée de la base dans le journal : seulement le type d'erreur.
    console.error("[landing] formules indisponibles :", error instanceof Error ? error.name : typeof error);
    return { status: "unavailable", preview };
  }
}

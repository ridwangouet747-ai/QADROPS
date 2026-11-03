/** Déclarations du garde-fou JavaScript (le module est exécuté par k6 et vérifié par Vitest). */
export declare const PREPRODUCTION_LABELS: readonly string[];
export declare function assertPreproductionTarget(raw: unknown): string;

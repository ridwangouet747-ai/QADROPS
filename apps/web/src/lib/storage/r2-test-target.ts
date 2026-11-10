import { readStorageConfig } from "./config";
import type { R2Config } from "./r2";

/*
 * Cible du test d'intégration R2 réel (mission 16). Le test n'écrit QUE dans un bucket désigné par des
 * variables dédiées `QADR_TEST_R2_*`, jamais par les variables `R2_*` de l'application : on ne peut pas
 * viser par mégarde le bucket de production en lançant les tests avec un `.env.local` de production.
 *
 * Le nom du bucket doit porter un marqueur d'environnement de test (`test`, `tests`, `staging`, `dev`,
 * `preview`) comme segment séparé par `-` ou `.` : `qadr-ops-fichiers-staging` est accepté,
 * `qadropsbucket` ou `latest-prod` sont refusés. Sans variables, le test est sauté (aucune requête).
 */

export const R2_TEST_VARIABLES = ["QADR_TEST_R2_ACCOUNT_ID", "QADR_TEST_R2_BUCKET_NAME", "QADR_TEST_R2_ACCESS_KEY_ID", "QADR_TEST_R2_SECRET_ACCESS_KEY"] as const;

const TEST_BUCKET_MARKER = /(?:^|[-.])(?:test|tests|staging|dev|preview)(?:[-.]|$)/;

export const isTestBucketName = (name: string) => TEST_BUCKET_MARKER.test(name);

export type R2TestTarget = { enabled: false; reason: string } | { enabled: true; config: R2Config };

export function readR2TestTarget(source: NodeJS.ProcessEnv = process.env): R2TestTarget {
  const value = (name: string) => source[name]?.trim() || undefined;
  const present = R2_TEST_VARIABLES.filter((name) => value(name));
  if (present.length === 0) return { enabled: false, reason: "Variables QADR_TEST_R2_* absentes : test R2 réel sauté." };
  if (present.length < R2_TEST_VARIABLES.length) {
    throw new Error(`Test R2 réel : ${R2_TEST_VARIABLES.join(", ")} doivent être renseignées ensemble.`);
  }
  const bucket = value("QADR_TEST_R2_BUCKET_NAME")!;
  if (!isTestBucketName(bucket)) {
    // Le nom du bucket n'est pas un secret : il est cité pour que l'erreur soit compréhensible.
    throw new Error(`Test R2 réel refusé : le bucket « ${bucket} » ne porte pas de marqueur test/staging/dev/preview.`);
  }
  // Même validation que l'application (formats des identifiants, juridiction), sans jamais citer de valeur secrète.
  const parsed = readStorageConfig({
    NODE_ENV: "test",
    R2_ACCOUNT_ID: value("QADR_TEST_R2_ACCOUNT_ID"),
    R2_BUCKET_NAME: bucket,
    R2_ACCESS_KEY_ID: value("QADR_TEST_R2_ACCESS_KEY_ID"),
    R2_SECRET_ACCESS_KEY: value("QADR_TEST_R2_SECRET_ACCESS_KEY"),
    R2_JURISDICTION: value("QADR_TEST_R2_JURISDICTION"),
  });
  if (parsed.mode !== "r2") throw new Error("Test R2 réel : configuration incomplète.");
  return { enabled: true, config: parsed.r2 };
}

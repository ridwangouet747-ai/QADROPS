// Point d'entrée du Worker : le serveur Next.js produit par OpenNext (`fetch`) plus les tâches planifiées
// (`scheduled`), qui remplacent les crons de Vercel en appelant les routes protégées de l'application.
// `.open-next/worker.js` n'existe qu'après `opennextjs-cloudflare build` : ce fichier est donc exclu du
// tsconfig de Next.js et compilé par Wrangler. La logique testable est dans src/lib/cron-schedule.ts.
import { default as handler } from "../.open-next/worker.js";
import { cronRequest } from "../src/lib/cron-schedule";

type Env = { CRON_SECRET?: string; BETTER_AUTH_URL?: string };
type ScheduledController = { cron: string };
type ExecutionContext = { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void };

export default {
  fetch: handler.fetch,

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const request = cronRequest(controller.cron, env.CRON_SECRET, env.BETTER_AUTH_URL);
    if (!request) {
      console.error(`Tâche planifiée ignorée (${controller.cron}) : horaire inconnu ou CRON_SECRET absent.`);
      return;
    }
    const response: Response = await handler.fetch(request, env, ctx);
    // Une exception marque l'exécution en échec dans Cloudflare (Workers > Triggers > Cron Events).
    if (!response.ok) throw new Error(`Tâche planifiée ${controller.cron} : réponse ${response.status}.`);
  },
};

// Objets durables éventuellement déclarés par OpenNext (non utilisés ici, mais leur export est attendu).
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "../.open-next/worker.js";

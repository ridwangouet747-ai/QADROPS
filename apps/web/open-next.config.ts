import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Pas de cache incrémental (R2/KV) : l'application est dynamique (données par commerce, jamais mises en cache).
export default defineCloudflareConfig();

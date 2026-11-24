import { listenForClientErrors } from "@/lib/observability/client-errors";

// Sentry du navigateur n'est téléchargé qu'à la première erreur (lib/observability/client-errors.ts).
listenForClientErrors();

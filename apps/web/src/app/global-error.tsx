"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="fr">
      <body>
        <main style={{ fontFamily: "Arial, sans-serif", margin: "10vh auto", maxWidth: 600, padding: 24 }}>
          <h1>Une erreur est survenue</h1>
          <p>Réessayez. Si le problème continue, contactez l’assistance.</p>
          <button onClick={() => reset()}>Réessayer</button>
        </main>
      </body>
    </html>
  );
}

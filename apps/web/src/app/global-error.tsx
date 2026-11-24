"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/observability/client-errors";

export default function GlobalError({
  error,
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  useEffect(() => {
    reportClientError(error);
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

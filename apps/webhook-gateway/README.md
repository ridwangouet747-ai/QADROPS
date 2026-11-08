# Passerelle locale des webhooks GeniusPay

Petit service Node.js (22+), **sans dépendance**, pour l'essai sandbox de GeniusPay depuis l'aperçu local. Cloudflare Quick Tunnel pointe vers cette passerelle, **jamais directement vers Next.js** : l'aperçu donne sans connexion le commerce de démonstration et la console `/platform`, qui ne doivent pas être publics.

```powershell
cd "C:\Users\HP\Desktop\QADR Ops\apps\webhook-gateway"
node src/cli.mjs --port 8790 --upstream http://127.0.0.1:3001
```

## Ce qu'elle fait

- Écoute sur `127.0.0.1` seulement (port 8790 par défaut).
- Relaie **uniquement** `POST /api/webhooks/geniuspay`, comparé à la cible brute de la requête : barre finale, `//`, `..`, encodage `%xx`, majuscules ou `?requête` donnent 404.
- Autre méthode sur ce chemin : 405 (`Allow: POST`). Toute autre adresse : 404. Next.js n'est alors jamais contacté.
- Corps relayé octet pour octet (jamais analysé ni ré-encodé), 64 Ko au plus (413 au-delà, comme la route).
- En-têtes relayés : `content-type`, `x-webhook-signature`, `x-webhook-timestamp`, `x-webhook-event`. Cookies, `authorization`, en-têtes du tunnel (`cf-*`, `x-forwarded-*`) et tout le reste sont abandonnés.
- 60 requêtes par minute au plus (429 au-delà). Délai d'attente de l'amont : 30 s (504) ; amont arrêté : 502.
- L'amont doit être `http://127.0.0.1:<port>` ou `http://localhost:<port>` : la passerelle ne relaie jamais vers une autre machine.

## Ce qu'elle ne fait pas

- **Elle ne vérifie pas la signature.** C'est la route Next.js qui la vérifie (HMAC sur le corps brut), et la passerelle renvoie sa réponse telle quelle (401 `invalid_signature`, 503 `billing_unavailable`, etc.).
- Elle ne journalise ni chemin demandé, ni en-tête, ni corps, ni signature : une ligne JSON par requête avec `outcome`, `status`, `bytes`, `ms`.
- Ce n'est pas un composant de production : en production, le webhook arrive sur l'application déployée.

## Tests

```powershell
node --test "test/**/*.test.mjs"
```

La chaîne passerelle → vraie route Next.js → base de démonstration est testée dans `apps/web/src/test/webhook-gateway.integration.test.ts`.

# Essai sandbox GeniusPay par Cloudflare Quick Tunnel (aperçu local)

Procédure du premier essai réel de réception de webhook, sans domaine, depuis l'aperçu local (`npm run preview`). Rédigée le 2026-11-04, révisée le 2026-11-05 (passerelle dédiée). **Rien de ce qui suit n'a encore été exécuté contre GeniusPay** : le parcours est couvert avec un GeniusPay simulé par `apps/web/src/test/preview-billing-webhook.integration.test.ts` et `apps/web/src/test/webhook-gateway.integration.test.ts`.

## 0. Essai réel du tunnel (2026-11-08)

`cloudflared` installé (`C:\Program Files (x86)\cloudflared`). Quick Tunnel ouvert vers la passerelle, Next.js volontairement arrêté, puis refermé :

| Requête publique | Réponse |
| --- | --- |
| `GET /`, `/platform`, `/platform/login`, `/business`, `/api/platform/overview`, `/api/auth/get-session` | 404 |
| `GET /api/webhooks/geniuspay/`, `GET /API/webhooks/geniuspay` | 404 |
| `GET /api/webhooks/geniuspay` | 405 |
| `POST /api/webhooks/geniuspay` | 502 (amont arrêté) |

Après arrêt : l'adresse répond 530, aucun processus `cloudflared`, port 8790 libre. **Toujours bloqué** : `GENIUSPAY_WEBHOOK_SECRET` est vide ; GeniusPay ne le délivre qu'après déclaration de l'URL du webhook dans son tableau de bord (action du propriétaire, avec un tunnel ouvert, l'adresse changeant à chaque lancement). Aucun paiement sandbox n'a été initié.

## 1. Architecture de l'essai

```
GeniusPay sandbox ──HTTPS──▶ Cloudflare Quick Tunnel ──▶ passerelle 127.0.0.1:8790 ──▶ Next.js (aperçu) 127.0.0.1:3001
                                                         (seul POST /api/webhooks/geniuspay)
```

- Le tunnel pointe vers la **passerelle** (`apps/webhook-gateway`, voir son README), jamais vers Next.js : sinon l'aperçu entier serait public, dont `/platform`, sans connexion.
- La passerelle ne relaie que `POST /api/webhooks/geniuspay`, corps intact et en-têtes signés ; tout le reste reçoit 404/405 sans que Next.js soit contacté.
- La signature est vérifiée par la route Next.js existante, inchangée.
- En aperçu, le webhook, la caisse d'abonnement et les crons utilisent la base de démonstration en mémoire (`getRuntimeDatabase()`), et `getDatabase()` refuse l'aperçu : Neon n'est jamais joint.

## 2. Variables

À saisir par le propriétaire dans `apps/web/.env.development.local` (ignoré par Git, chargé seulement en développement, prioritaire sur `.env.local`). Jamais dans `.claude/launch.json`, qui est suivi.

| Variable | Valeur attendue |
| --- | --- |
| `GENIUSPAY_API_KEY` | clé `pk_sandbox_…` |
| `GENIUSPAY_API_SECRET` | clé `sk_sandbox_…` |
| `GENIUSPAY_WEBHOOK_SECRET` | secret `whsec_…` donné par GeniusPay après déclaration de l'URL |
| `GENIUSPAY_BASE_URL` | à laisser vide (défaut `https://geniuspay.ci/api/v1/merchant`), sauf indication de GeniusPay |

Les trois premières sont exigées **ensemble** : tant que `whsec_` manque, le paiement en ligne reste indisponible (503 `billing_unavailable` sur le webhook, message dans l'interface). `BETTER_AUTH_URL` est fixée à `http://localhost:3001` dans le terminal (URL de retour après paiement). À ne pas définir : clés live (refusées hors production), `CRON_SECRET`.

## 3. Installer cloudflared

`winget` n'est pas disponible sur ce poste. Télécharger l'exécutable officiel depuis la page des versions de Cloudflare (`https://github.com/cloudflare/cloudflared/releases/latest`, fichier `cloudflared-windows-amd64.exe`), le renommer `cloudflared.exe` et le placer dans un dossier du `PATH`, ou l'appeler par son chemin complet. `wrangler` ne remplace pas `cloudflared` pour un Quick Tunnel.

## 4. Commandes (PowerShell, trois terminaux)

Terminal 1, aperçu :

```powershell
cd "C:\Users\HP\Desktop\QADR Ops\apps\web"; $env:BETTER_AUTH_URL = "http://localhost:3001"; npm run preview
```

Terminal 2, passerelle :

```powershell
cd "C:\Users\HP\Desktop\QADR Ops\apps\webhook-gateway"; node src/cli.mjs --port 8790 --upstream http://127.0.0.1:3001
```

Préchauffage (la première compilation de la route peut dépasser 20 s en `next dev`) : la réponse attendue est 401 si les trois clés sont lues, 503 sinon.

```powershell
Invoke-WebRequest -Method Post -Uri "http://127.0.0.1:8790/api/webhooks/geniuspay" -Body '{}' -ContentType "application/json" -SkipHttpErrorCheck | Select-Object StatusCode, Content
```

Terminal 3, tunnel vers la passerelle (jamais vers le port 3001) :

```powershell
cloudflared tunnel --no-autoupdate --url http://127.0.0.1:8790
```

Noter l'adresse `https://….trycloudflare.com` affichée.

## 5. Vérifications avant de déclarer l'URL (par le tunnel)

Remplacer `$t` par l'adresse du tunnel :

```powershell
$t = "https://SOUS-DOMAINE.trycloudflare.com"
foreach ($p in "/", "/platform", "/business/subscription", "/api/platform/businesses", "/api/auth/get-session", "/api/webhooks/geniuspay/", "/api/webhooks/geniuspay?x=1") { "{0} -> {1}" -f $p, (Invoke-WebRequest -Uri "$t$p" -SkipHttpErrorCheck).StatusCode }
"GET webhook -> " + (Invoke-WebRequest -Uri "$t/api/webhooks/geniuspay" -SkipHttpErrorCheck).StatusCode
"POST webhook sans signature -> " + (Invoke-WebRequest -Method Post -Uri "$t/api/webhooks/geniuspay" -Body '{}' -ContentType "application/json" -SkipHttpErrorCheck).StatusCode
```

Attendu : 404 pour chaque adresse, 405 pour `GET` du webhook, 401 (clés lues) ou 503 (clés incomplètes) pour le `POST` sans signature. Tout 200 sur une autre adresse : arrêter le tunnel immédiatement.

## 6. Obtenir et configurer `whsec_`

1. Dans le tableau de bord GeniusPay **sandbox**, déclarer le webhook : URL `https://SOUS-DOMAINE.trycloudflare.com/api/webhooks/geniuspay`, événements `payment.*`.
2. Copier le secret `whsec_…` délivré **directement** dans `apps/web/.env.development.local` (`GENIUSPAY_WEBHOOK_SECRET`). Ne le coller ni dans le chat, ni dans un rapport, ni dans un fichier suivi.
3. Redémarrer l'aperçu (Ctrl+C puis la commande du terminal 1) ; la base de démonstration repart à zéro, ce qui est voulu.
4. Refaire le préchauffage : la réponse doit être 401 (la configuration est lue et la signature exigée).
5. Garder le tunnel ouvert : s'il redémarre, l'adresse change et il faut redéclarer l'URL (et, le cas échéant, le nouveau `whsec_`).

## 7. Scénario sandbox réel

1. **Événement de test** (bouton du tableau de bord, s'il existe) : terminal 2 `transmis` 200 ; terminal 1 `POST /api/webhooks/geniuspay 200`. Un 401 : le terminal 1 indique le motif et la variante reconnue ; les transmettre, ne pas modifier le code.
2. **Facture et paiement** : sur `http://localhost:3001/business/subscription`, choisir une formule et payer. Qadr Ops crée la facture et la tentative, appelle `POST /payments` et redirige vers le checkout GeniusPay.
3. **Paiement sandbox** avec le moyen de test documenté par GeniusPay (aucun fonds réel).
4. **Webhook** `payment.*` reçu par le tunnel puis la passerelle ; signature vérifiée par la route.
5. **Relecture** `GET /payments/{reference}` par le serveur : référence, environnement, métadonnées `qadr_invoice`/`qadr_attempt`, XOF et montant exact.
6. **Facture payée et abonnement activé une fois** : date de fin avancée d'une seule période ; la page de retour relit aussi le paiement, l'activation est idempotente.
7. **Contrôle chez GeniusPay** : transaction terminée, même référence, montant net de la facture.
8. **Doublon** : renvoyer l'événement depuis le tableau de bord (si possible) → 200 `duplicate: true`, ou 200 sans changement ; la date de fin ne bouge plus.
9. **Négatifs** : paiement annulé ou en échec sans activation.

## 8. Après l'essai

Arrêter le tunnel (Ctrl+C), **supprimer le webhook chez GeniusPay** (le sous-domaine `trycloudflare.com` peut être réattribué), renouveler `whsec_` si possible, arrêter la passerelle et l'aperçu. Consigner les résultats dans `docs/engineering/geniuspay-questions.md` et le journal de la mission 12.

## 9. Limite connue

`next dev` écoute sur toutes les interfaces : l'aperçu reste joignable depuis le réseau local (et le réseau privé virtuel éventuel, adresse « Network » affichée au lancement). Le tunnel ne l'expose pas, mais l'essai doit se faire sur un réseau de confiance.

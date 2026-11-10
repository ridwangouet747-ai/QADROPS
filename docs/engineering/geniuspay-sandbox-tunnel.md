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

## 0 bis. Premier paiement sandbox réel de bout en bout (2026-11-09, mission 15)

Aperçu `qadr-web-preview-geniuspay-sandbox` (127.0.0.1:3001, base de démonstration PGlite, Neon jamais joint), passerelle 8790, Quick Tunnel. Webhook déclaré par le propriétaire dans le tableau de bord sandbox, secret saisi par lui dans `apps/web/.env.local` (jamais transmis dans la conversation). Clés `pk_sandbox_`/`sk_sandbox_`. Le checkout sandbox de GeniusPay propose quatre scénarios : Success, Failure, Timeout, Pending.

| Cas | Ce qui a été fait | Résultat observé |
| --- | --- | --- |
| Exposition du tunnel | `/`, `/platform`, `/platform/login`, `/business/subscription`, `/api/platform/businesses`, `/api/auth/get-session`, variantes du webhook | 404 partout, `GET` du webhook 405, `POST` sans signature 401 `invalid_signature` |
| Configuration erronée | `.env.local` contenait `GENIUSPAY_BASE_URL = https://api.sandbox.geniuspay.com/…` (domaine tiers, TLS refusé) | 502 `provider_unavailable`, tentative `failed`, rien débité. Les clés ne sont pas parties (échec TLS avant tout envoi HTTP). Ligne mise en commentaire ; **le code refuse désormais tout hôte hors `geniuspay.ci`/`genius.ci`** |
| Paiement réussi (Essentiel, 5 000 XOF) | checkout → scénario Success | Webhook signé relayé, route 200 ; page de retour « Paiement confirmé » ; fin d'abonnement avancée d'une seule période (3 décembre 2026 → 2 janvier 2027) ; facture `paid` |
| Relecture chez GeniusPay | `GET /payments/{reference}` | `completed`, `amount` 5 000, `fees` 0, `net_amount` 5 000, `XOF`, `sandbox`, `payment_method` `orange_money`, métadonnées `qadr_invoice` et `qadr_attempt` identiques |
| Double clic | 2 requêtes simultanées avec la même clé + 1 avec une nouvelle clé | Une seule tentative, un seul lien ; `replayed` puis `reused` |
| Retour « succès » sans payer | ouverture directe de `…/return?result=success` | « Paiement en cours de vérification », rien activé |
| Idempotence de l'activation | deux relectures de la page de retour + rejeu de la clé | date de fin inchangée |
| Paiement en échec | scénario Failure | webhook 200 ; « Paiement non abouti, rien n'a été activé » ; date inchangée |
| Paiement en attente | scénario Pending | GeniusPay redirige avec `result=success&status=pending` ; Qadr Ops affiche « en cours de vérification », n'active rien ; une autre formule est refusée tant que ce paiement est ouvert (409 `payment_in_progress`) |
| Coupure réseau (webhook perdu) | passerelle arrêtée, scénario Success (Équipe, 15 000 XOF) | tunnel 502 ; rien activé tant que le navigateur n'est pas revenu ; au retour, la relecture `GET` seule active la formule Équipe une fois |

**Réponses obtenues** (complètent `geniuspay-questions.md`) :
- Q1 : la sandbox répond sur l'URL par défaut `https://geniuspay.ci/api/v1/merchant` ; l'environnement vient des clés.
- Q2-Q4 : la signature calculée sur le corps brut, telle que codée, est acceptée (webhooks 200).
- Q9 : les métadonnées reviennent à l'identique dans `GET`, accompagnées de `success_url`, `error_url`, `external_reference` et `scenario`.
- Q10 : `environment` vaut `sandbox`.
- Q11 : la création renvoie `checkout_url` (201, `status` absent) et `expires_at` (24 h).
- Q12 : en sandbox, la référence est `SANDBOX_` + 16 caractères, dans l'alphabet accepté.

**Non obtenu** :
- relance d'un webhook perdu (Q6) : aucune nouvelle livraison n'a été observée dans les minutes qui ont suivi le rétablissement de la passerelle ;
- scénario Timeout ;
- renvoi manuel d'un événement depuis le tableau de bord (doublon réel) ;
- montant ou devise discordants : GeniusPay ne permet pas de les provoquer, ces cas restent couverts par `subscription-billing.http.test.ts`.

## 0 ter. Relecture en lecture seule (2026-11-10, mission 16)

Sans aperçu, sans tunnel et sans nouveau paiement : un script local (hors dépôt) a relu l'API sandbox avec les clés de `apps/web/.env.local`, jamais affichées, par la classe `GeniusPayProvider` du dépôt.

| Appel | Résultat |
| --- | --- |
| `GET /payments/{référence inexistante}` | 404, lu comme « inconnu » (`null`) par `getPayment`, sans exception |
| `GET /payments?per_page=10` (liste) | 200, 6 paiements sandbox, champs `amount, completed_at, created_at, currency, customer_email, customer_name, customer_phone, environment, external_reference, fees, id, merchant_id, net_amount, payment_method, reference, status` |
| `GET /payments/{reference}` sur chacun | 2 `completed` (15 000 et 5 000 XOF), 1 `failed`, **3 encore `pending` le lendemain** ; tous `XOF`, `sandbox`, `orange_money`, métadonnées `qadr_attempt`, `qadr_invoice`, `scenario`, `success_url`, `error_url` |

Conséquences tirées dans le code (mission 16) : un paiement abandonné n'expire pas chez GeniusPay après les 24 h du lien, donc il ne doit ni bloquer un changement de formule indéfiniment, ni être relu chaque jour sans fin (`docs/billing-geniuspay.md` § 1). Le scénario « Timeout » du checkout sandbox n'a toujours pas été joué : il n'est pas possible de savoir lequel des trois `pending` en provient.

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

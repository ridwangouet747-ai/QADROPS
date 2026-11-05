# Essai sandbox GeniusPay par Cloudflare Quick Tunnel (aperçu local)

Procédure du premier essai réel de réception de webhook, sans domaine, depuis l'aperçu local (`npm run preview`). Rédigée le 2026-11-04. **Rien de ce qui suit n'a encore été exécuté contre GeniusPay** : seul le parcours avec un GeniusPay simulé est couvert par `src/test/preview-billing-webhook.integration.test.ts`.

## 1. Prérequis côté code (correctif du 2026-11-04)

En aperçu, la caisse d'abonnement écrit dans la base de démonstration en mémoire. Le webhook, le cron des abonnements, le cron des notifications et la vérification publique de campagne passent désormais par `getRuntimeDatabase()` (`apps/web/src/lib/db/runtime.ts`), qui choisit la même base. `getDatabase()` (client Neon) refuse de s'exécuter en aperçu : `scripts/preview.mjs` retire `DATABASE_URL`, mais `next dev` recharge `.env.local`, ce qui aurait pu faire joindre Neon par une route oubliée.

La vérification de signature n'a pas changé.

## 2. Variables

À saisir par le propriétaire dans `apps/web/.env.development.local` (ignoré par Git, chargé seulement en développement, prioritaire sur `.env.local`). Jamais dans `.claude/launch.json`, qui est suivi.

| Variable | Valeur attendue |
| --- | --- |
| `GENIUSPAY_API_KEY` | clé `pk_sandbox_…` |
| `GENIUSPAY_API_SECRET` | clé `sk_sandbox_…` |
| `GENIUSPAY_WEBHOOK_SECRET` | secret `whsec_…` donné par GeniusPay pour l'URL du webhook |
| `GENIUSPAY_BASE_URL` | à laisser vide (défaut `https://geniuspay.ci/api/v1/merchant`) |

`BETTER_AUTH_URL` est fixée à `http://localhost:3001` dans le terminal (les URL de retour en dépendent ; le défaut `http://localhost:3000` ne correspond pas au port de l'aperçu). À ne pas définir pour l'essai : clés live (refusées hors production), `CRON_SECRET`.

## 3. Commandes (PowerShell)

Installation de cloudflared, gratuite, une seule fois :

```powershell
winget install --id Cloudflare.cloudflared
```

Terminal 1, aperçu :

```powershell
cd "C:\Users\HP\Desktop\QADR Ops\apps\web"; $env:BETTER_AUTH_URL = "http://localhost:3001"; npm run preview
```

Terminal 2, tunnel :

```powershell
cloudflared tunnel --url http://localhost:3001
```

Contrôle sans secret (remplacer l'adresse) :

```powershell
Invoke-WebRequest -Method Post -Uri "https://SOUS-DOMAINE.trycloudflare.com/api/webhooks/geniuspay" -Body '{}' -ContentType "application/json" -SkipHttpErrorCheck | Select-Object StatusCode, Content
```

- 401 `invalid_signature` : route joignable, configuration lue, signature exigée.
- 503 `billing_unavailable` : clés absentes ou invalides (motif dans le terminal 1, sans valeur de clé).

URL à déclarer dans le tableau de bord GeniusPay sandbox : `https://SOUS-DOMAINE.trycloudflare.com/api/webhooks/geniuspay`, méthode `POST`, événements `payment.*`. Si un nouveau `whsec_` est délivré, le saisir puis redémarrer l'aperçu avant tout paiement (la base en mémoire est vidée au redémarrage).

## 4. Précautions

- Le tunnel expose tout le port 3001 : en aperçu, la démo donne sans compte le commerce de démonstration et la console `/platform`, et permet de lancer des paiements sandbox avec les clés configurées. URL à ne pas partager, tunnel ouvert le temps de l'essai seulement.
- Uniquement `npm run preview` (jamais `npm run dev`) derrière le tunnel ; clés sandbox seulement ; données de démonstration seulement.
- Ne pas ajouter `allowedDevOrigins` : le webhook n'en a pas besoin, et Next bloque ainsi les ressources de développement depuis l'adresse du tunnel.
- Après l'essai : arrêter le tunnel, **supprimer le webhook chez GeniusPay** (le sous-domaine `trycloudflare.com` peut être réattribué), renouveler le `whsec_` si possible, arrêter l'aperçu.
- Si GeniusPay refuse une URL de retour en `http://localhost`, ne rien contourner : noter l'erreur et décider ensuite (adresse du tunnel comme URL de retour, ce qui demande une modification de configuration).

## 5. Scénario

1. **Webhook de test** (bouton du tableau de bord, s'il existe) : 200, événement enregistré `ignored`. Un 401 donne dans le journal le motif et la variante reconnue : les transmettre, ne pas modifier le code pour l'accepter. `stale` = horloge décalée.
2. **Paiement sandbox réussi** depuis `http://localhost:3001/business/subscription` : webhook `payment.*` reçu avec 200, relecture `GET /payments/{reference}`, abonnement actif. La page de retour relit aussi le paiement ; l'activation est idempotente.
3. **Contrôle chez GeniusPay** : transaction terminée, montant égal au montant net de la facture, XOF, même référence que dans Qadr Ops.
4. **Activation unique** : fin d'abonnement avancée d'une seule période, stable après rechargements ; rejeu du webhook = 200 `duplicate: true` (même identifiant) ou 200 sans changement.
5. **Négatifs** : paiement annulé ou en échec sans activation ; corps modifié refusé (401).

Consigner les résultats observés dans `docs/engineering/geniuspay-questions.md` (réponses aux questions ouvertes) et dans le journal de la mission 12.

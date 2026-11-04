# GeniusPay : questions à faire confirmer et protocole d'essai sandbox

Mission 12, bloc 2, point 2 du plan (`mission-12-plan.md` § 7). Document de travail pour le propriétaire.

- **Documentation relue le 2026-11-04** : `geniuspay.ci/docs/api`, `/docs/sdk` et `/docs/subscription-api`. Le guide complet des webhooks est réservé aux comptes connectés : il n'a pas été lu.
- **Aucun échange n'a encore eu lieu avec GeniusPay.** Rien ci-dessous n'est confirmé par eux.
- Le code suit l'hypothèse la plus prudente pour chaque point. La colonne « Si la réponse diffère » indique où intervenir.

## 1. Questions bloquantes (à confirmer avant tout essai en production)

| # | Question | Ce que dit la documentation | Hypothèse du code | Si la réponse diffère |
| --- | --- | --- | --- | --- |
| Q1 | Quelle est l'URL de base officielle de l'API Merchant, en sandbox et en live ? | Trois hôtes cités : `geniuspay.ci/api/v1/merchant` (API), `pay.genius.ci/api/v1/merchant` (SDK Spring), `api.geniuspay.ci` (Subscription API). | `https://geniuspay.ci/api/v1/merchant` par défaut, modifiable par `GENIUSPAY_BASE_URL` (HTTPS obligatoire). | Renseigner `GENIUSPAY_BASE_URL`, sans changer le code. |
| Q2 | Quelle chaîne exacte est signée ? Les octets du corps HTTP envoyé, ou un JSON ré-encodé (l'exemple PHP utilise `json_encode`) ? | Formule `timestamp + "." + json_payload`. Le SDK Next.js exige le corps brut. L'exemple PHP ré-encode le JSON. | HMAC-SHA256 de `` `${timestamp}.${corpsBrut}` ``. | `verifyGeniusPayWebhookSignature` (`lib/billing/geniuspay.ts`). Le diagnostic décrit au § 4 donne la réponse dès le premier webhook sandbox. |
| Q3 | Quel encodage pour `X-Webhook-Signature` (hex minuscule, base64) ? Y a-t-il un préfixe (`sha256=`) ? | Non précisé. L'exemple PHP suppose de l'hexadécimal. | Hexadécimal de 64 caractères uniquement, sans préfixe. | Même fonction. Le diagnostic le détecte aussi. |
| Q4 | `X-Webhook-Timestamp` est-il en secondes ou en millisecondes ? La tolérance de 300 s est-elle bien la valeur recommandée ? | Tolérance de 300 s dans un commentaire d'exemple. Unité non précisée. | Secondes (1 à 12 chiffres), ±300 s. | Même fonction. Le diagnostic signale un horodatage en millisecondes. |
| Q5 | Le champ `id` du webhook est-il identique d'une relance à l'autre ? `X-Webhook-Delivery` change-t-il à chaque envoi ? | `id` (UUID) présent dans l'exemple ; `X-Webhook-Delivery` décrit comme « identifiant unique de livraison ». Usage non précisé. | Déduplication sur `id` (à défaut, empreinte SHA-256 du corps). | Si `id` change à chaque relance, la déduplication rejoue la relecture par l'API : c'est sans risque (activation idempotente), mais il faudra corriger la source de l'identifiant (`handleGeniusPayWebhook`). |
| Q6 | Politique de relance des webhooks : quels codes HTTP déclenchent une relance ? Combien de tentatives, à quel intervalle ? Quel délai de réponse maximal ? | Non documenté. | `200` si l'événement est traité, en double, ignoré ou de référence inconnue. `503` si GeniusPay ou la base sont injoignables (relance attendue). `401` pour une signature invalide. `400` pour un JSON illisible. `413` au-delà de 64 Ko. | Si GeniusPay ne relance pas sur `503`, seul le rapprochement quotidien (cron 01:00 UTC) rattrape le paiement. Il faudrait alors le rendre plus fréquent. |
| Q7 | Liste exhaustive des statuts de `GET /payments/{reference}`, et transitions possibles. Un paiement `failed`, `expired` ou `cancelled` peut-il devenir `completed` ? Un `completed` peut-il devenir autre chose que `refunded` ? | Trois listes différentes : `pending, processing, completed, failed, expired`, puis `… cancelled, refunded`. Le SDK Django parle de `paid`. | Statuts connus : `pending, processing, completed, failed, cancelled, refunded, expired`. Un statut inconnu est traité comme non payé. Un `completed` tardif est accepté. | `normalizeGeniusPayStatus` et `canMove` (`subscription-billing.ts`). Si `paid` existe, l'ajouter comme équivalent de `completed`. |
| Q8 | Que représente `amount` (montant payé par le client, frais compris ou non) par rapport à `fees` et `net_amount` ? Les frais sont-ils ajoutés au client ou retenus au marchand ? | Champs présents, sens non précisé. | `amount` doit être égal, à l'unité près, au montant net de la facture Qadr Ops (après remise de campagne). Sinon : anomalie `amount_mismatch`, pas d'activation. | Si `amount` inclut des frais payés par le client, la comparaison doit porter sur un autre champ (`anomalyOf`). |
| Q9 | Les `metadata` envoyées à la création sont-elles renvoyées à l'identique (clés et valeurs texte) par `GET /payments/{reference}` et dans les webhooks ? Y a-t-il une limite de taille ? | « Renvoyées dans les réponses et les webhooks ». | `qadr_invoice` et `qadr_attempt` doivent revenir à l'identique. Sinon : anomalie `metadata_mismatch`, pas d'activation. | Si les métadonnées ne reviennent pas dans `GET`, aucune activation n'est possible. Il faudrait se fier à la seule référence (moins sûr). |
| Q10 | Valeurs du champ `environment` et de l'en-tête `X-Webhook-Environment` : `sandbox`/`live` ou `sandbox`/`production` ? Le champ est-il toujours présent ? | Exemples avec `sandbox`, `live` et `production`. | Seuls `sandbox` et `live` sont lus. Toute autre valeur est traitée comme absente. L'environnement est alors celui de la clé qui relit le paiement. | Ajouter `production` comme synonyme de `live` (`parseEnvironment`) pour retrouver le contrôle d'environnement. |
| Q11 | Sans `payment_method`, la réponse de création contient-elle toujours `checkout_url` ? Quelle différence avec `payment_url` ? `expires_at` est-il toujours fourni ? | L'exemple 201 montre `payment_url`, l'exemple « checkout » montre `checkout_url` et `expires_at`. | `checkout_url` obligatoire (sinon l'ouverture échoue proprement). `expires_at` facultatif (24 h par défaut). | `GeniusPayProvider.createCheckout`. |
| Q12 | Format exact de la référence (`MTX-` + combien de caractères, quel alphabet) ? | `MTX-XXXXXXXXXX` côté API, mais `TXN-…` dans un exemple de webhook. | Accepte `[A-Za-z0-9_-]{1,64}`. | Aucun changement nécessaire si le format reste dans cet alphabet. |

## 2. Questions d'exploitation (avant la production, non bloquantes pour la sandbox)

| # | Question | Pourquoi |
| --- | --- | --- |
| Q13 | Limites de débit de l'API (requêtes par minute) et codes d'erreur renvoyés. | Le rapprochement quotidien relit tous les paiements `pending` à la suite. |
| Q14 | Remboursements : uniquement depuis le tableau de bord GeniusPay ? Remboursement partiel possible ? L'événement `payment.refunded` est-il toujours envoyé ? | Aucun endpoint documenté. Qadr Ops enregistre `refunded` sans raccourcir la période. |
| Q15 | En sandbox : comment simuler un succès, un échec, une expiration ? Les webhooks sont-ils envoyés ? Le secret `whsec_` et l'URL du webhook sont-ils distincts par environnement ? | Nécessaire pour l'essai du § 3. |
| Q16 | Adresses IP d'origine des webhooks (liste publiable) et politique de rotation du secret `whsec_`. | Défense en profondeur dans le pare-feu Cloudflare (facultatif). |
| Q17 | Valeur exacte de `payment_method` pour MTN (`mtn_money` ou `mtn_momo`) et liste complète des moyens. | Affichage seulement : les deux sont déjà reconnus. |
| Q18 | Politique de version de l'API (`api_version: 2024-01-01` dans les webhooks) : préavis en cas de changement ? | Éviter une rupture silencieuse. |
| Q19 | Abonnements récurrents (Subscription API) : le Mobile Money récurrent est-il prévu ? Comment les webhooks d'abonnement sont-ils signés ? | Décision D-12-2 (carte récurrente reportée). |

**Questions commerciales, pour le propriétaire seulement** : frais par moyen de paiement, délai et mode de reversement, conditions contractuelles et pièces exigées en Côte d'Ivoire, procédure d'activation du mode live. Ces points ne relèvent pas du code. Ils conditionnent la mise en production (CLAUDE.md § 15).

## 3. Message prêt à envoyer à GeniusPay

À envoyer **par le propriétaire**, depuis son compte marchand (support ou contact du tableau de bord). L'adresse e-mail de contact est masquée sur la page publique. Aucune clé ni aucun secret ne doit figurer dans le message.

> Objet : Intégration API Merchant (checkout hébergé + webhooks) — questions techniques avant mise en production
>
> Bonjour,
>
> Nous intégrons GeniusPay (API Merchant v1, parcours hébergé sans `payment_method`, webhooks) pour encaisser les abonnements de notre logiciel Qadr Ops, en Côte d'Ivoire. Avant nos essais en sandbox puis la mise en production, pourriez-vous nous confirmer les points suivants, que la documentation publique laisse ouverts ?
>
> 1. L'URL de base officielle de l'API Merchant, en sandbox et en live : `https://geniuspay.ci/api/v1/merchant`, `https://pay.genius.ci/api/v1/merchant` ou `https://api.geniuspay.ci/v1/merchant` ?
> 2. Signature des webhooks : la valeur de `X-Webhook-Signature` est-elle le HMAC-SHA256, avec le secret `whsec_…`, de la chaîne `X-Webhook-Timestamp + "." + corps HTTP brut, octet pour octet` ? Ou d'un JSON ré-encodé ? Est-elle encodée en hexadécimal minuscule, sans préfixe ?
> 3. `X-Webhook-Timestamp` est-il en secondes Unix ? Quelle tolérance recommandez-vous ?
> 4. Le champ `id` du webhook reste-t-il identique lors des relances d'un même événement ? Quel est le rôle de `X-Webhook-Delivery` ?
> 5. Relances : quels codes de réponse HTTP déclenchent une nouvelle tentative ? Combien de tentatives, à quels intervalles ? Quel délai de réponse attendez-vous ?
> 6. La liste complète des statuts renvoyés par `GET /payments/{reference}`, et les transitions possibles. En particulier, un paiement `failed` ou `expired` peut-il devenir `completed` ?
> 7. Le champ `amount` de `GET /payments/{reference}` est-il exactement le montant demandé à la création ? Les frais sont-ils ajoutés au client ou retenus sur `net_amount` ?
> 8. Les `metadata` envoyées à la création sont-elles toujours renvoyées à l'identique par `GET /payments/{reference}` et dans les webhooks ? Y a-t-il une limite de taille ?
> 9. Valeurs possibles du champ `environment` et de l'en-tête `X-Webhook-Environment` : `sandbox`/`live` ou `sandbox`/`production` ?
> 10. Sans `payment_method`, la réponse de création contient-elle toujours `checkout_url` et `expires_at` ? Quelle est la différence avec `payment_url` ?
> 11. En sandbox : comment simuler un paiement réussi, échoué ou expiré ? Les webhooks sont-ils envoyés ? Le secret et l'URL du webhook sont-ils propres à chaque environnement ?
> 12. Remboursements : sont-ils faits uniquement depuis le tableau de bord ? Partiels ou totaux ? L'événement `payment.refunded` est-il toujours envoyé ?
> 13. Limites de débit de l'API, et liste des adresses IP d'origine des webhooks si elle existe.
>
> Merci d'avance pour vos réponses.

## 4. Diagnostic de signature (ajouté le 2026-11-04)

Quand un webhook est refusé pour une signature ou un horodatage invalides, `diagnoseGeniusPaySignature` (`lib/billing/geniuspay.ts`) recalcule les lectures possibles de la documentation :

- encodage hex, base64 ou base64url ;
- message `horodatage.corps` ou corps seul ;
- corps brut, JSON compact ré-encodé, ou JSON à la manière de PHP (barres obliques et non-ASCII échappés) ;
- horodatage en millisecondes ;
- préfixe `sha256=`.

Le journal serveur indique alors, par exemple, `webhook GeniusPay refusé : bad_signature (variante reconnue : base64+horodatage_point_corps+corps_brut)`.

- **L'événement reste refusé (401).** Le diagnostic ne valide jamais rien.
- Le journal ne contient ni secret, ni signature, ni contenu du corps.
- Le premier webhook sandbox répond donc à Q2, Q3 et Q4, même sans réponse écrite de GeniusPay. La correction consistera à aligner `verifyGeniusPayWebhookSignature` sur la variante observée, avec un test.

## 5. Protocole d'essai sandbox

### Prérequis, chacun soumis à l'accord explicite du propriétaire

1. Clés sandbox (`pk_sandbox_…`, `sk_sandbox_…`) et secret `whsec_…` créés par le propriétaire dans le tableau de bord GeniusPay. Ils ne sont jamais transmis dans la conversation ni écrits dans Git.
2. Une préproduction HTTPS joignable par GeniusPay, par exemple un déploiement Vercel de prévisualisation. **Créer ce déploiement est un déploiement : il exige une autorisation.** `readGeniusPayConfig` n'accepte une clé sandbox sur un build de production que si `VERCEL_ENV=preview` : la préproduction doit donc être un déploiement de prévisualisation Vercel.
3. Une base de préproduction distincte de la production. Neon n'a jamais été contacté : la première connexion suit `docs/production-setup-guide.md`, avec autorisation.
4. URL du webhook déclarée chez GeniusPay : `https://<préproduction>/api/webhooks/geniuspay`.

### Déroulé

| Étape | Action | Résultat attendu | Ce qu'on note |
| --- | --- | --- | --- |
| 1 | `/business/subscription` affiche « Payer en ligne ». | `onlinePayment: true`. | — |
| 2 | Payer une formule. | Redirection HTTPS vers `checkout_url`. Facture `open`, tentative `pending`. | Champs de la réponse de création (Q11, Q12). |
| 3 | Simuler un succès dans la sandbox. | Webhook reçu, `200`. Tentative `confirmed`, facture `paid`, abonnement `active`. | En cas de `401`, la variante du journal (Q2 à Q4). En-têtes reçus, sans leurs valeurs secrètes. |
| 4 | Page de retour. | « Paiement confirmé » seulement après relecture `GET /payments/{reference}`. | Statut et champs `amount`, `fees`, `net_amount`, `environment`, `metadata` (Q7 à Q10). |
| 5 | Rejouer le même webhook depuis le tableau de bord, s'il le permet. | `200 duplicate`, aucune prolongation. | Valeur de `id` et de `X-Webhook-Delivery` (Q5). |
| 6 | Simuler un échec, puis une expiration. | Tentative `failed`/`expired`, abonnement inchangé. | Statuts exacts (Q7). |
| 7 | Couper la route webhook (réponse `503`), puis la rétablir. | GeniusPay relance, ou le cron de rapprochement rattrape le paiement. | Nombre et intervalle des relances (Q6). |
| 8 | Commerce avec une remise de campagne. | Montant net envoyé et relu à l'identique. | Q8. |

### Critères de réussite et retour arrière

- **Réussite** : les étapes 2 à 6 donnent l'état attendu sans intervention manuelle. Aucune anomalie `amount_mismatch` ou `metadata_mismatch`. Aucun abonnement activé sans relecture par l'API.
- **Retour arrière** : retirer les trois variables `GENIUSPAY_*` de la préproduction. Le paiement en ligne redevient « indisponible » et le webhook répond `503`. Aucune donnée n'est supprimée.
- **Les résultats sont consignés** dans `mission-12-plan.md` § 6, en séparant ce qui a été observé de ce qui a été déduit.

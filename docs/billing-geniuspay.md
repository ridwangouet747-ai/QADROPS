# Paiement de l'abonnement Qadr Ops par GeniusPay (mission 12, lot L1b)

Un commerce peut payer son abonnement à Qadr Agency par GeniusPay (API Merchant, page de paiement hébergée `checkout_url`). L'abonnement n'est activé ou renouvelé qu'**après vérification côté serveur**. Une redirection du navigateur ou un webhook signé ne suffisent jamais : chaque confirmation relit le paiement par `GET /payments/{reference}`.

Ce parcours ne concerne que l'abonnement. Il ne touche ni aux ventes ni aux paiements clients du commerce (`sale`, `payment`…) et ne partage aucune table avec eux.

**État : rien n'a été testé contre GeniusPay réel, même en sandbox.** Toutes les vérifications passent par un GeniusPay simulé (`src/test/fake-geniuspay.ts`), d'après la documentation lue le 2026-11-03. Avant la mise en production, il faut lever les points de la section 8 avec GeniusPay.

## 1. Parcours

1. **Facture.** `POST /api/business/subscription/checkout`, réservé au **propriétaire** (`subscriptionPaymentRoles = ["owner"]`). Il exige une clé d'idempotence fournie par le client et une formule active (`planCode`) en XOF d'au moins 200 F (sinon `422 amount_too_low`). Un commerce suspendu est refusé (`403 business_suspended`) ; un commerce expiré peut payer. La transaction verrouille le profil du commerce (`FOR UPDATE`), puis réutilise la facture `open` ou en crée une (`subscription_invoice`, une seule ouverte par commerce). Le montant, la devise XOF et la durée sont copiés de la formule au moment de la facture. La remise d'une campagne publique est déduite de la première facture (voir § 5 bis). Si une autre formule est choisie (ou si le prix ou la remise ont changé), la facture ouverte est annulée (`void`, audit `subscription.invoice_voided`), à condition qu'aucun paiement n'y soit en cours.
2. **Tentative.** Une ligne `subscription_payment` (`pending`, `provider = 'geniuspay'`) est liée à la facture.
3. **Checkout.** Appel de `POST /payments` sans `payment_method`. GeniusPay renvoie une `reference` (`MTX-…`) et une `checkout_url` (valable 24 h, HTTPS vérifié). Les métadonnées `qadr_invoice` et `qadr_attempt` sont envoyées. Le navigateur est redirigé vers `checkout_url`.
   - Même clé d'idempotence rejouée : la même tentative est renvoyée (200, `replayed`).
   - Paiement encore ouvert pour la même facture : il est d'abord relu, puis réutilisé (même `checkout_url`, `reused: true`) s'il lui reste au moins 10 minutes.
   - Paiement en cours pour **une autre** formule : `409 payment_in_progress`.
   - Échec de création chez GeniusPay (refus ou réseau) : la tentative passe `failed` (`init_<code>`) et la route répond `502 provider_unavailable`. Rien n'est activé.
4. **Retour.** `success_url` et `error_url` pointent vers `/business/subscription/return?attempt=<id>`, construites sur `BETTER_AUTH_URL`. La page affiche « paiement en cours de vérification » et interroge `GET /api/business/subscription/payments/[attemptId]` après 2, 3, 5, 5, 10 et 15 s, puis toutes les 30 s. Cette route :
   - relit GeniusPay au plus une fois toutes les 5 s par tentative ;
   - indique `verification: fresh | recent | unavailable | final` ;
   - répond 404 pour un identifiant inconnu, non UUID ou appartenant à un autre commerce.
5. **Confirmation**, par trois voies qui appliquent toutes la même fonction `applyProviderPayment` :
   - le webhook `POST /api/webhooks/geniuspay` (section 3) ;
   - la relecture déclenchée par la page de retour ;
   - le rapprochement du cron quotidien `/api/cron/subscriptions` : au plus 50 tentatives `pending` de plus de 10 minutes, dans un budget de 120 s (le reste, compté dans `deferred`, attend le passage suivant ; route `maxDuration = 300`), puis le passage d'expiration existant.
6. **Activation** (section 5), dans une seule transaction, avec un audit `subscription.payment_activated`. Les autres événements d'audit sont `subscription.invoice_created`, `subscription.payment_initiated`, `subscription.payment_failed` et `subscription.payment_anomaly`.

Dans `/business/subscription`, la carte « Payer en ligne » (`PayCard`) est placée au-dessus de la saisie de code. Elle n'est proposée qu'au propriétaire et seulement si GeniusPay est configuré ; sinon, l'écran l'annonce indisponible. Les textes sont traduits en fr, en et ar, avec RTL (propriétés logiques).

## 2. Configuration

Variables lues côté serveur uniquement (voir `apps/web/.env.example`) :

| Variable | Rôle |
| --- | --- |
| `GENIUSPAY_API_KEY` | En-tête `X-API-Key`. Le préfixe `pk_sandbox_` ou `pk_live_` fixe l'environnement. |
| `GENIUSPAY_API_SECRET` | En-tête `X-API-Secret`. |
| `GENIUSPAY_WEBHOOK_SECRET` | Secret `whsec_…` de vérification HMAC des webhooks. |
| `GENIUSPAY_BASE_URL` | Facultatif, à laisser vide. Défaut : `https://geniuspay.ci/api/v1/merchant`. HTTPS exigé, hôte limité à `geniuspay.ci`, `genius.ci` et leurs sous-domaines, sans identifiants dans l’URL (les clés y sont envoyées ; mission 15). |
| `BETTER_AUTH_URL` | Base des adresses de retour (HTTPS obligatoire en production). |
| `CRON_SECRET` | Protège `/api/cron/subscriptions`, qui lance aussi le rapprochement. |

Règles (`readGeniusPayConfig`, `getBillingProvider`) :
- Les trois secrets vont ensemble. S'il en manque un, le paiement est déclaré indisponible et le webhook répond 503.
- Une clé sandbox est refusée en production, sauf si `VERCEL_ENV=preview`. Une clé live est refusée hors production, et aussi sur tout déploiement Vercel dont `VERCEL_ENV` n'est pas `production` (mission 15 : Vercel fixe `NODE_ENV=production` en Preview).
- L'environnement de chaque paiement est enregistré. Un webhook ou une relecture dans un autre environnement est rejeté (`environment_mismatch`).

Le fournisseur est injecté (`fetchImpl`) : appels `fetch` directs, délai de 15 s, `redirect: "error"`, aucune dépendance npm ajoutée.

## 3. Webhook

`POST /api/webhooks/geniuspay` (`handleGeniusPayWebhook`) :
- **Refus sans secret** configuré (503). Corps limité à 64 Ko et lu **brut** (`request.text()`), avant tout `JSON.parse`.
- **Signature** : `HMAC-SHA256(secret, "<X-Webhook-Timestamp>.<corps brut>")`, attendue en hexadécimal (64 caractères) dans `X-Webhook-Signature`. La comparaison se fait en temps constant (`timingSafeEqual`), avec une tolérance de ±300 s sur l'horodatage. Une signature absente, mal formée ou fausse, ou un horodatage hors fenêtre, donne 401 sans rien écrire.
- **Déduplication** : l'événement est inséré dans `payment_provider_event` avec l'unicité `(provider, event_id)` (`ON CONFLICT DO NOTHING`). Un doublon déjà traité répond 200 sans retraitement. L'`event_id` est le champ `id` du payload signé, à défaut `sha256:<empreinte du corps brut>`. Les en-têtes non signés (`X-Webhook-Event`, `X-Webhook-Delivery`) ne sont pas utilisés.
- **Le webhook ne sert que de signal.** Le paiement est toujours relu par `GET /payments/{reference}`, puis on vérifie :
  - la référence ;
  - l'environnement ;
  - les métadonnées `qadr_attempt` et `qadr_invoice` ;
  - la devise XOF ;
  - le montant exact (en `bigint`).

  Toute discordance est enregistrée dans `outcome` (`amount_mismatch`, `currency_mismatch`, `reference_mismatch`, `environment_mismatch`, `metadata_mismatch`) et dans un audit `subscription.payment_anomaly`, sans activation.
- Si GeniusPay est injoignable pendant la relecture, l'événement reste `received`, sans date de traitement, et la route répond 503 : une relance du même événement est alors retraitée. Le cron rattrapera la tentative de toute façon.
- Un événement d'un autre environnement que la clé est conservé (`environment_mismatch`) sans effet. Un événement autre que `payment.*` ou sans référence valide est conservé comme `ignored`.
- Si la référence n'est pas encore enregistrée (création interrompue après la réponse de GeniusPay), la relecture peut la relier à la tentative grâce à `qadr_attempt` et `qadr_invoice`, à condition que cette tentative n'ait encore aucune référence.

### Événement à référence inconnue : choix retenu

`payment_provider_event.business_id` devient **nullable**. Un événement signé mais dont la référence ne correspond à aucune tentative est **conservé sans commerce** (`outcome = 'unmatched'`), puis la route répond 200.

- **Pourquoi le conserver** : garder une trace exploitable (paiement d'un autre système, erreur de configuration, tentative d'attaque signée), dédupliquer ses relances et éviter qu'un 4xx déclenche des relances sans fin.
- **Garde-fou** : la contrainte `provider_event_unattached_check` interdit de lier une cible à un événement sans commerce.
- **Déduplication globale** : elle passe à `(provider, event_id)`, car le commerce n'est pas connu au moment de l'insertion.
- **Isolation** : aucune donnée d'un commerce n'est lue ou écrite à partir d'un tel événement.

## 4. Pourquoi pas `runIdempotent`

`runIdempotent` (`operation-guard.ts`) appelle `assertBusinessOperational`, qui bloque un commerce expiré. Or un commerce expiré doit justement pouvoir payer pour se réactiver.

L'idempotence du checkout repose donc sur l'unicité `(business_id, idempotency_key)` de `subscription_payment`, et celle des confirmations sur les transitions d'état décrites ci-dessous, appliquées sous verrou. Dans les transactions, les verrous sont pris dans l'ordre tentative → profil → facture → abonnements.

## 5. Transitions et renouvellement

Statuts GeniusPay normalisés : `pending`/`processing` → `pending`, `completed` → `confirmed`, `failed`, `cancelled` → `canceled`, `expired`, `refunded`.

Transitions d'une tentative :
- `pending` → tout autre statut ;
- `confirmed` → `refunded` seulement ;
- `failed`, `canceled`, `expired` → `confirmed`, seulement si la relecture dit `completed` (paiement tardif) ;
- `refunded` est terminal.

Aucune régression n'est possible : un `failed` reçu après un `confirmed` est ignoré (`unchanged`).

Activation à la confirmation :
- **Même formule en cours** (`active` ou `trialing`) : la période est **prolongée à partir de sa fin**, jamais de la date du paiement, et `trialing` devient `active`.
- **Autre formule** : un nouvel abonnement commence à `max(maintenant, fin de la période en cours)`.
- **Abonnement `pending` de la même formule et rien en cours** : il est converti en `active`.
- Le profil `expired` repasse `active`. Une **suspension n'est jamais levée** par un paiement.
- **Facture déjà payée ou annulée** : la tentative est confirmée, mais l'abonnement n'est pas prolongé. Un audit `subscription.payment_duplicate` ou `subscription.payment_on_void_invoice` est écrit pour traitement manuel.

La console plateforme (`platform.ts`, filtre `billed`) exclut désormais aussi les tentatives `failed`, `canceled` et `expired`.

## 5 bis. Remise d'une campagne publique sur la première facture (bloc 2)

La remise réclamée à l'inscription (`promotion_redemption.discount_amount_xof`, voir `docs/promotions.md`) est déduite par `prepareCheckout`, sous le verrou du profil :

- **R1.** Seulement une campagne **publique** (`promotion_code.audience = 'public'`) avec une remise positive. Les codes privés ne donnent aucune remise sur facture.
- **R2.** Seulement sur la formule choisie à l'inscription (celle de l'abonnement de la réclamation). Une autre formule est facturée au prix plein.
- **R3.** Une seule fois : la remise reste disponible tant qu'**aucune** facture du commerce n'est payée. La première facture payée la consomme, même si elle porte sur une autre formule. Dans ce cas, la remise est perdue (l'interface le signale).
- **R4.** Montant figé lors de la réclamation, plafonné au prix actuel de la formule.
- **R5.** Si le montant net est inférieur au minimum GeniusPay (200 F), la demande est refusée (`422 amount_too_low`, message « contactez Qadr Agency »). Aucune facture n'est créée et rien n'est activé sans paiement.
- **R6.** Révoquer ou mettre en pause la campagne après l'inscription ne retire pas la remise déjà accordée. *Hypothèse à confirmer par le propriétaire.*

Effets sur la facture :

- `amount_xof` devient le **montant net**, celui qui est envoyé à GeniusPay et comparé lors de la vérification. Le prix brut vaut `amount_xof + discount_xof`.
- `discount_xof` et `promotion_redemption_id` gardent la trace de la remise.
- Contraintes SQL :
  - `subscription_invoice_discount_check` : une remise existe si et seulement si une réclamation est liée ;
  - FK composée `subscription_invoice_redemption_tenant_fk` : pas de réclamation d'un autre commerce ;
  - index unique `subscription_invoice_redemption_once_unique` : une réclamation ne sert qu'à une facture ouverte ou payée (une facture annulée la libère).
- Les audits `subscription.invoice_created` et `subscription.payment_activated` portent `discountXof` et `promotionRedemptionId`.
- `GET /api/business/subscription` renvoie `campaignDiscount: { planCode, discountXof, amountXof }` (propriétaire seulement), calculé par le serveur comme sur la facture. `openInvoice.discountXof` décrit la facture ouverte.

Migration : `drizzle/0021_campaign_discount_on_invoice.sql`. L'ordre de deux instructions a été corrigé à la main : la contrainte unique `promotion_redemption_business_id_unique` doit précéder la clé étrangère qui s'appuie sur elle. Le SQL et l'instantané restent ceux de `drizzle-kit generate`.

## 6. Schéma (migration 0018)

`drizzle/0018_subscription_billing_geniuspay.sql`, générée par `drizzle-kit generate`. **Aucun SQL manuel.**

- `subscription_invoice` (nouvelle) :
  - formule et montant figés, statut `open/paid/void`, période payée, auteur ;
  - unique `(business_id, id)`, FK composée vers `business_subscription` ;
  - index unique partiel « une seule facture ouverte par commerce ».
- `subscription_payment` :
  - `subscription_id` devient nullable ;
  - nouvelles colonnes `invoice_id` (FK composée), `provider`, `provider_status`, `environment`, `checkout_url`, `checkout_expires_at`, `checked_at`, `initiated_by_user_id` ;
  - statuts `canceled` et `expired` ; moyens `moov_money`, `card`, `unknown` ;
  - unicité globale `(provider, provider_reference)`, index des tentatives `pending`.
- `payment_provider_event` :
  - `business_id` devient nullable ;
  - nouvelles colonnes `event_type`, `provider_reference`, `environment`, `outcome` ;
  - unicité `(provider, event_id)`, index sur la référence.

Les migrations ne sont pas appliquées à Neon. Le numéro 0018 est provisoire : si un autre lot de la mission 12 génère aussi une migration, le lead doit renuméroter au moment de la fusion (fichier, `meta/_journal.json`, instantané).

## 7. Carte bancaire récurrente : non implémentée (D-12-2)

La « Subscription API » de GeniusPay (prélèvement automatique) ne fonctionne qu'avec Stripe, et la signature de ses webhooks n'est pas documentée. Elle n'est donc pas branchée. Chaque période se paie par un paiement ponctuel ; une carte peut servir de moyen de paiement sur la page hébergée (`payment_method` = `card`). Une reprise exigera une documentation de signature vérifiée et une décision du propriétaire.

## 8. Points GeniusPay à confirmer avant la production

La liste complète des questions, le message prêt à envoyer à GeniusPay et le protocole d'essai sandbox sont dans `docs/engineering/geniuspay-questions.md` (relecture de la documentation du 2026-11-04). Un webhook refusé indique dans le journal la variante de signature reconnue, sans jamais l'accepter. L'essai depuis l'aperçu local par Cloudflare Quick Tunnel est décrit dans `docs/engineering/geniuspay-sandbox-tunnel.md`.

- **URL de base** : la documentation cite `geniuspay.ci/api/v1/merchant`, le SDK `pay.genius.ci` et la Subscription API `api.geniuspay.ci`. Le défaut retenu est le premier ; il reste surchargeable par `GENIUSPAY_BASE_URL`.
- **Chaîne signée** : l'exemple PHP ré-encode le JSON au lieu de signer le corps brut. Nous signons et vérifions `timestamp + "." + corps brut`. L'encodage (hexadécimal présumé) est aussi à confirmer.
- **Statuts** : les listes diffèrent selon les pages (`cancelled`/`canceled`, `processing`, `expired`). Un statut inconnu ne change rien à la tentative et n'est donc jamais pris pour un succès.
- **Relances de webhook** : leur politique (nombre, délai) n'est pas documentée. Le cron quotidien sert de filet.
- **Identifiant d'événement** : le champ `id` du payload n'est pas nommé dans la documentation, et `X-Webhook-Delivery` est facultatif.
- **Préfixe de référence** : l'exemple de webhook montre `TXN-…`, l'API `MTX-…`. Le motif accepté est `[A-Za-z0-9_-]{1,64}`.
- **Moyens de paiement** : `mtn_money` ou `mtn_momo` ? Les deux sont acceptés à la lecture.
- **Champ `environment`** : sa présence et ses valeurs (`live` ou `production`) sont à confirmer. Depuis le correctif du 2026-11-04, un champ absent ou inconnu ne bloque plus : l'environnement retenu est celui de la clé qui relit le paiement. Une valeur `sandbox`/`live` différente de la clé reste une anomalie.

## 9. Limites connues

- Rien n'a été testé en réel (GeniusPay, Neon, Vercel Cron). L'interface n'a pas été vérifiée visuellement dans un navigateur.
- Seule la remise d'une **campagne publique** s'applique, une fois (§ 5 bis). Les remises des codes privés ne s'appliquent pas aux factures.
- Un remboursement (`refunded`) est enregistré, mais ne raccourcit pas automatiquement la période déjà accordée.
- Deux paiements réussis pour la même facture sont détectés (audit `payment_duplicate`), mais leur remboursement reste manuel.
- Le rapprochement ne tourne qu'une fois par jour (cron existant). Entre-temps, la page de retour et le webhook assurent la confirmation.
- Pas de console Super Admin pour les factures et les anomalies : celles-ci ne sont visibles que dans l'audit.

## 10. Tests

- `src/lib/billing/geniuspay.test.ts` : signature, tolérance, normalisation, configuration, appels simulés.
- `src/test/subscription-billing.http.test.ts` : parcours complet par le harnais PGlite (rôle, idempotence, réutilisation, échec de création, webhook signé et dédupliqué, montant ou métadonnées falsifiés, référence inconnue, absence de régression, renouvellement à partir de la fin, changement de formule, commerce expiré, cron).
- `src/test/campaign-invoice-discount.http.test.ts` : remise de campagne sur la première facture (montant net envoyé, réutilisation, activation, une seule fois, autre formule, perte de la remise, montant trop faible, contraintes SQL, réclamation d'un autre commerce).
- `src/test/tenant-isolation.http.test.ts` : un paiement de B est introuvable pour A, et A ne paie que sa propre facture.

Le faux GeniusPay remplace uniquement `fetch`, avec des valeurs de test évidentes. Tout appel vers une autre adresse échoue.

# Mission 12 — Consolidation, monétisation, GeniusPay, R2, Qadr Capture

Document de suivi vivant. Audit du 2026-11-03 sur la branche `feat/mission-11-fiabilisation` (dernier commit `a57a0d1`). Rien n'est poussé ; Neon n'a jamais été contacté.

## 1. État réel constaté (phase 0)

### Opérationnel et testé localement (PGlite)

- Cœur commercial : produits/variantes sans code-barres, unités libres, stock par mouvements, stock de départ, ventes avec paiements mixtes et crédit, dettes de départ, fournisseurs, achats/réceptions, dépenses, inventaires, sessions de caisse, reçus et réimpression idempotente, rapports, exports CSV/XLSX/PDF. Isolation A→B testée par route (`tenant-isolation.http.test.ts`).
- Abonnements : tables `subscription_plan` (prix, durée, `features`, quotas), `business_subscription` (machine à états `pending/trialing/active/suspended/expired/canceled`, `subscription-lifecycle.ts`), `promotion_code` (`discount`/`access`, lots, révocation), `promotion_redemption` (une fois par commerce), quotas `plan-limits.ts`, console Super Admin, saisie d'un code par le commerçant (`/business/subscription`).
- Fuseau du commerce : `useBusinessTimeZone()` sur les écrans métier (mission 11).
- Pagination serveur par curseur sur 7 listes ; interface « Charger la suite » branchée sur clients et fournisseurs (`a57a0d1`).

### Partiel

- `subscription_payment` et `payment_provider_event` existent mais **aucun prestataire n'est branché** : pas de facture d'abonnement, pas d'adaptateur, pas de route webhook. Les moyens autorisés (`wave/orange_money/mtn_momo/other`) ne couvrent ni la carte ni Moov.
- Pagination : interface absente pour stock, ventes, achats, dépenses.
- Écran clients/fournisseurs : textes français en dur (visibles en arabe).
- Qadr Capture : CSV/XLSX de catalogue seulement. Les fichiers ne sont **pas conservés** (seuls nom, taille et SHA-256 sont en base). PDF/photos désactivés (D-03).

### Absent

- Campagnes promotionnelles **publiques** (avant inscription) : aucune séparation avec les codes privés, aucune API publique, pas de page Pricing.
- Stockage de fichiers (R2 ou autre) : variables commentées dans `.env.example`, aucun code.
- Connexion de migration distincte pour Neon (`drizzle.config.ts` lit seulement `DATABASE_URL`).

## 2. GeniusPay — ce que dit la documentation officielle (lue le 2026-11-03)

Sources : `geniuspay.ci/docs/api`, `/docs/subscription-api`, `/docs/sdk`.

| Point | Documenté | Conséquence pour Qadr Ops |
| --- | --- | --- |
| API Merchant `POST /api/v1/merchant/payments` | Oui. En-têtes `X-API-Key` (pk_) et `X-API-Secret` (sk_). Montant XOF ≥ 200. `metadata` renvoyée. Réponse : `reference` `MTX-…`, `checkout_url` (24 h). | Paiement à l'unité d'une facture d'abonnement. |
| Sandbox | Par préfixe de clé (`pk_sandbox_`/`sk_sandbox_`), même URL. | Pas d'URL dédiée ; l'environnement se lit sur la clé. |
| URL de base | `https://geniuspay.ci/api/v1/merchant` (API) mais `https://pay.genius.ci/api/v1/merchant` (SDK Java) et `api.geniuspay.ci` (Subscription). | **Incohérence** : URL configurable, à confirmer avec GeniusPay. |
| Vérification | `GET /payments/{reference}` (statut, montant, frais, metadata). | Toute activation est confirmée par cet appel, jamais par la redirection. |
| Statuts | `pending, processing, completed, failed, cancelled, refunded` + `expired` (listes incohérentes). | Statut inconnu = non payé. |
| Webhook | Événements `payment.success/failed/cancelled/refunded/expired…`. En-têtes `X-Webhook-Signature`, `X-Webhook-Timestamp`, `X-Webhook-Event`. HMAC-SHA256 de `timestamp + "." + payload`, secret `whsec_…`, tolérance 300 s. | Signature vérifiée sur le **corps brut** ; ambiguïté (corps brut ou JSON ré-encodé, encodage hex) → la signature seule ne suffit jamais : l'état est relu par l'API avant d'agir. |
| Remboursement | Aucun endpoint ; seulement l'événement `payment.refunded`. | Remboursement manuel côté GeniusPay, constaté par événement + vérification. |
| Récurrent (Subscription API) | **Carte via Stripe uniquement** (`stripe_card`, `stripe_checkout`). Mobile Money non documenté pour le récurrent. Signature des webhooks d'abonnement **non documentée**. | Mobile Money : renouvellement initié par le client (nouvelle facture). Carte récurrente : **non activée** tant que la signature n'est pas documentée et le compte autorisé (décision propriétaire). |
| Moyens | `wave, orange_money, mtn_money, moov_money, airtel_money, card, …` (`mtn_money` vs `mtn_momo` incohérents). | Le parcours hébergé (`checkout_url`, sans `payment_method`) évite de figer ces noms. |
| Limites, relances, licence des SDK | Non documentées. | Pas de SDK : appel HTTP direct (pas de dépendance). |

## 3. Décisions de cette mission

- **D-12-1** Paiement des abonnements : GeniusPay API Merchant, parcours hébergé (`checkout_url`), une facture d'abonnement par période. Activation seulement après relecture `GET /payments/{reference}` (statut `completed`, montant, devise, référence et facture identiques). La redirection de succès n'affiche qu'« en cours de vérification ».
- **D-12-2** Carte récurrente (Subscription API/Stripe) : reportée, faute de signature de webhook documentée.
- **D-12-3** Fichiers : R2 privé derrière un service `FileStorage` (adaptateur R2 en S3 SigV4 écrit sans SDK, adaptateur mémoire pour les tests). Métadonnées en base, accès par URL signée courte après contrôle du commerce.
- **D-12-4** Codes publics et privés séparés par un attribut `audience` (`public`/`private`) sur `promotion_code` : l'historique reste dans la même table, chaque parcours refuse l'autre audience.
- **D-12-5** Aucun prix, durée de grâce ou offre n'est inventé : valeurs administrables, défauts prudents documentés.

## 4. Décisions qui restent au propriétaire

1. Prix et contenu des formules (rien n'est créé en dur).
2. Période de grâce après échéance et restrictions d'un commerce `pending`/expiré (aujourd'hui : non bloqué pour `pending`).
3. Activation de la carte récurrente via la Subscription API.
4. Confirmation par GeniusPay : URL de base officielle, chaîne signée exacte (corps brut, encodage hex/base64), politique de relance des webhooks.
5. Fournisseur OCR/HTR (D-03 : local d'abord).
6. O-1 (imprimante d'un commerce suspendu).
7. *Proposition L4, non validée* (`docs/qadr-capture-models.md`) : 1) PDF textuels natifs lus dans Vercel, sans OCR ; 2) OCR imprimé local (PaddleOCR PP-OCRv5 ou Tesseract, départagés par un banc) dans un conteneur séparé ; 3) manuscrit seulement après benchmark, l'éventuel essai d'API hébergée étant fait sur corpus synthétique et budget plafonné. À trancher aussi : D-03 (`decisions.md`) prévoit un fournisseur externe pour les photos, alors que le point 5 ci-dessus dit « local d'abord ».

## 5. Lots et ordre d'exécution

Les lots qui modifient `schema.ts` ne génèrent qu'une migration chacun ; elles sont renumérotées au moment de la fusion.

| Lot | Contenu | Migration | Dépend de |
| --- | --- | --- | --- |
| L1 Facturation | campagnes publiques (vérification publique, réservation à l'inscription, quotas concurrents) puis GeniusPay (factures, adaptateur, webhook, vérification, rapprochement) | oui | — |
| L2 Stockage | service `FileStorage`, adaptateur R2 SigV4, métadonnées, URL signées, rétention, conservation de l'original des imports | oui | — |
| L3 Interface | pagination stock/ventes/achats/dépenses, traduction de l'écran clients/fournisseurs | non | — |
| L4 Capture (étude) | comparatif OCR/HTR/embeddings : licences, langues, coût, matériel ; protocole et corpus synthétique d'évaluation | non | — |
| L5 Capture (parcours) | PDF textuels et photos stockés dans R2, extraction locale, revue humaine | oui | L2, L4, décision 5 |
| L6 Neon / Vercel | URL de migration non poolée, procédure de première connexion, variables | non | accès du propriétaire |
| L7 QA | revue indépendante de chaque fusion, isolation A→B des nouvelles routes | — | chaque lot |

## 6. Journal

- 2026-11-03 : audit, lecture GeniusPay, lancement de L1 à L4.

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
5. Fournisseur OCR/HTR. D-03 (`decisions.md`) : CSV, XLSX et PDF texte lus localement ; photos et manuscrit via un fournisseur externe derrière un adaptateur, désactivé tant que fournisseur, budget et clé ne sont pas validés.
6. O-1 (imprimante d'un commerce suspendu).
7. *Proposition L4, non validée* (`docs/qadr-capture-models.md`) : 1) PDF textuels natifs lus dans Vercel, sans OCR ; 2) OCR imprimé local (PaddleOCR PP-OCRv5 ou Tesseract, départagés par un banc) dans un conteneur séparé ; 3) manuscrit seulement après benchmark, l'éventuel essai d'API hébergée étant fait sur corpus synthétique et budget plafonné. L'étape 2 (OCR imprimé local) s'écarte de D-03, qui confie les photos à un fournisseur externe : à trancher par le propriétaire.

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
- 2026-11-03 : L4 fusionné (`docs/qadr-capture-models.md`), L3 fusionné (ventes, achats, dépenses, clients, fournisseurs paginés et traduits).
- 2026-11-04 : L1b fusionné (migration 0018, `docs/billing-geniuspay.md`) ; correctif : `environment` absent de `GET /payments/{reference}` ne bloque plus l'activation. L2 fusionné (migration renumérotée 0019, `docs/storage-r2.md`, `DATABASE_URL_UNPOOLED` pour les migrations). L1a fusionné (migration renumérotée 0020, `docs/promotions.md`). Migrations régénérées à la fusion, SQL identique à celui des lots.
- 2026-11-04 : vérification navigateur sur l'aperçu local (PGlite, fr et ar) : abonnement sans paiement en ligne configuré, page de retour (paiement inconnu), console des campagnes (création, modification, arabe), code à l'inscription (`?promo=`, vérification, arabe), original d'un import (téléchargement identique octet pour octet, adaptateur mémoire). Quatre défauts corrigés (`8ae2c76`) : ligne de campagne écrasée, date de campagne décalée d'un jour à l'est de Greenwich, `?promo=` perdu au passage par la connexion, en-tête débordant entre lg et xl. Non vérifié : paiement GeniusPay réel (aucune clé), R2 réel, création effective d'un commerce avec le code.
- 2026-11-04 : remise d'une campagne publique déduite de la première facture (migration 0021, `docs/billing-geniuspay.md` § 5 bis). `amount_xof` devient le montant net. La remise ne sert qu'une fois et seulement sur la formule choisie à l'inscription. Un montant net inférieur à 200 F est refusé. Le montant est affiché par le serveur sur `/business/subscription`. Vérifié dans l'aperçu local (configuration `qadr-web-preview-billing-display` : fausses clés de test, adresse GeniusPay en `.invalid`) en français et en arabe sur mobile. Le parcours complet a été suivi : inscription avec `?promo=`, création du commerce, affichage de la remise et du montant net. Aucun paiement n'a été tenté.
- 2026-11-04 : documentation GeniusPay relue (API, SDK, Subscription API). Points toujours ouverts, plus trois nouveaux : `X-Webhook-Delivery`, `X-Webhook-Environment`, `payment_url` ou `checkout_url`. Dix-neuf questions rédigées, avec un message pour GeniusPay et un protocole sandbox (`docs/engineering/geniuspay-questions.md`). Diagnostic ajouté : un webhook refusé nomme la variante de signature reconnue (encodage, chaîne signée, horodatage en ms), sans jamais l'accepter.

## 7. Suite (bloc 2)

1. ~~Déduire la remise d'une campagne publique de la première facture d'abonnement~~ (fait le 2026-11-04, voir §6). Reste à trancher par le propriétaire : remise perdue si une autre formule est payée d'abord, remise maintenue après révocation de la campagne.
2. Faire confirmer par GeniusPay les points du §2 (signature exacte, URL de base, statuts, relances), puis un essai sandbox autorisé par le propriétaire sur une préproduction HTTPS. Questions, message prêt à envoyer et protocole : `docs/engineering/geniuspay-questions.md`. **En attente du propriétaire** : envoi du message, clés sandbox, préproduction Vercel.
3. Bucket R2 de test créé par le propriétaire, puis aller-retour réel (import, téléchargement, abandon, purge).
4. ~~Vérification navigateur des nouveaux parcours~~ (faite le 2026-11-04, voir §6). Le parcours complet d'inscription avec le code, jusqu'à la création du commerce, a été vérifié avec la remise. Reste le paiement sandbox (point 2).
5. L5 (Qadr Capture) : PDF textuels natifs stockés dans R2, après décision du propriétaire sur le point 7 du §4.

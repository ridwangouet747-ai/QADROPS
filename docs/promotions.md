# Promotions : codes privés et campagnes publiques (mission 12, lot L1a)

Qadr Ops a **deux systèmes promotionnels séparés**, rangés dans la même table `promotion_code` et distingués par la colonne `audience` (décision D-12-4) :

| | Code privé (`audience = 'private'`) | Campagne publique (`audience = 'public'`) |
| --- | --- | --- |
| Usage | Dans l'application, par un commerce existant (`/business/subscription`) | **Seulement à l'inscription**, au moment où le commerce est créé |
| Création | Console Super Admin, en série (`/api/platform/promotions/batch`) | Console Super Admin, un code lisible choisi par l'administrateur |
| `kind` | `access` (jours offerts) ou `discount` | `campaign` |
| Route | `POST /api/business/subscription/promotion` (inchangée) | `POST /api/public/campaigns/check` puis le champ `promotion` de `POST /api/account/businesses` |

Les codes privés existants n'ont pas changé : la migration donne `audience = 'private'` à toutes les lignes existantes (valeur par défaut). Aucun historique n'est modifié ni supprimé.

**Séparation stricte.**
- La route privée refuse un code public. Elle répond exactement comme pour un code inconnu (`invalid`, 404), avant même de regarder un éventuel rejeu.
- La liste et les actions privées de la console ignorent les campagnes : un identifiant de campagne y répond 404.
- Le parcours d'inscription refuse un code privé : la vérification publique renvoie la réponse générique, et la réclamation n'applique rien.

## Modèle (migration `0018_public_campaigns.sql`)

> Numéro local : la migration sera renumérotée à la fusion si un autre lot ajoute la sienne avant.

- `promotion_code` : nouvelles colonnes `audience` (`private` par défaut), `public_description` (jsonb `{ fr, en, ar }`) et `updated_at`. Le `kind` peut maintenant valoir `campaign`.
- Contraintes SQL d'une campagne, pour `kind = 'campaign'` (`promotion_discount_check`) :
  - `plan_id` est nul : les formules passent par la table de liaison ;
  - `grant_days` est nul ou compris entre 1 et 3650 ;
  - la remise est soit un pourcentage (1 à 100), soit un montant XOF strictement positif, jamais les deux ;
  - au moins un avantage est défini.
- Contrainte `promotion_audience_check` :
  - un code privé est de type `discount` ou `access` ;
  - un code public est de type `campaign` et a un nom interne (`campaign`) et une description.
- `promotion_eligible_plan` : formules éligibles d'une campagne. FK vers `promotion_code` et `subscription_plan`, clé primaire composée.
- `promotion_redemption.redeemed_by_user_id` : FK vers `user`, nullable pour l'historique. L'index unique partiel `(promotion_id, redeemed_by_user_id)` limite une campagne à une réclamation **par compte**.
- Réclamations : une fois par commerce, par la contrainte unique existante sur la réclamation.
- Aucun SQL manuel : la migration est entièrement générée par `drizzle-kit generate`. Elle n'a jamais été appliquée à Neon.

L'état d'une campagne est calculé comme pour un code privé (`promotionState`) : `active`, `paused`, `scheduled`, `expired`, `exhausted`, `revoked`. Le quota est `max_redemptions`, vide pour illimité. Le compteur est le nombre de lignes de `promotion_redemption`.

**Valeurs commerciales (D-12-5).** Aucune campagne n'est créée par une migration ou par du code. Jours offerts, remises, quotas, dates et formules sont saisis par le Super Admin. Le dépôt ne fixe aucune valeur.

## Vérification publique : `POST /api/public/campaigns/check`

Cette route sert l'inscription aujourd'hui et la future page Pricing. Elle est sans session, ne consomme rien et n'écrit rien en base.

**Entrée.**
- Corps JSON strict : `{ "code": "LANCEMENT", "planCode": "PRO" }`. `planCode` est facultatif.
- Le code et la formule sont mis en majuscules. Le code fait 3 à 40 caractères, la formule 2 à 32, et l'alphabet est `[A-Z0-9_-]`.
- En-tête `x-turnstile-token` : jeton du widget Turnstile, action `promotion-check`. Il est exigé dès que les clés sont configurées, donc toujours en production.

**Réponses.** Toutes portent `cache-control: no-store`.

| Statut | Corps | Sens |
| --- | --- | --- |
| 200 | `{ "valid": true, … }` | Offre affichable (détail ci-dessous) |
| 200 | `{ "valid": false }` | **Réponse unique pour tout refus** : code inconnu, privé, expiré, programmé, en pause, révoqué, complet, formule non éligible, aucune formule active |
| 400 | `{ error, code: "validation" }` | Corps illisible ou hors format |
| 400 | `{ error, code: "turnstile_failed" }` | Jeton Turnstile absent ou refusé |
| 429 | `{ error, code: "rate_limited" }` | Plus de 20 essais en 10 minutes pour cette adresse IP ; l'en-tête `Retry-After` donne l'attente |

Une offre valable renvoie les champs suivants :

```json
{
  "valid": true,
  "code": "LANCEMENT",
  "description": { "fr": "…", "en": "…", "ar": "…" },
  "endsAt": "2026-12-31T23:59:59.000Z",
  "advantage": { "grantDays": 21, "discountPercent": null, "discountXof": null },
  "plans": [{ "code": "STARTER", "name": "Starter" }, { "code": "PRO", "name": "Pro" }],
  "plan": { "code": "PRO", "name": "Pro", "discountAmountXof": "3000" }
}
```

- `plans` liste les seules formules **actives** éligibles, de la moins chère à la plus chère.
- `plan` est la formule retenue : celle qui a été demandée, ou la seule éligible. Il vaut `null` quand plusieurs formules sont possibles et qu'aucune n'a été choisie.
- `discountAmountXof` est une chaîne d'entiers, calculée sur le prix de la formule. Le pourcentage est arrondi à l'unité et le montant est plafonné au prix, comme pour les codes privés. La valeur est `null` sans remise.
- Rien d'interne ne sort : ni état, ni quota, ni compteur, ni existence d'un code privé.

**Limite de tentatives.** `publicCampaignCheckLimiter` (`src/lib/rate-limit.ts`) applique la limite par IP. L'adresse est lue par `clientIpFrom`, qui prend `cf-connecting-ip` puis `x-forwarded-for`. Le compteur est **en mémoire locale de chaque instance** : sur Vercel, avec plusieurs instances, la limite réelle est multipliée par leur nombre. C'est suffisant contre un script naïf, pas contre un attaquant distribué. Turnstile reste la protection principale. Une limite partagée demandera un stockage commun (base ou KV), à décider.

### Contrat pour la future page Pricing

1. Afficher le code, ou un champ de saisie, avec le widget Turnstile action `promotion-check`.
2. Appeler `POST /api/public/campaigns/check` avec le code et la formule affichée. Montrer `description[locale]`, l'avantage et `plan.discountAmountXof`.
3. Envoyer vers l'inscription avec `/register?promo=CODE&plan=PLAN`. Le parcours préremplit le champ sans le vérifier : un nouveau jeton Turnstile sera demandé.
4. Ne jamais présenter l'avantage comme acquis. Seule la création du commerce l'applique, et elle peut le refuser (voir plus bas).

## Réclamation atomique à la création du commerce

`POST /api/account/businesses` accepte un champ facultatif `promotion: { code, planCode? }`. La réclamation se fait **dans la transaction qui crée le profil du commerce** : crochet Better Auth `afterCreateOrganization` (`src/lib/auth/server.ts`), puis `claimPublicCampaignSafely`.

1. Verrou `SELECT … FOR UPDATE` sur la ligne de la campagne. Deux inscriptions qui visent la même campagne sont sérialisées.
2. Revérification complète côté serveur : type public, état, dates, quota (compté sous le verrou), formule éligible et active.
3. Formule obligatoire. Si plusieurs formules sont éligibles et qu'aucune n'est choisie, rien n'est appliqué.
4. Une seule réclamation par compte. Un même utilisateur peut créer plusieurs commerces, mais une campagne ne lui profite qu'une fois. La contrainte unique sert de seconde défense.
5. L'abonnement est créé selon les états de la machine à états (`origin = 'promotion'`) :
   - avec des **jours offerts**, un abonnement `trialing` naît sur la formule, `trial_ends_at` valant maintenant plus N jours ;
   - avec une **remise seule**, l'abonnement est `pending` sur la formule et la remise est conservée dans `promotion_redemption.discount_amount_xof`. Elle est déduite de la première facture d'abonnement payée de cette formule (`docs/billing-geniuspay.md` § 5 bis). Aucun `subscription_payment` n'est créé ici et aucun encaissement n'est simulé ;
   - avec les deux, l'essai démarre et la remise est conservée pour la première facture.
6. La réclamation porte `redeemed_by_user_id`, et l'audit `subscription.campaign_claimed` est écrit.

La réclamation s'exécute dans un point de sauvegarde. Une erreur imprévue annule la seule réclamation, jamais la création du commerce : elle est journalisée avec le seul nom de l'erreur et donne un audit de refus de motif `error`.

**Réponse.** La réponse de `POST /api/account/businesses` contient `promotion` :
- `null` sans code ;
- `{ "status": "applied", "replayed", "code", "plan": { code, name }, "grantDays", "subscriptionStatus", "endsAt", "discountAmountXof" }` ;
- `{ "status": "unavailable" }`.

### Comportement retenu : code devenu invalide entre la vérification et la création

**Le commerce est créé sans l'avantage, et l'écran de bienvenue le dit** (« Le code n'a pas pu être appliqué… votre commerce est créé sans avantage »).

C'est le cas d'une campagne complète, mise en pause, expirée ou révoquée entretemps, d'une formule désactivée, ou d'un compte qui a déjà profité de la campagne.

Raisons :
- Better Auth crée l'organisation et le membre **avant** le crochet, hors de notre transaction. Lever une erreur dans le crochet laisserait une organisation orpheline sans profil.
- Un commerçant ne doit pas perdre toute sa saisie pour une offre promotionnelle.

Chaque refus écrit `subscription.campaign_claim_refused`, avec le motif interne et l'identifiant de la campagne, **jamais le code**. Les motifs sont : `invalid_input`, `unknown`, `private`, `paused`, `scheduled`, `expired`, `exhausted`, `revoked`, `no_plan`, `plan_not_eligible`, `plan_required`, `account_already_claimed` et `error`.

**Rejeu.** La même clé de création (`creationKey`) renvoie le même commerce et la réclamation déjà faite (`replayed: true`), jamais une seconde. Une inscription interrompue puis reprise ne peut donc pas consommer deux places.

**Concurrence.** Deux inscriptions simultanées pour la dernière place donnent une seule réclamation : l'une reçoit `applied`, l'autre `unavailable` avec le motif d'audit `exhausted`. Sur PGlite, les transactions sont sérialisées par un verrou d'exclusion, donc le test vérifie la logique et non de vrais verrous de ligne concurrents. Le comportement sur Neon reste à mesurer en préproduction (B-1).

## Interface

**Inscription** (`src/components/onboarding/promo-code-box.tsx`)
- À l'étape récapitulative, un lien discret « Vous avez un code promotionnel ? » ouvre le champ, le widget Turnstile et le bouton « Vérifier ».
- L'avantage s'affiche avec la description traduite, la remise sur la formule et la date de fin. Si plusieurs formules sont éligibles, l'utilisateur en choisit une.
- Le code retenu est gardé dans le brouillon de session, sans mot de passe, puis envoyé avec la création.
- L'écran de bienvenue affiche le résultat : essai jusqu'au…, remise conservée pour le premier paiement, ou non appliqué.
- `?promo=` et `?plan=` préremplissent le champ.
- Les textes sont dans `wizard.promo.*` (fr, en, ar). Les noms de formule et les montants sont isolés pour le texte bidirectionnel.

**Console Super Admin** (`src/components/platform/platform-campaigns.tsx`, style monochrome `pf-*`)
- `/platform/promotions` propose deux onglets : « Codes privés » et « Campagnes publiques ».
- La liste montre l'état, l'avantage, les formules, les dates, le compteur et le reste.
- Le formulaire de création et de modification couvre :
  - le code et le nom interne ;
  - les descriptions fr, en et ar ;
  - les formules (cases à cocher) ;
  - les jours offerts, la remise (aucune, pourcentage ou montant) et le quota ;
  - les dates et l'activation.
- La fiche détaillée donne l'historique des réclamations : commerce, formule, état de l'abonnement, remise et date.
- Désactivation, réactivation et révocation demandent un motif d'au moins 5 caractères.

**Routes Super Admin.** Toutes passent par `getPlatformContext` : sans session, 401 ; avec une session sans droit plateforme, 404 sans aucune écriture.
- `GET` et `POST /api/platform/campaigns` ;
- `GET` et `PATCH /api/platform/campaigns/{id}` ;
- `POST /api/platform/campaigns/{id}/status` avec `{ action: "pause" | "resume" | "revoke", reason }`.

Règles de modification :
- le code ne change plus après une première réclamation ;
- le quota ne peut pas descendre sous le nombre de réclamations ;
- une campagne révoquée n'est plus modifiable ;
- les formules doivent exister et être actives.

**Audit** (`audit_event`, ajout seul) :
- `platform.campaign_created` ;
- `platform.campaign_updated`, avec l'avant et l'après des seuls champs modifiés ;
- `platform.campaign_paused`, `platform.campaign_resumed` et `platform.campaign_revoked`, avec le motif ;
- `subscription.campaign_claimed` et `subscription.campaign_claim_refused`.

## Tests

`src/test/public-campaigns.http.test.ts` utilise le harnais HTTP sur PGlite, sans autre simulacre. Il couvre :
- un code valable, qui ne consomme rien ;
- les réponses génériques identiques : inconnu, expiré, en pause, révoqué, complet, formule non éligible, programmé, privé, mal formé ;
- les formules multiples et le montant de la remise ;
- la réclamation d'un essai, avec audit et `redeemed_by_user_id` ;
- la dernière place disputée ;
- la double soumission et le rejeu ;
- une réclamation par compte ;
- l'inscription interrompue puis reprise ;
- la séparation privé/public dans les deux sens ;
- le fonctionnement inchangé des anciens codes privés ;
- la limite de tentatives ;
- l'administration : création, modification, compteur, historique, pause et reprise, audit ;
- le refus d'un non-Super-Admin et d'un anonyme.

Autres tests :
- `wizard.test.ts` : le code dans le brouillon et dans la charge utile ;
- `client-ip-headers.test.ts` : `clientIpFrom` ;
- `pglite-migrations.integration.test.ts` : 19 migrations, la nouvelle table et `audience` par défaut à `private`.

## Limites connues

- Limite de tentatives en mémoire par instance : voir plus haut.
- La remise d'une campagne est déduite une seule fois, sur la première facture payée de la formule choisie (`docs/billing-geniuspay.md` § 5 bis). Si une autre formule est payée d'abord, la remise est perdue. Une campagne révoquée après l'inscription ne retire pas la remise (hypothèse à confirmer).
- La concurrence réelle sur Neon, avec plusieurs connexions et des verrous de ligne, n'a pas été mesurée (B-1).
- Pas de page Pricing ni de page d'atterrissage : seul le contrat ci-dessus est fourni.
- Le parcours dans le navigateur (Turnstile réel, affichage RTL du champ) n'a pas été vérifié de bout en bout par une session de navigateur dans ce lot. Les tests couvrent l'API et les fonctions pures.

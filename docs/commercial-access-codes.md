# Codes d'accès commerciaux (domaine A)

Mise en place : 2026-11-16. Code : `apps/web/src/lib/domain/commercial-codes.ts`, `lib/security/access-codes.ts`,
`lib/commercial/` (mode, laissez-passer, garde des routes publiques), migration `0026_commercial_and_invite_codes.sql`.
Tests : `src/lib/security/access-codes.test.ts`, `src/test/commercial-access-codes.http.test.ts`,
`src/test/geniuspay-pause.http.test.ts`, `src/lib/commercial/mode.test.ts`.

## 1. Parcours

1. Le visiteur découvre l'offre Standard sur la page publique et écrit à Qadr Agency par WhatsApp (message prérempli,
   numéro lu dans `QADR_WHATSAPP_NUMBER` ; sans numéro valide, aucun lien WhatsApp n'est affiché).
2. Il paie hors ligne. **Qadr Agency vérifie le paiement à la main** ; rien dans Qadr Ops ne le confirme.
3. Le propriétaire de la plateforme génère un code dans la console (`/platform`, onglet des codes d'accès) :
   formule, durée, date limite d'activation, référence interne facultative (n° de reçu, jamais de donnée bancaire).
   Le code brut (`QADR-XXXX-XXXX-XXXX-XXXX`) s'affiche **une seule fois**, avec un bouton de copie.
4. Le client saisit le code sur `/redeem-code` **ou directement dans l'inscription** (`/register`, `/onboarding` : la
   barrière affiche le champ depuis le 2026-11-27, composant partagé `components/commercial/access-code-check.tsx`).
   Un code valide pose un laissez-passer signé (cookie `qadr-access-pass`, `__Host-` en HTTPS, 2 h) ; l'inscription relit
   ce laissez-passer et ouvre ses étapes ; un compte existant passe directement à la création du commerce.
5. L'inscription (`databaseHooks.user.create.before`) et la création du commerce exigent ce laissez-passer.
   Le code est consommé **dans la transaction qui crée le commerce et son abonnement** : si l'un échoue, rien n'est écrit
   et le code reste utilisable.
6. Le commerçant arrive à l'accueil puis au tableau de bord. Pour un renouvellement, il saisit un nouveau code dans
   `/business/subscription` (propriétaire ou administrateur seulement).

## 2. Mode de commercialisation

`QADR_COMMERCIAL_MODE` (serveur seulement, `lib/commercial/mode.ts`) :

| Valeur | Effet |
| --- | --- |
| absente, `manual_code` ou toute valeur inconnue | **Défaut.** Aucun paiement en ligne proposé ni appelé ; un retour de paiement n'active rien ; le webhook GeniusPay vérifie sa signature et met l'événement de côté sans accorder de droit. |
| `geniuspay` | Paiement en ligne de l'abonnement (`docs/billing-geniuspay.md`), seulement sur décision du propriétaire, clés posées. |

`accessCodeRequired()` : en mode `manual_code`, un code est exigé sur tout déploiement (`VERCEL_ENV` = `production`
ou `preview`, ou `NODE_ENV=production`). En local et dans les tests, seulement avec `QADR_ACCESS_CODE=required`
(configuration d'aperçu `qadr-web-preview-access-codes`). `QADR_ACCESS_CODE=optional` n'a aucun effet sur un déploiement.

## 3. Règles du code

- **Format** : préfixe `QADR`, 16 symboles de l'alphabet `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (sans 0/O, 1/I/L), environ
  79 bits. Saisie tolérante (minuscules, espaces, tirets).
- **Stockage** : seulement `HMAC-SHA256(clé, code normalisé)` (contrainte unique) et un indice de 4 caractères pour la
  liste. La clé est dérivée par HKDF de `QADR_CODE_SECRET` (à défaut `BETTER_AUTH_SECRET`, 32 caractères au moins),
  avec une étiquette par famille. **Changer ce secret rend inutilisables tous les codes non encore utilisés.**
  Sur un déploiement, l'absence de secret fait échouer la génération et la vérification (jamais de clé de repli).
- **Durées** : 7 jours, 21 jours, 1 mois, 3 mois, ou personnalisée (jours). Un mois est un mois du calendrier :
  31 janvier + 1 mois = 28 ou 29 février ; dates en UTC.
- **Deux dates distinctes** : la date limite d'activation (30 jours par défaut ; au-delà, le code est « Expiré ») et la
  durée d'accès, qui ne court qu'à partir de l'activation.
- **États** : Inutilisé, Utilisé, Expiré, Révoqué (priorité : utilisé, puis révoqué, puis expiré).
- **Usage unique** : consommation par une mise à jour conditionnelle (`consumed_at is null`) sous verrou ; deux
  activations simultanées donnent une réussite et un 409. Rejouer la même création (`creationKey`) rend `replayed`.
- **Renouvellement** : abonnement en cours de la même formule → prolongé à partir de **sa** fin ; aucun abonnement en
  cours → nouvelle période à partir de l'activation ; abonnement en cours d'une autre formule → 409
  `incompatible_subscription` (le code reste utilisable).
- **Révocation** : motif obligatoire (5 caractères au moins) ; un code déjà utilisé ne se révoque pas (409).
- **Lots** : 20 codes au plus par génération.

## 4. Routes

| Route | Qui | Rôle |
| --- | --- | --- |
| `POST /api/public/access-codes/check` | public (Turnstile, limites) | Valide un code et décrit la formule et la durée. |
| `POST /api/public/access-codes/pass` | public (Turnstile, limites) | Valide et pose le laissez-passer. |
| `POST /api/account/businesses` | compte connecté | Crée le commerce et consomme le code (efface le laissez-passer). |
| `POST /api/business/subscription/promotion` | propriétaire, administrateur | Renouvelle avec un code `QADR-` (même service). |
| `GET/POST /api/platform/access-codes`, `POST …/[codeId]/revoke` | propriétaire de la plateforme | Liste, génération, révocation. Autre utilisateur : 404. |

Erreurs (`{ error, code }`, messages génériques) : `invalid` 404 (identique pour un code inconnu, mal formé ou d'une
autre famille de hachage), `already_used` 409, `expired` 410, `revoked` 410, `invite_code` 422 (code `EQP-` saisi au
mauvais endroit), `access_code_required` 403, `incompatible_subscription` 409, `rate_limited` 429.

## 5. Protection contre les essais

`rateRules` : `code.commercial.ip` (10 / 15 min), `code.commercial.account` (10 / 15 min), `code.commercial.global`
(300 / 15 min). Seuls les échecs consomment le quota. Chaque refus est tracé dans l'audit
(`platform.commercial_code_rejected`, motif et client, **jamais le code saisi**). Génération
(`platform.commercial_code_created`), révocation (`platform.commercial_code_revoked`) et activation
(`subscription.commercial_code_activated`) sont aussi auditées.

## 6. Limites connues

- Le paiement est vérifié hors de Qadr Ops : un code émis par erreur donne un accès réel. La révocation n'agit que sur un
  code non utilisé ; un accès déjà ouvert se suspend depuis la console (`/platform`, commerce).
- Aucun envoi automatique du code (ni e-mail, ni SMS, ni WhatsApp) : Qadr Agency le transmet elle-même.
- Le numéro WhatsApp, `QADR_CODE_SECRET` et la formule Standard publiée doivent être posés par le propriétaire
  (`docs/engineering/owner-action-checklist.md`).

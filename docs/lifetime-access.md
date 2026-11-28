# Accès à vie (abonnement permanent)

Mise en place : 2026-11-27, branche `feature/lifetime-business-access`, migration `0029_lifetime_access.sql`.
Code : `apps/web/src/lib/domain/subscription-lifecycle.ts` (règle d'accès), `platform.ts` (formules, attribution
directe, console), `commercial-codes.ts` (codes à vie), `subscription-billing.ts` (refus du paiement en ligne).
Tests : `src/test/lifetime-access.http.test.ts`, `src/lib/domain/subscription-lifecycle.test.ts`.

## 1. Modèle

| Table | Colonne | Valeurs | Règle |
| --- | --- | --- | --- |
| `subscription_plan` | `duration_kind` | `fixed_duration` (défaut), `lifetime` | `fixed_duration` ⇒ `duration_days` > 0 ; `lifetime` ⇒ `duration_days` nul (`plan_amount_duration_check`). |
| `business_subscription` | `duration_kind` | idem | `fixed_duration` ⇒ `ends_at` renseigné ; `lifetime` ⇒ `ends_at` nul et statut ni `pending`, ni `trialing`, ni `expired` (`subscription_duration_check`). |
| `commercial_access_code` | `duration_unit` | `day`, `month`, `lifetime` | `lifetime` ⇒ `duration_value` nul (`commercial_code_duration_check`). |

- L'abonnement garde **ses propres conditions** : modifier, retirer ou même changer le type d'une formule ne change
  aucun accès déjà accordé.
- Une date nulle seule ne signifie jamais « à vie » : le type est toujours lu explicitement. Un abonnement à durée
  déterminée sans fin est refusé par la base (et lu « échu » par le code s'il existait).
- Jamais de longue durée fictive (ni 999 999 jours, ni an 9999).
- Un seul accès à vie vivant (`active` ou `suspended`) par commerce : index unique partiel `subscription_one_lifetime_idx`.
- La migration est additive : les lignes existantes reçoivent `fixed_duration` ; aucune donnée historique n'est
  transformée en accès permanent.

Piège corrigé pendant les tests : en SQL, `duration_days > 0` vaut NULL quand la valeur est nulle, et une contrainte
CHECK qui vaut NULL est **acceptée**. Les contraintes testent donc `is not null` explicitement.

## 2. Règle d'accès unique

`isInForce(subscription, now)` (et son pendant SQL `subscriptionInForceSql(now)`, utilisé par
`assertBusinessOperational`) : statut `trialing` ou `active`, date de début atteinte, et, pour une durée déterminée,
date de fin non atteinte. Un accès à vie n'expire jamais de lui-même ; seules l'annulation (révocation) ou la
suspension du commerce y mettent fin. `businessLifecycle`, `effectiveSubscriptionStatus`, `commercialAccess`, la
console et les notifications passent tous par cette règle ; `byCoverage` classe l'accès à vie avant toute période fixe.

Le navigateur n'envoie jamais le type d'accès : `isLifetime`, `expiresAt: null`, `durationDays`, `status` envoyés par le
client sont ignorés (corps stricts côté plateforme, champs inconnus ignorés côté commerçant). Le cron d'expiration ne
touche que les abonnements `fixed_duration`.

## 3. Parcours

1. **Formule** (`/platform`, Forfaits) : « Type de durée » = Durée déterminée ou Accès à vie. Pour un accès à vie, le
   champ des jours disparaît et « Sans date d'expiration » s'affiche. Chaque carte montre Type, Durée et Statut.
2. **Code à vie** (`/platform`, Accès commerciaux) : pour une formule à vie, la durée est forcée à « Accès à vie »
   (`duration: "lifetime"`). Le serveur refuse les combinaisons croisées (`lifetime_plan_requires_lifetime`,
   `lifetime_requires_lifetime_plan`). La date limite d'activation reste distincte et s'applique normalement.
3. **Activation du code** : un abonnement `lifetime` sans date de fin est créé (ou l'abonnement en attente est converti).
   Une période fixe en cours reste intacte dans l'historique. Si le commerce a déjà un accès à vie : 409
   `lifetime_active`, le code n'est pas consommé.
4. **Attribution directe** (`/platform`, fiche du commerce, « Accorder un accès à vie ») : formule à vie publiée, motif
   (5 caractères au moins) et case de confirmation. Route `POST /api/platform/businesses/{id}/lifetime`, corps
   `{ planId, reason, confirm: true }`, propriétaire de la plateforme seulement (tout autre compte : 404). Refus :
   commerce suspendu (409 `business_suspended`), accès à vie déjà présent (409 `lifetime_active`), formule non à vie
   (422) ou non publiée (422 `plan_inactive`).
5. **Affichage commerçant** (`/business/subscription`) : « Votre forfait : … », statut Actif, « Expiration : Aucune —
   Accès permanent ». Ni compte à rebours ni date inventée (`endsAt` et `remainingDays` nuls dans l'API).
6. **Révocation** : action « Révoquer l'accès à vie » (annulation, terminale) dans la liste des abonnements. Prolonger
   un accès à vie est refusé (409 `lifetime_not_extendable`). Suspendre le commerce suspend l'accès ; la réactivation
   le rétablit (pas d'échéance à vérifier).
7. **Paiement en ligne** (GeniusPay, en pause) : une formule à vie n'est jamais proposée ni payable en ligne (422
   `lifetime_not_payable_online`) ; un commerce à vie ne peut pas ouvrir de paiement (409). Si un paiement arrivait
   malgré tout pendant un accès à vie, il est enregistré sans période et signalé (`subscription.payment_during_lifetime`).
8. **Codes privés de la plateforme** et **campagnes publiques** : jamais appliqués sur un accès à vie (409) ; une
   campagne ne porte que sur des formules à durée déterminée.

## 4. Audit

| Événement | Quand |
| --- | --- |
| `platform.plan_created` / `platform.plan_updated` (métadonnée `durationKind`) | formule à vie créée ou modifiée |
| `platform.commercial_code_created` (`durationUnit: lifetime`) | code à vie généré |
| `subscription.commercial_code_activated` (`after.durationKind: lifetime`) | code à vie activé |
| `subscription.lifetime_granted` (administrateur, date, motif, état précédent) | attribution directe |
| `platform.business_suspended` / `platform.business_active` | suspension et réactivation |
| `platform.lifetime_access_revoked` | révocation |
| `subscription.payment_during_lifetime` | paiement reçu pendant un accès à vie (à traiter à la main) |

## 5. Concurrence

L'activation d'un code et l'attribution directe verrouillent la ligne `business_profile` (`FOR UPDATE`) avant de lire
les abonnements : deux opérations simultanées sur le même commerce sont sérialisées. L'index unique partiel est le
filet final ; sa violation est convertie en 409 (`isUniqueViolation`).

## 6. Mise en production

Rien n'est appliqué à distance par cette branche. Procédure : répétition de 0029 sur une branche Neon copiée de `main`,
`pg_dump` restauré, puis script de migration de production (`docs/engineering/production-runbook.md`), seulement après
validation explicite du propriétaire. Aucune formule à vie n'est créée automatiquement : elle se crée dans la console.

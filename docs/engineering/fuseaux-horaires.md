# Fuseaux horaires et date commerciale

Ce document décrit la règle de date de Qadr Ops (mission 16, lot F) :
- le stockage est en UTC ;
- les jours sont comptés dans le fuseau du commerce ;
- aucun changement arbitraire.

Il décrit l'état réel du code au 2026-11-10 et les écarts qui restent.

## 1. Règle

1. **Stockage en UTC.** Les 86 colonnes `timestamp` de `src/lib/db/schema.ts` sont toutes en
   `withTimezone: true` (`timestamptz`). Un instant est enregistré tel quel, sans conversion locale.
2. **Fuseau du commerce.**
   - Il est enregistré dans `business_profile.timezone`, avec `Africa/Abidjan` par défaut.
   - Il est contrôlé par `assertValidTimezone` (`lib/domain/reports.ts`), qui renvoie 422 si le fuseau est
     inconnu d'`Intl`.
   - Aucun écran ni aucune route ne permet aujourd'hui de le modifier.
3. **Date commerciale.**
   - Le « jour » d'une opération est sa date civile dans le fuseau du commerce, de minuit à minuit.
   - Le serveur calcule les bornes d'une période :
     - `reportRange` calcule des instants UTC à partir de minuits locaux ;
     - les regroupements SQL utilisent `occurred_at at time zone <fuseau>` (rapports, tableau de bord) ;
     - le navigateur ne fait qu'afficher.
4. **Affichage.**
   - `formatDateTime` et `formatTime` (`lib/i18n/format.ts`) reçoivent le fuseau du commerce. Ils
     reviennent à `BUSINESS_DEFAULT_TIME_ZONE` si ce fuseau est invalide.
   - Le ticket (`buildReceiptDocument`) date la vente dans le fuseau du commerce et l'affiche à côté de
     l'heure.
5. **Échéances.**
   - Toute échéance comparée à `new Date()` est écrite par le code et non par `defaultNow()` (règle de la
     mission 14.1).
   - Les abonnements, les sessions plateforme et les jetons sont des instants UTC. Ils ne dépendent pas du
     fuseau du commerce.

## 2. Correction faite pendant la mission 16

Le tableau de bord (`getBusinessOverview`, `lib/domain/business-data.ts`) calculait « aujourd'hui » avec
`Africa/Abidjan` en dur, alors qu'il venait de lire le fuseau du commerce. Il appelle désormais
`businessDate(assertValidTimezone(identity.timezone))`, la même règle que `reportRange`.

Le comportement ne change pas pour les commerces existants, qui sont tous en `Africa/Abidjan`.

## 3. Écarts connus, sans effet tant que le fuseau vaut UTC+0

La Côte d'Ivoire est en UTC+0, sans heure d'été : pour elle, une date calculée en UTC est la date locale. Les
calculs ci-dessous prennent la date UTC. Ils doivent être repris **avant** de permettre un autre fuseau :

| Emplacement | Calcul actuel | Effet hors UTC+0 |
| --- | --- | --- |
| `lib/domain/opening.ts` `abidjanToday` | date UTC | une date de référence d'ouverture « d'aujourd'hui » pourrait être refusée comme future |
| `components/business/opening-workspace.tsx`, `imports-workspace.tsx` (`today()`) | date UTC du navigateur | date proposée par défaut décalée d'un jour en soirée ou le matin |
| `components/business/business-suite-workspace.tsx` | référence d'achat `ACH-<date UTC>-01` | libellé seulement |
| `lib/printing/receipt-ticket.ts` `layoutTestTicket` | `Africa/Abidjan` en dur | page de test seulement |
| `lib/auth/email-templates.ts` | `Africa/Abidjan` en dur | heure affichée dans les e-mails de compte, qui ne sont pas liés à un commerce |
| `lib/domain/notifications.ts` (`subscription.expiring`) | clé de dédoublonnage par date UTC | aucune pour l'utilisateur |

Les calculs `reports-workspace.tsx` (`shiftDate`) et `dashboard-workspace.tsx` (`weekDays`) travaillent
sur des dates civiles déjà fournies par le serveur. Ils utilisent l'UTC comme simple calendrier, ce qui est
correct quel que soit le fuseau.

## 4. Avant d'ouvrir un autre fuseau (décision du propriétaire)

1. Ajouter le réglage, réservé au propriétaire et tracé dans l'audit, sans réécrire l'historique : les
   instants restent en UTC ; seuls les regroupements futurs changent.
2. Remplacer les calculs du § 3 par la date commerciale du serveur (une fonction partagée à partir de
   `businessDate`).
3. Ajouter des tests aux bornes : 23:30 et 00:30 locales, un fuseau UTC+1 et un fuseau à heure d'été.
4. Prévenir que les rapports déjà exportés gardent leurs anciennes bornes.

Tant que cette décision n'est pas prise, `Africa/Abidjan` reste le seul fuseau en service.

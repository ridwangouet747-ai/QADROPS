# Codes d'invitation des employés (domaine B)

Mise en place : 2026-11-16. Code : `apps/web/src/lib/domain/team-codes.ts`, `lib/domain/employee-auth.ts`,
`components/business/team-invite-codes.tsx`, page `/join-business`, migration `0026_commercial_and_invite_codes.sql`.
Tests : `src/test/team-invite-codes.http.test.ts`, `src/test/tenant-isolation.http.test.ts` (attaques A→B).

Ce domaine est **séparé des codes commerciaux** (`docs/commercial-access-codes.md`) : autre table
(`business_invite_code`, à `business_id`, RLS), autre préfixe (`EQP-`), autre clé d'empreinte, autres routes. Un code
`EQP-` n'accorde **aucun abonnement** ; un code `QADR-` saisi sur `/join-business` est refusé (422 `commercial_code`),
et inversement (422 `invite_code`).

## 1. Parcours

1. Le propriétaire ou un administrateur ouvre `Équipe` (`/business/team`) et crée un code : rôle, nom affiché
   facultatif, durée de validité (7 jours par défaut, de 1 à 30).
2. Le code (`EQP-XXXX-XXXX-XXXX`, 12 symboles, environ 59 bits) s'affiche **une seule fois** avec un bouton de copie.
   La liste ne montre ensuite que ses 4 derniers caractères, son rôle, son état et sa date de fin.
3. L'employé ouvre `/join-business`, saisit le code, son nom, **un nom d'utilisateur** et un mot de passe personnel.
   Aucune adresse e-mail n'est demandée ni inventée (`user.email` est nul pour ces comptes).
4. Le compte, l'appartenance au commerce et la consommation du code sont écrits dans **une seule transaction** ;
   la session s'ouvre ensuite. L'employé se reconnecte par la suite sur `/login` avec son nom d'utilisateur.

## 2. Règles

- **Rôles attribuables** : `admin`, `cashier`, `stock_manager`, `accountant`, `member`. Jamais `owner` ni un droit de la
  plateforme. Un administrateur ne délègue que les rôles inférieurs au sien. Le rôle vient du code, jamais du corps de
  la requête d'acceptation.
- **Usage unique** sous verrou : deux acceptations simultanées donnent 201 et 409. Un nom d'utilisateur déjà pris
  (409 `username_taken`) ou invalide laisse le code utilisable.
- **Nom d'utilisateur** : 3 à 30 caractères `a-z`, `0-9`, `.` et `_` (pas de tiret ni d'accent), insensible à la casse.
  Les noms des propriétaires de la plateforme sont refusés.
- **Mot de passe** : 8 à 128 caractères, haché par Better Auth.
- **Commerce ouvert** : l'employé ne rejoint qu'un commerce avec un droit d'usage en cours (essai ou abonnement actif) ;
  sinon 403 `business_closed`. Les quotas d'utilisateurs de la formule s'appliquent.
- **États** : En attente, Utilisé, Expiré, Révoqué.
- **Stockage** : HMAC-SHA256 avec une clé dérivée de `QADR_CODE_SECRET` (repli `BETTER_AUTH_SECRET`), étiquette
  propre à cette famille.

## 3. Gestion de l'équipe

| Action | Route | Audit |
| --- | --- | --- |
| Créer, lister les codes | `GET/POST /api/business/team/codes` | `team.invite_code_created` |
| Révoquer un code | `POST /api/business/team/codes/[codeId]/revoke` | `team.invite_code_revoked` |
| Vérifier, accepter (public) | `POST /api/public/team-codes/check`, `…/accept` | `team.member_joined_by_code` |
| Changer le rôle | `PATCH /api/business/team/members/[memberId]` | `team.role_changed` |
| Suspendre, réactiver | `POST …/members/[memberId]/access` | (existant, `docs/authentication.md`) |
| Fermer toutes les sessions d’un membre | `DELETE …/members/[memberId]/sessions` | `team.sessions_revoked` |
| Connexion par nom d'utilisateur | `POST /api/account/sign-in/username` | — |

Aucune auto-promotion : un membre ne change ni son propre rôle ni celui d'un rang égal ou supérieur. Le propriétaire ne
ferme pas ses propres sessions par cette route (403). Une route `[id]` d'un autre commerce répond comme pour un
identifiant inconnu.

## 4. Protection contre les essais

`rateRules` : `code.invite.ip` (10 / 15 min), `code.invite.global` (300 / 15 min), `auth.username_sign_in.ip`
(60 / 15 min), `auth.username_sign_in.account` (10 / 15 min). Turnstile sur les routes publiques quand ses clés sont
posées. Un mauvais mot de passe et un nom inconnu donnent le même 401 `invalid_credentials`.

## 5. Limites connues

- Sans adresse e-mail, un employé qui oublie son mot de passe ne peut pas le réinitialiser seul : le responsable lui crée
  un nouveau code (ou ferme ses sessions et suspend l'ancien compte).
- Aucun envoi automatique du code : le responsable le transmet lui-même.

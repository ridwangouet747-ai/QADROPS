# Accès privé du propriétaire à la console Super Admin (mission 13)

## Principe

- **Un seul propriétaire actif** : index unique partiel `platform_admin_single_active` (migration 0022).
  `grantPlatformAdmin` (et donc `scripts/platform-admin.ts grant`) refuse (409) dès qu'un droit actif existe.
- **Connexion dédiée** : `/platform/login`, nom d'utilisateur + mot de passe (plugin Better Auth Username),
  route `POST /api/platform/auth/sign-in`. Les routes HTTP Better Auth du plugin
  (`/api/auth/sign-in/username`, `/api/auth/is-username-available`) répondent 404 ; un `username` envoyé à
  l'inscription ou à la mise à jour du profil est refusé (400) : personne ne peut s'en attribuer un.
- **Session plateforme** : la console exige une ligne `platform_session` pour la session courante,
  créée seulement par la connexion dédiée, valable **8 heures**, cookie de session (non persistant).
  Une session ordinaire du même compte (connexion par e-mail) reçoit 401 `platform_reauth_required`.
- **Compte d'un commerce** : 404 sur la console, même en appel direct de l'API (testé : commerçant,
  caissier, autre commerce, visiteur).
- **Pas de création automatique, pas de mot de passe par défaut** : le compte est créé par un opérateur.

## Créer le propriétaire

Depuis `apps/web`, dans un terminal dont les variables ne sont pas enregistrées :

```powershell
$env:QADR_DB_TARGET = "production"           # ou development, après vérification de la cible
$env:QADR_OWNER_USERNAME = Read-Host "Nom d'utilisateur"
$env:QADR_OWNER_EMAIL = Read-Host "E-mail"
$env:QADR_OWNER_NAME = Read-Host "Nom"
$env:QADR_OWNER_PASSWORD = Read-Host "Mot de passe (12 caractères au moins)"
npx tsx scripts/platform-owner.ts bootstrap
Remove-Item Env:QADR_OWNER_PASSWORD
```

Le script exige `BETTER_AUTH_SECRET` (32 caractères au moins), `DATABASE_URL`, et la saisie de
`CONFIRMER`. Il refuse si un propriétaire est actif ou si l'e-mail ou le nom d'utilisateur existe déjà :
un compte de commerce n'est jamais promu.

## Renouveler le mot de passe

```powershell
$env:QADR_OWNER_USERNAME = "..."; $env:QADR_OWNER_PASSWORD = Read-Host "Nouveau mot de passe"
npx tsx scripts/platform-owner.ts reset-password
```

Toutes les sessions du propriétaire sont fermées ; trace `platform.owner_password_reset`.

## Protections

| Menace | Mesure |
| --- | --- |
| Force brute | 5 échecs par client (empreinte HMAC de l'IP) et 30 au total en 15 min → 429 `retry-after: 900`, même avec le bon mot de passe |
| Énumération | Réponse 401 identique (nom inconnu, mauvais mot de passe, compte de commerce, saisie invalide) ; Better Auth hache même pour un nom inconnu |
| CSRF | En-tête `Origin` obligatoire et égal à l'origine de la requête ou de `BETTER_AUTH_URL` (403 sinon) ; cookies `SameSite=Lax`, `HttpOnly`, `Secure` en production |
| Session volée ou oubliée | 8 h maximum ; déconnexion `POST /api/platform/auth/sign-out` ; renouvellement du mot de passe ferme tout |
| Traçabilité | `platform.login_succeeded`, `platform.login_failed` (cause, empreinte du client, jamais le nom saisi ni l'IP), `platform.logout`, `platform.owner_bootstrapped` |

## Limites et suites

- **Derrière Cloudflare**, l'IP lue est `cf-connecting-ip` ; si elle manque, plusieurs visiteurs peuvent
  partager une empreinte : la limite globale (30) protège quand même.
- **Deuxième facteur** : non implémenté. Étape recommandée : plugin Better Auth `twoFactor` (TOTP) pour ce
  seul compte, puis passkey. Les opérations critiques (révocation, plans) ne redemandent pas encore le mot
  de passe : la session courte de 8 h en tient lieu pour l'instant.
- Tests : `src/test/platform-owner-login.http.test.ts` (11 cas), `platform-console.integration.test.ts`.

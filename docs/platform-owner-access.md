# Accès privé du propriétaire à la console Super Admin (missions 13 et 14)

## Principe

- **Un seul propriétaire actif** : index unique partiel `platform_admin_single_active` (migration 0022).
  `grantPlatformAdmin` (et donc `scripts/platform-admin.ts grant`) refuse (409) dès qu'un droit actif existe.
- **Connexion en deux étapes** sur `/platform/login` (mission 14) :
  1. `POST /api/platform/auth/sign-in` : nom d'utilisateur + mot de passe (plugin Better Auth Username).
     En cas de succès, la réponse est `{ ok: true, step: "two_factor" }` avec **seulement** un cookie de défi
     signé `better-auth.two_factor` (5 minutes, plugin Better Auth `twoFactor`). Aucune session n'est créée.
  2. `POST /api/platform/auth/verify` : `{ code }` (6 chiffres de l'application d'authentification, TOTP
     RFC 6238, 30 s) ou `{ backupCode }` (code de secours, usage unique). **Seule cette route** ouvre la
     session et crée la ligne `platform_session`.
- **Aucun contournement par l'API** : toutes les routes HTTP `/api/auth/two-factor/*` du plugin répondent 404
  (hook `before` de `server.ts`) ; les étapes passent par `auth.api.*` côté serveur, depuis les deux routes
  ci-dessus. Le cookie « appareil de confiance » du plugin n'est jamais transmis (seuls les cookies
  `…two_factor` et `…dont_remember` le sont) : chaque connexion exige le code.
- **Sans second facteur configuré**, le bon mot de passe ne suffit pas : 403 `platform_2fa_setup_required`,
  aucune session laissée. Un mauvais mot de passe reste un 401 générique (l'état du compte n'est pas révélé).
- **Session plateforme** : la console exige une ligne `platform_session` pour la session courante,
  valable **8 heures**, cookie de session (non persistant). Une session ordinaire du même compte reçoit
  401 `platform_reauth_required`.
- **Connexion par e-mail du propriétaire** (`/api/auth/sign-in/email`) : une fois le facteur actif, le plugin
  supprime la session et ne renvoie que `twoFactorRedirect` ; comme les routes `/two-factor/*` sont fermées,
  ce chemin ne mène à rien. **Effet voulu** : le compte propriétaire ne sert qu'à la console.
- **Comptes des commerces** : inchangés (aucun second facteur, connexion habituelle) ; 404 sur la console.
- **Pas de création automatique, pas de mot de passe par défaut** : le compte est créé par un opérateur.

## Créer le propriétaire et activer le second facteur

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

Le script exige `BETTER_AUTH_SECRET` (32 caractères au moins, **le même que celui de l'application** : il
chiffre le secret TOTP et les codes de secours), `DATABASE_URL`, et la saisie de `CONFIRMER`. Il refuse si
un propriétaire est actif ou si l'e-mail ou le nom d'utilisateur existe déjà : un compte de commerce n'est
jamais promu.

`bootstrap` enchaîne l'activation du second facteur (`enroll-2fa`, à relancer seul si besoin) :

1. le script affiche **une fois**, dans ce terminal, l'adresse `otpauth://totp/…` à saisir dans
   l'application d'authentification (saisie manuelle de la clé), puis **10 codes de secours** à recopier sur
   papier et à garder hors de l'ordinateur ;
2. il demande le premier code à 6 chiffres : le facteur ne devient obligatoire qu'après ce code valide. Un
   code faux annule tout (rien n'est activé) ;
3. toutes les sessions du compte sont fermées ; trace `platform.owner_2fa_enrolled` (nombre de codes
   seulement, jamais le secret ni les codes).

Fermez ensuite le terminal (l'historique d'affichage contient le secret).

## Récupération (téléphone perdu, codes de secours épuisés)

```powershell
$env:QADR_DB_TARGET = "production"; $env:QADR_OWNER_USERNAME = "..."
npx tsx scripts/platform-owner.ts reset-2fa
# puis, avec le mot de passe :
$env:QADR_OWNER_PASSWORD = Read-Host "Mot de passe"
npx tsx scripts/platform-owner.ts enroll-2fa
```

`reset-2fa` exige un accès à la base de production et à `BETTER_AUTH_SECRET` : c'est la procédure de
dernier recours. Il retire le facteur, ferme toutes les sessions, trace `platform.owner_2fa_reset`. Entre
les deux commandes, la console reste fermée (403). Un code de secours utilisé est supprimé ; il n'existe pas
encore d'écran pour régénérer les codes : refaire `reset-2fa` puis `enroll-2fa`.

## Renouveler le mot de passe

```powershell
$env:QADR_OWNER_USERNAME = "..."; $env:QADR_OWNER_PASSWORD = Read-Host "Nouveau mot de passe"
npx tsx scripts/platform-owner.ts reset-password
```

Toutes les sessions du propriétaire sont fermées ; trace `platform.owner_password_reset`. Le second facteur
est conservé.

## Protections

| Menace | Mesure |
| --- | --- |
| Mot de passe volé | Second facteur obligatoire (TOTP ou code de secours) ; sans lui, aucune session |
| Force brute du mot de passe | 5 échecs par client (empreinte HMAC de l'IP) et 30 au total en 15 min → 429 avec `retry-after` (secondes restantes de la fenêtre), même avec le bon mot de passe. Compteurs **dans PostgreSQL**, partagés par toutes les instances (`docs/rate-limiting.md`) |
| Force brute du code | 5 essais par client et 30 au total en 15 min (429) ; en plus, le plugin limite chaque défi à 5 essais et verrouille le compte 15 min après 10 échecs consécutifs |
| Rejeu | Un défi utilisé ne rouvre pas de session ; un code de secours ne sert qu'une fois |
| Énumération | Réponse 401 identique (nom inconnu, mauvais mot de passe, compte de commerce, saisie invalide) ; Better Auth hache même pour un nom inconnu |
| CSRF | En-tête `Origin` obligatoire et égal à l'origine de la requête ou de `BETTER_AUTH_URL` (403 sinon), aux deux étapes ; cookies `SameSite=Lax`, `HttpOnly`, `Secure` en production |
| Session volée ou oubliée | 8 h maximum ; déconnexion `POST /api/platform/auth/sign-out` ; renouvellement du mot de passe ou retrait du facteur ferme tout |
| Secrets au repos | Secret TOTP et codes de secours chiffrés par Better Auth avec `BETTER_AUTH_SECRET` |
| Traçabilité | `platform.login_password_accepted` (étape 1), `platform.login_succeeded` (avec `factor: totp \| backup_code`), `platform.login_failed` (cause, empreinte du client, jamais le nom saisi, l'IP ni le code), `platform.logout`, `platform.owner_bootstrapped`, `platform.owner_2fa_enrolled`, `platform.owner_2fa_reset` |

## Limites

- **Adresse du client** : la même politique que Better Auth (`client-ip-headers.ts`) : `x-forwarded-for`
  (posé par Vercel) hors Workers, `cf-connecting-ip` seulement sur Cloudflare Workers, où le client ne peut pas
  le falsifier. Avec Cloudflare en proxy devant Vercel, `x-forwarded-for` peut porter l'adresse du nœud
  Cloudflare : plusieurs visiteurs partagent alors une empreinte ; la limite globale (30) protège quand même,
  mais un attaquant peut bloquer temporairement le propriétaire. **Non vérifié sur l'hébergement réel.**
- **Pas de passkey**, pas de régénération des codes de secours depuis l'interface, pas de nouvelle demande du
  mot de passe pour les opérations critiques (la session de 8 h en tient lieu).
- **`BETTER_AUTH_SECRET` changé** : le secret TOTP chiffré devient illisible ; il faut `reset-2fa` puis
  `enroll-2fa`.
- **Rien n'a été fait en production.** Essai réel du script sur la branche Neon de staging (2026-11-09) :
  `reset-password`, `enroll-2fa` (code faux refusé sans rien activer, bon code calculé depuis l'adresse
  otpauth), refus d'une seconde activation, `reset-2fa`.
- Tests : `src/test/platform-owner-login.http.test.ts` (16 cas : deux étapes, codes de secours, contournements,
  limitations concurrentes, récupération), `src/test/rate-limit.http.test.ts`, `platform-console.integration.test.ts`.

# Accès privé du propriétaire à la console Super Admin (missions 13 et 14)

> **Depuis le 2026-11-12 (décision D-05 du propriétaire)** : la connexion se fait avec un nom d'utilisateur et
> un mot de passe. Le second facteur (code du téléphone) est **facultatif**. Le compte peut être créé sans
> terminal, à la première connexion. La section « Connexion simple » ci-dessous fait foi ; les sections
> suivantes décrivent le second facteur pour qui l'active.

## Connexion simple (nom d'utilisateur et mot de passe)

1. **Poser deux variables chez l'hébergeur** (Vercel, environnement visé) : `QADR_OWNER_USERNAME` (3 à 30
   caractères : lettres minuscules, chiffres, point, tiret bas) et `QADR_OWNER_PASSWORD` (**12 caractères au
   moins**). Facultatives : `QADR_OWNER_EMAIL`, `QADR_OWNER_NAME`.
2. **Ouvrir `/platform/login`** et saisir ces deux valeurs. S'il n'existe aucun propriétaire actif, le compte
   est créé à cet instant (`ensureSeededPlatformOwner`), puis la console s'ouvre.
3. **Changer ses identifiants** : la console amène sur **Paramètres → Nom d'utilisateur et mot de passe** tant
   que le mot de passe est celui de départ. Le mot de passe actuel est demandé pour chaque changement
   (`POST /api/platform/account/password`, `POST /api/platform/account/username`).
4. **Retirer les deux variables** de l'hébergeur une fois le mot de passe changé (elles ne servent plus).

Règles :

- Les valeurs de départ ne viennent **que** des variables du serveur. Aucun identifiant n'est écrit dans le
  code : le dépôt est public, un mot de passe par défaut dans le code ouvrirait la console à tout le monde.
- Elles ne servent qu'une fois. Dès qu'un propriétaire actif existe, elles sont ignorées : elles ne recréent
  pas le compte et ne remettent pas l'ancien mot de passe.
- Variables invalides (mot de passe trop court, nom mal formé) ou nom déjà porté par un autre compte : aucun
  compte n'est créé, la connexion répond le refus générique, et le journal du serveur en donne la raison sans
  la valeur. Un compte de commerce n'est jamais promu.
- Sans `QADR_OWNER_EMAIL`, l'adresse du compte est `<nom>@console.qadr-ops.invalid` (domaine réservé, aucun
  message possible) : ce compte ne se récupère pas par e-mail. Mot de passe oublié : `reset-password` plus bas.
- Changer le mot de passe ferme les autres sessions du compte ; la session en cours reste ouverte.
- En aperçu local, la console s'ouvre sans connexion (compte de démonstration) ; les deux formulaires y sont
  désactivés.

**Ce que ce choix coûte** : sans second facteur, le mot de passe est la seule barrière de la console qui gère
les abonnements de tous les commerces. Restent en place la limitation des tentatives, le refus générique, le
contrôle d'origine, la session de 8 heures et le journal d'audit. Le second facteur s'active quand vous le
voulez (`enroll-2fa`), sans rien changer d'autre.

## Principe (avec second facteur activé)

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
- **Sans second facteur configuré**, le mot de passe ouvre la console (réponse `{ ok: true, step: "done" }`,
  D-05). Un mauvais mot de passe reste un 401 générique (l'état du compte n'est pas révélé).
- **Session plateforme** : la console exige une ligne `platform_session` pour la session courante,
  valable **8 heures**, cookie de session (non persistant). Une session ordinaire du même compte reçoit
  401 `platform_reauth_required`.
- **Connexion par e-mail du propriétaire** (`/api/auth/sign-in/email`) : sans second facteur, elle n'ouvre
  qu'une session ordinaire, que la console refuse (401 `platform_reauth_required`, pas de session plateforme).
  Elle est refusée (mission 15) pour tout compte à
  second facteur, avec la même réponse 401 qu'un mauvais mot de passe, sans session ni cookie de défi. Auparavant,
  ce chemin posait un cookie de défi utilisable par `/api/platform/auth/verify` : il contournait les limites et
  l'audit de l'étape 1 de la console, et sa réponse 200 révélait la justesse du mot de passe. **Effet voulu** :
  le compte propriétaire ne sert qu'à la console. La page `/platform/login` est exclue de la redirection du proxy
  (`src/proxy.ts`), qui la rendait injoignable sans session.
- **Comptes des commerces** : inchangés (aucun second facteur, connexion habituelle) ; 404 sur la console.
- **Aucun identifiant dans le code** : le compte est créé par un opérateur (script ci-dessous) ou à la
  première connexion à partir des variables du serveur (« Connexion simple »).

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
les deux commandes, la console s'ouvre avec le seul mot de passe (D-05). Un code de secours utilisé est supprimé ; il n'existe pas
encore d'écran pour régénérer les codes : refaire `reset-2fa` puis `enroll-2fa`.

## Renouveler le mot de passe

```powershell
$env:QADR_OWNER_USERNAME = "..."; $env:QADR_OWNER_PASSWORD = Read-Host "Nouveau mot de passe"
npx tsx scripts/platform-owner.ts reset-password
```

Toutes les sessions du propriétaire sont fermées ; trace `platform.owner_password_reset`. Le second facteur
est conservé.

## Remplacer le propriétaire

Aucun script ne le fait : `platform-admin.ts revoke` refuse de retirer le dernier administrateur (409) et
`platform-owner.ts bootstrap` refuse tant qu'un propriétaire est actif. Procédure manuelle, sur accord du
propriétaire, en une seule instruction SQL (retrait + trace, tout ou rien) :

```sql
with revoked as (
  update platform_admin set revoked_at = now()
  where revoked_at is null and user_id = (select id from "user" where username = '<ancien>')
  returning user_id
)
insert into audit_event (id, business_id, actor_user_id, event_type, entity_type, entity_id, metadata)
select gen_random_uuid()::text, null, null, 'platform.admin_revoked', 'user', user_id,
  jsonb_build_object('businessId', null, 'before', jsonb_build_object('admin', true),
    'after', jsonb_build_object('admin', false), 'reason', '<motif>', 'result', 'success')
from revoked;
```

Puis `bootstrap` pour le nouveau compte. Entre les deux, la console est fermée. L'ancien compte reste en base,
sans droit. Fait une fois sur `qadr_staging` le 2026-11-11 : compte d'essai `proprietaire_staging` retiré à
la demande du propriétaire.

## Protections

| Menace | Mesure |
| --- | --- |
| Mot de passe volé | **Seulement si le second facteur est activé** (TOTP ou code de secours). Sans lui (réglage par défaut, D-05), un mot de passe volé ouvre la console : mot de passe long et unique, changement depuis Paramètres |
| Boîte e-mail compromise | Le lien public « mot de passe oublié » n'est jamais envoyé à un propriétaire actif, avec ou sans second facteur (`sendResetPassword`, réponse HTTP inchangée) |
| Session volée | Changer le nom ou le mot de passe exige le mot de passe actuel, 5 essais par 15 min (`platform.account_change`) ; le changement ferme les autres sessions |
| Contournement de la console par Better Auth (2026-11-12) | Pour un propriétaire actif, les routes `/api/auth/change-password`, `/change-email`, `/delete-user`, `/link-social` et `/unlink-account` répondent 404, que sa session vienne de la console ou d'une connexion ordinaire (`password-change.http.test.ts`). Reste ouvert : sans second facteur, `/sign-in/email` lui ouvre une session ordinaire, hors limites et audit de la console (décision du propriétaire) |
| Force brute du mot de passe | 5 échecs par client (empreinte HMAC de l'IP) et 30 au total en 15 min → 429 avec `retry-after` (secondes restantes de la fenêtre), même avec le bon mot de passe. Compteurs **dans PostgreSQL**, partagés par toutes les instances (`docs/rate-limiting.md`) |
| Force brute du code | 5 essais par client et 30 au total en 15 min (429) ; en plus, le plugin limite chaque défi à 5 essais et verrouille le compte 15 min après 10 échecs consécutifs |
| Rejeu | Un défi utilisé ne rouvre pas de session ; un code de secours ne sert qu'une fois |
| Énumération | Réponse 401 identique (nom inconnu, mauvais mot de passe, compte de commerce, saisie invalide) ; Better Auth hache même pour un nom inconnu |
| CSRF | En-tête `Origin` obligatoire et égal à l'origine de la requête ou de `BETTER_AUTH_URL` (403 sinon), aux deux étapes ; cookies `SameSite=Lax`, `HttpOnly`, `Secure` en production |
| Session volée ou oubliée | 8 h maximum ; déconnexion `POST /api/platform/auth/sign-out` ; renouvellement du mot de passe ou retrait du facteur ferme tout |
| Secrets au repos | Secret TOTP et codes de secours chiffrés par Better Auth avec `BETTER_AUTH_SECRET` |
| Traçabilité | `platform.login_password_accepted` (étape 1), `platform.login_succeeded` (avec `factor: password \| totp \| backup_code`), `platform.owner_password_changed`, `platform.owner_username_changed` (sans le nom), `platform.owner_account_change_refused`, `platform.login_failed` (cause, empreinte du client, jamais le nom saisi, l'IP ni le code), `platform.logout`, `platform.owner_bootstrapped`, `platform.owner_2fa_enrolled`, `platform.owner_2fa_reset` |

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

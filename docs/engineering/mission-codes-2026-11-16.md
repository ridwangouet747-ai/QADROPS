# Mission du 2026-11-16 : modèle commercial par codes, invitations des employés, release

> Rapport de l'agent. Ce rapport distingue ce qui est prouvé (commande, résultat) de ce qui ne l'est pas.
> Aucun paiement réel, aucune donnée métier, aucun compte et aucune migration n'a été créé ou appliqué en production.
> Branche : `feat/mission-codes-2026-11-16`. Migration ajoutée : `0026_commercial_and_invite_codes.sql`
> (additive : deux tables, `user.email` devient nullable, contraintes d'idempotence et d'audit élargies).

## A. Modèle commercial

Une seule formule publique : **Standard**, lue dans `subscription_plan` (aucun prix dans le code). Le paiement en ligne
GeniusPay est **en pause** (§ D). Parcours :

1. **Contact** : la carte Standard de la page publique ouvre WhatsApp (`wa.me`, message prérempli traduit) vers
   `QADR_WHATSAPP_NUMBER` (format international, chiffres seulement, validé côté serveur). Sans numéro valide, aucun
   lien WhatsApp n'est inventé : la carte propose seulement « J'ai un code d'accès » (`/redeem-code`).
2. **Vérification du règlement** : faite **à la main** par Qadr Agency, hors de Qadr Ops. Rien dans l'application ne
   prétend confirmer un paiement.
3. **Génération** : le propriétaire de la plateforme crée le code dans `/platform` (onglet Codes d'accès) : formule,
   durée, date limite d'activation, référence interne facultative. Le code brut s'affiche une seule fois.
4. **Saisie** : `/redeem-code` vérifie le code et pose un laissez-passer signé (2 h), puis inscription, création du
   commerce (code consommé dans la même transaction), accueil, tableau de bord.
5. **Renouvellement** : nouveau code saisi sur `/business/subscription`.

L'offre « Qadr Ops Business » (sur devis, sans prix, bouton vers `QADR_CONTACT_URL`) est conservée telle quelle :
ce n'est pas une formule facturée et elle disparaît sans canal configuré.

Détail : `docs/commercial-access-codes.md`.

## B. Codes commerciaux (`QADR-`)

| Point | Comportement |
| --- | --- |
| Fonctionnement | `lib/domain/commercial-codes.ts`, table `commercial_access_code` ; routes publiques `check` / `pass`, console `GET/POST /api/platform/access-codes`, révocation `POST …/[codeId]/revoke` |
| Durées | 7 jours, 21 jours, 1 mois, 3 mois, personnalisée (jours) ; mois du calendrier en UTC (31 janvier + 1 mois = fin février) |
| Sécurité | 16 symboles (~79 bits), seul `HMAC-SHA256` stocké (clé HKDF de `QADR_CODE_SECRET`, repli `BETTER_AUTH_SECRET`, étiquette par famille) ; même 404 pour un code inconnu, mal formé ou d'une autre famille ; Turnstile ; limites `code.commercial.ip/account/global` ; refus audités sans le code saisi |
| Activation | laissez-passer signé exigé par l'inscription et la création du commerce sur tout déploiement (`accessCodeRequired()`) ; code consommé sous verrou dans la transaction qui crée commerce et abonnement |
| Renouvellement | même formule en cours : prolongée depuis **sa** fin ; aucune en cours : nouvelle période ; autre formule : 409 `incompatible_subscription`, code intact |
| Expiration | date limite d'activation (30 j par défaut) distincte de la durée d'accès ; code non activé à temps = « Expiré » (410) |
| Révocation | motif obligatoire ; impossible sur un code utilisé (409) |
| Tests | `access-codes.test.ts`, `commercial-access-codes.http.test.ts`, `mode.test.ts`, `geniuspay-pause.http.test.ts`, `registration-allowlist.http.test.ts`, attaques A→B dans `tenant-isolation.http.test.ts` |

## C. Codes employés (`EQP-`)

| Point | Comportement |
| --- | --- |
| Création | `/business/team`, propriétaire ou administrateur ; rôle, nom affiché, validité 1 à 30 jours (7 par défaut) ; code affiché une fois |
| Rôles | `admin`, `cashier`, `stock_manager`, `accountant`, `member` ; jamais `owner` ; un administrateur ne délègue que les rôles inférieurs ; le rôle vient du code, jamais de la requête |
| Activation sans e-mail | `/join-business` : code, nom, nom d'utilisateur, mot de passe ; `user.email` nul ; compte, appartenance et consommation dans **une** transaction ; aucun appel à Resend |
| Authentification | `POST /api/account/sign-in/username` (même 401 pour nom inconnu et mauvais mot de passe, limites par IP et par compte) |
| Gestion | changement de rôle (`PATCH …/members/[memberId]`), suspension et réactivation, fermeture des sessions (`DELETE …/sessions`), tout audité ; aucune auto-promotion |
| Révocation | `POST /api/business/team/codes/[codeId]/revoke` |
| Tests | `team-invite-codes.http.test.ts`, `tenant-isolation.http.test.ts`, `operation-integrity.integration.test.ts`, `tenant-rls.http.test.ts` (table à RLS) |

Les deux familles ne se mélangent pas : autre table, autre préfixe, autre clé, autres routes ; un code de l'une saisi
dans l'autre est refusé (422). Détail : `docs/team-invite-codes.md`.

## D. GeniusPay

| Point | État |
| --- | --- |
| Code conservé | `lib/billing/`, `lib/domain/subscription-billing.ts`, factures, rapprochement : rien n'est supprimé |
| Checkout désactivé | `getBillingProvider()` rend le fournisseur « en pause » en mode `manual_code` : aucune création de paiement, aucun bouton, la page de retour n'active rien |
| Webhook | signature toujours vérifiée sur le corps brut ; événement valide enregistré sans accorder de droit (200), signature invalide 401, configuration absente 503 |
| Tests | `geniuspay-pause.http.test.ts`, `geniuspay.test.ts`, tests de facturation existants (faux fournisseur) |
| Réactivation | `QADR_COMMERCIAL_MODE=geniuspay`, clés et webhook déclarés ; étapes : `docs/billing-geniuspay.md` § 0 |

## E. Page publique

- Parcours : formule Standard → WhatsApp (ou « J'ai un code ») → `/redeem-code` → inscription. Lien « J'ai un code »
  aussi dans l'en-tête.
- **Section « Les vrais écrans de Qadr Ops »** (`#screens`) : 8 écrans (tableau de bord, caisse, articles, stock,
  clients et crédits, rapports, ticket, téléphone) dans chaque langue, 48 images webp (1,6 Mo, deux largeurs,
  chargement différé, dimensions réservées).
  - Provenance : l'application réelle en aperçu local, base PGlite en mémoire, jamais une base réelle. Le commerce est
    renommé « Boutique de test » et les fiches de la base d'aperçu reçoivent des noms neutres (« Client test A »).
  - Deux ventes de test sont enregistrées par l'API. Le bandeau d'aperçu est masqué.
  - La section, son badge et chaque texte alternatif disent « données de test » (fr), « test data » (en) et
    « بيانات اختبار » (ar). Aucun chiffre n'est présenté comme une performance.
- **Écart avec la décision du 2026-11-14** (« aucune capture servie ») : le mandat du 2026-11-16 demande des captures
  réelles. L'exception est étroite et testée. `landing-content.test.ts` vérifie :
  - aucune image à la racine de `public/landing/` ;
  - les fichiers servis sous `apercu/` correspondent exactement au manifeste ;
  - le libellé « données de test » est présent dans chaque langue.
  Les mots « démonstration » et « exemple » restent interdits.
- Contrôle de mise en page automatisé (navigateur sans interface) à 320, 360, 390, 768, 1024 et 1280 px en fr, en
  et ar : aucun débordement horizontal, aucune image cassée, `dir="rtl"` en arabe.

## F. Sécurité et architecture

- **Données** (migration 0026, additive) :
  - `commercial_access_code`, sans `business_id`, réservée à la plateforme ;
  - `business_invite_code`, à `business_id`, avec FK composée, politique RLS et droits `qadr_tenant` ;
  - `user.email` nullable ;
  - nouvelles valeurs dans les contraintes d'idempotence et d'audit.
- **Contrôles serveur** :
  - laissez-passer signé (HMAC) vérifié dans `databaseHooks.user.create.before` et à la création du commerce ;
  - rôle et commerce de l'invitation lus en base, jamais dans la requête ;
  - contrôle d'origine (`isTrustedRequest`), puis Turnstile, puis limites, sur toutes les routes publiques de code et
    de connexion (`guardPublicRequest`, `lib/commercial/public-guard.ts`) ;
  - `assertBusinessOperational` pour rejoindre un commerce (403 `business_closed` s'il est fermé).
- **Isolation** : attaques A→B ajoutées pour les nouvelles routes `[codeId]` et `[memberId]` (réponse identique à un
  identifiant inconnu, instantané de B inchangé).
- **Limitation** : règles `code.commercial.*`, `code.invite.*` et `auth.username_sign_in.*` dans `rateRules`. Seuls les
  échecs comptent pour les codes.
- **Audit** :
  - `platform.commercial_code_created/revoked/rejected` ;
  - `subscription.commercial_code_activated` ;
  - `team.invite_code_created/revoked`, `team.member_joined_by_code`, `team.role_changed`, `team.sessions_revoked`.
- **Risques restants** :
  - un code émis par erreur ouvre un vrai accès, car le paiement est vérifié hors de l'application ;
  - changer `QADR_CODE_SECRET` invalide les codes non utilisés ;
  - un employé sans e-mail ne peut pas réinitialiser seul son mot de passe ;
  - l'adresse IP vue derrière Cloudflare et Vercel n'est toujours pas vérifiée (C-11).

## G. Tests (release actuelle uniquement)

Résultats locaux du 2026-11-16, sur le code de ce commit (Windows, Node 24, PGlite migrée). Rien n'est repris d'un
run plus ancien.

| Contrôle | Commande (depuis `apps/web`) | Résultat |
| --- | --- | --- |
| Suite complète | `npx vitest run` | 108 fichiers ; **945 réussis, 1 échoué, 10 ignorés** (956) ; 947 s |
| Échec corrigé | `business-data-export.http.test.ts` | liste figée des tables exportées : la nouvelle table `business_invite_code` y entrait. Elle est désormais exportée, avec `code_hash` retiré par la règle existante. Le test crée une vraie invitation et vérifie l'absence de l'empreinte et du code brut. Relance du fichier : **9/9** |
| Typecheck | `npm run typecheck` | 0 erreur |
| Lint | `npm run lint` | 0 erreur, 0 avertissement |
| Schéma ↔ migrations | `npx drizzle-kit check`, puis `npx drizzle-kit generate` | « Everything's fine », puis « No schema changes » |
| Build | `npm run build` | réussi |
| Mise en page | navigateur sans interface, section `#screens` | 320 à 1280 px, fr/en/ar : 0 débordement, 0 image cassée |

Les 10 tests ignorés sont ceux de `r2.integration.test.ts`. Ils visent le vrai bucket R2 de test et exigent les
variables `QADR_TEST_R2_*`, absentes en local. Ils ne sont pas comptés comme réussis.

La suite complète n'a pas été relancée en entier après la correction : seul le fichier corrigé l'a été. La CI GitHub
relance tout (§ H).

## H. Déploiement

| Point | État constaté |
| --- | --- |
| Dépôt | `ridwangouet747-ai/QADROPS` (encore **public**) |
| Branche, commit | `feat/mission-codes-2026-11-16`, `95c303a` (poussée sans forçage) ; ce rapport est complété par le commit suivant |
| CI GitHub | run `43933258031` « Intégration continue » : **succès**. Étapes réussies : installation `npm ci`, TypeScript, ESLint, schéma et migrations, Vitest (suite complète, PGlite), build, audit des dépendances de production |
| Projet Vercel | `web` (canonique), équipe `qadragency` ; statut GitHub « Vercel » **success** sur `95c303a` |
| Aperçu | `https://web-git-feat-mission-codes-2026-11-16-qadragency.vercel.app`, protégé par l’authentification Vercel (302 vers `vercel.com/sso-api`). L’API Vercel par MCP ne voit pas l’équipe (404), la CLI n’est pas installée et le navigateur demande une connexion : **aucun contrôle fonctionnel distant n’a été fait**. Sans les variables Preview (L-1), ses API répondraient 500 |
| Environnement Neon | sur accord du propriétaire (« migrate then merge », 2026-11-16) : point de retour = branche `sauvegarde-main-avant-0026-2026-11-16` (même LSN que `main` ; pas de `pg_dump`, outils absents du poste, et l’unique instantané de l’offre Free est déjà pris) ; répétition sur `repetition-0026-2026-11-16` (copie de `main`) : 27 migrations, schéma comparé identique à l’intention de 0026 (seul écart, `neon_auth.auth_logs_export_enabled`, géré par Neon et absent de la migration) ; puis `migrate-production.ts` sur `main` : « 26 appliquées, 1 en attente … Terminé en une transaction : 27 ». Contrôle en lecture seule de `main` après coup : 27 migrations, `business_invite_code` sous RLS (1 politique), `commercial_access_code` présente, `user.email` nullable, 45 tables sous RLS, 0 compte, 0 commerce. Une table d’exemple Neon `playing_with_neon` (10 lignes, hors du dépôt) existe sur `main` ; laissée intacte. Les deux branches sont conservées |
| Fusion dans `main` | avance rapide sans forçage `f6573d1..b3dbc64` (2026-11-16) ; CI sur `main` : run `43939264928` **succès** |
| Production | déploiement Vercel `web` : statut GitHub **success** sur `b3dbc64`. `https://web-phi-beryl-45.vercel.app` : `/`, `/redeem-code`, `/join-business`, `/login`, `/register`, `/platform/login` répondent 200 ; la page publique contient la section `#screens` et 4 liens `wa.me/2250508145011` ; aucune erreur dans les journaux de production sur les 15 minutes suivant le déploiement. **Non vérifié** : un parcours complet code → inscription → commerce (Turnstile, aucun code émis, aucune formule publiée) |

## I. Actions du propriétaire

**Indispensable au fonctionnement technique**
1. Rendre le dépôt GitHub `QADROPS` **privé** (il est public ; le code de cette mission y est poussé).
2. `QADR_CODE_SECRET` (48 caractères aléatoires, *Sensitive*), une valeur par environnement (checklist M-2).
3. ~~Migration `0026` sur Neon `main`~~ : faite le 2026-11-16 par l'agent sur votre accord (M-4, § H), puis fusion
   dans `main` et déploiement.
4. Variables Preview du projet `web` (L-1) pour qu'un aperçu Vercel réponde aux API.

**Indispensable à la première activation**
5. ~~`QADR_WHATSAPP_NUMBER`~~ : fait le 2026-11-16 (numéro fourni par le propriétaire, posé en Production et Preview sur
   `web` au format international `225…`, lien `wa.me` vérifié).
6. Créer et publier la formule Standard (P-5 bis, M-5) : un code ne se génère que sur une formule active.
7. `QADR_OWNER_USERNAME` / `QADR_OWNER_PASSWORD` pour ouvrir la console de la plateforme (P-3), puis les retirer.
8. Ajouter votre adresse à `QADR_REGISTRATION_ALLOWLIST` (P-3 bis) : en production, il faut **à la fois** cette liste et
   un code (M-6).

**Indispensable à la commercialisation**
9. Vercel Pro (C-1), puis ouverture des inscriptions `QADR_REGISTRATION=open` (C-3).
10. Neon avec sauvegardes (C-2), domaine et DNS (C-4), Resend (C-5, pour les propriétaires ; les employés n'en ont
    pas besoin), relecture juridique (C-10).

**Nécessaire pour réactiver GeniusPay**
11. `QADR_COMMERCIAL_MODE=geniuspay`, webhook déclaré chez GeniusPay, premier paiement réel de faible montant décidé
    par vous (C-6, `docs/billing-geniuspay.md` § 0).

**Améliorations futures**
12. Envoi du code par WhatsApp Business ou SMS. Réinitialisation du mot de passe d'un employé par son responsable.
    Remplacer la photo de l'aperçu par des captures de staging quand une base de staging sera branchée à un Preview.

Checklist complète : `docs/engineering/owner-action-checklist.md` (sections P, C, M, L).

## J. Verdict

**DÉPLOYÉ EN PRODUCTION, PAS ENCORE OUVERT À LA VENTE.**

Le code de la mission tourne en production depuis le 2026-11-16 (`b3dbc64`, migration 0026 appliquée sur `main`, § H). Pages publiques et lien WhatsApp vérifiés ; le parcours code → inscription → commerce n’a **pas** été exercé en production (Turnstile, aucun code émis).

Ce qui empêche encore de vendre, dans l’ordre :
1. offre Vercel Hobby : usage commercial interdit, donc pas de vente par WhatsApp tant que C-1 n’est pas fait ;
2. formule Standard publiée (sans elle, aucun code ne peut être émis), puis console ouverte (P-3) ;
3. `QADR_CODE_SECRET` propre à la production (M-2) avant d’émettre le premier code, sinon `BETTER_AUTH_SECRET` sert de clé ;
4. dépôt public.

# Mission 16 : lot C, comptes, récupération et sécurité des routes (2026-11-10)

Ce document résume le lot C. Le détail se trouve dans `docs/authentication.md` § 11, `docs/rate-limiting.md` (« Récupération de compte »), `docs/exports.md` (« Taille ») et `docs/engineering/resend-dns.md`.

## Correctifs, chacun couvert par un test de régression

| # | Écart constaté | Correctif | Test |
| --- | --- | --- | --- |
| C-1 | L'inscription répondait `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`, et ce refus était plus rapide qu'une création : l'adresse était révélée deux fois. | Crochet `after` sur `/sign-up/email` : un seul corps `422 SIGN_UP_FAILED` (`signUpRefusal`), et le mot de passe est haché pour que la durée soit comparable. | `auth-security.http.test.ts`, « inscription » (4 tests, dont la mesure de durée) |
| C-2 | `POST /api/account/businesses` et les autres routes authentifiées par cookie ne contrôlaient pas l'origine. Seul `SameSite=Lax` les protégeait, et il laisse passer un sous-domaine frère et un JSON envoyé en `text/plain`. | `src/lib/security/request-origin.ts`. `assertTrustedOrigin` est appelé dans `getBusinessContext`, `getAccountContext`, `getPlatformContext` et les trois routes `/api/account/*` qui écrivent. Refus : 403 `invalid_origin`. | « contrôle d'origine » (4 tests) |
| C-3 | Better Auth désactive son propre contrôle d'origine quand `NODE_ENV=test` : les tests ne vérifiaient pas ce que fait la production. | `advanced.disableOriginCheck: false`. | « routes Better Auth avec cookie » |
| C-4 | Le jeton de réinitialisation était stocké en clair dans `verification`. | `verification.storeIdentifier` : le préfixe `reset-password:` est stocké en empreinte. | « jeton de 24 caractères… » |
| C-5 | Un compte à second facteur (propriétaire de la plateforme) pouvait recevoir un lien de réinitialisation : sa boîte de réception suffisait à reprendre le compte. | `sendResetPassword` n'envoie rien à un compte `twoFactorEnabled`, et la réponse reste identique. | « compte à second facteur » |
| C-6 | Le XLSX n'avait aucune limite en octets (R8 de la mission 15). Un fichier de plus de 4,5 Mo n'aurait pas pu sortir d'une fonction Vercel. | `EXPORT_LIMITS.xlsxXmlBytes` (64 Mio, comptés pendant la génération) et `fileBytes` (4 Mio, pour le XLSX, le CSV et le PDF). Au-delà : 422 `export_too_large`, sans fichier partiel. | `xlsx.test.ts` et « exports : bornes de taille » |
| C-7 | Un 429 sur la demande ou sur le changement de mot de passe affichait « lien invalide » ou une erreur générique. | Messages `auth.forgot.throttled` et `auth.reset.throttled` en fr, en et ar. Le lien reste utilisable. | parité `messages.test.ts` |

## Vérifié de bout en bout, avec un faux transport d'e-mail

Le parcours de récupération a été vérifié contre une vraie instance Better Auth sur PGlite :

- même réponse pour une adresse connue ou inconnue ;
- un seul e-mail, adressé au titulaire ;
- lien valable 1 h, à usage unique ;
- lien de retour vers un autre site refusé ;
- jeton expiré refusé ;
- toutes les sessions fermées après le changement ;
- ancien mot de passe refusé.

**Aucun e-mail réel n'a été envoyé.** Resend n'a aucun domaine vérifié (voir `resend-dns.md`).

## Limites connues

- Inscription : une inscription acceptée ouvre une session, un refus non. Quelqu'un qui réussit le défi Turnstile peut donc encore savoir qu'une adresse est inscrite, une adresse à la fois. C'est limité à 30 inscriptions par heure et par adresse IP. Pour fermer complètement cette fuite, il faut rendre la vérification d'adresse obligatoire, ce qui demande une décision du propriétaire et un Resend opérationnel.
- Le blocage par compte (3 demandes par heure) peut être déclenché volontairement par un tiers. La victime attend alors au plus une heure.
- L'adresse IP réelle derrière Cloudflare et Vercel n'est pas vérifiée. Les limites par adresse IP en dépendent.

## Commandes exécutées

Toutes depuis `apps/web`, le 2026-11-10 :

- `npx vitest run src/test/auth-security.http.test.ts src/lib/exports/xlsx.test.ts src/lib/i18n/messages.test.ts` : 3 fichiers, 35 tests réussis.
- `npx tsc --noEmit` : aucune erreur.
- Régression complète : voir le compte rendu final de la mission 16.

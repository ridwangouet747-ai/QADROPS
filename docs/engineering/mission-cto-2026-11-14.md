# Mission CTO du 2026-11-14 : audit global, corrections et préparation à l'exploitation

> Rapport de l'agent. Rien n'a été déployé en production ni fusionné dans `main` pendant cette mission.
> Les essais ont été faits en local (PGlite migrée, harnais HTTP, sessions Better Auth réelles) et en lecture seule
> sur Neon Production (comptages). Aucun paiement, aucune donnée métier, aucun compte n'a été créé en production.
> Règle finale du mandat : **Qadr Ops n'est pas déclaré pleinement opérationnel** ; ce rapport dit ce qui est
> prouvé et ce qui ne l'est pas.

## 1. État global

| Domaine | État au 2026-11-14 |
| --- | --- |
| Production Vercel | `https://web-phi-beryl-45.vercel.app`, `main` = `f6573d1`, offre **Hobby** (usage commercial interdit) |
| Base Neon `main` | 26 migrations appliquées, **vide** : 0 commerce, 0 utilisateur, 0 formule, 0 propriétaire de plateforme |
| Inscriptions en production | réservées à `QADR_REGISTRATION_ALLOWLIST` ; variable non posée, donc aucune inscription possible |
| Parcours commercial | corrigé par cette mission (voir § 4) ; jamais exercé en production faute de compte et de formule |
| Paiement GeniusPay | code complet et testé contre un faux fournisseur ; aucun paiement réel ; webhook non déclaré chez GeniusPay |
| Dépôt GitHub `QADROPS` | **encore public** le 2026-11-14 au soir (API GitHub anonyme : 200) |
| Sauvegarde | restauration prouvée le 2026-11-13 ; Neon Free sans sauvegarde planifiée ; workflow GitHub non encore lancé |

Conclusion : l'application est **prête pour un usage personnel contrôlé** une fois les actions P de la checklist
faites. Elle n'est **pas prête à accueillir des commerçants tiers ni à encaisser** (offre Vercel, Resend, domaine,
webhook GeniusPay, formule, relecture juridique).

## 2. Problèmes constatés

| # | Gravité | Zone | Cause | Conséquence | Correction | Test |
| --- | --- | --- | --- | --- | --- | --- |
| A-1 | **Critique** | Accès commercial | `getBusinessContext` ne regardait que l'état d'expiration ; un commerce `pending` (aucun abonnement, essai ni code) passait | un compte créé sans payer accédait à tout le tableau de bord, par l'interface comme par appel direct d'API | garde `commercial-access.ts` (403 `subscription_required`) dans `getBusinessContext` ; dérogation explicite `allowWithoutSubscription` pour 7 routes d'abonnement, paiement, code, notifications, export ; garde de page `requireBusinessPageAccess()` sur 10 pages `/business/*` | `commercial-access.http.test.ts` (6), `business-page-access.http.test.ts` ; tests existants adaptés (essai accordé par défaut dans le harnais) |
| A-2 | Haute | Parcours | l'assistant d'inscription menait au tableau de bord quel que soit l'état | le commerçant voyait un écran qu'il ne pouvait pas utiliser | fin d'assistant vers `/business/subscription` tant qu'aucun droit d'usage | couvert par A-1 (redirection serveur), contrôle visuel |
| A-3 | Haute | Page publique | captures et chiffres d'exemple (ventes, clients, montants) servis en production, dans les trois langues | une promesse ou un chiffre pouvait être pris pour réel | téléphone, ticket et journée schématiques (libellés réels, valeurs en traits), 6 captures déplacées dans `docs/product/captures-apercu/`, textes « démonstration » retirés | `landing-content.test.ts` (5) : mots interdits fr/en/ar, anciens chiffres et noms, aucune image dans `public/landing/` |
| A-4 | Moyenne | Identité | logo du commerce non modifiable après l'inscription, affichage différent selon l'écran, initiale perdue (conflit de classes Tailwind non résolu par `cn`) | identité incohérente entre en-tête, choix du commerce, invitations | composant unique `BusinessLogo`, logo dans les réglages (absent = inchangé, `null` = retiré), contrôle du type réel et de la taille (`LOGO_MAX_CHARS` 60 000), événement `qadr:business-updated` | `business-branding.http.test.ts` (6) dont isolation entre commerces et refus d'un SVG déguisé |
| A-5 | Moyenne | Mise en page | groupe de droite de l'en-tête en `min-w-0` : boîte réduite, enfants débordants | défilement horizontal de 27 à 55 px à 360, 1024 et 1100 px | groupe `shrink-0`, sélecteur de langue compact sous `xl`, marges de navigation réduites | mesure automatisée : 0 px de débordement à 320/360/1024/1100/1280 px en fr/en/ar |
| A-6 | Moyenne | Sécurité opérationnelle | dépôt public | code, docs et architecture lisibles par tous | aucune (action du propriétaire) | balayage des 72 commits : aucun secret, aucun `.env` jamais commité |
| A-7 | Moyenne | Exploitation | un code d'accès ne se crée que sur une formule **active** (règle de la mission 08) | pour ouvrir son propre commerce sans paiement, le propriétaire doit activer la formule quelques minutes | procédure documentée (P-5 ter) ; aucun changement de règle sans décision | — |
| A-8 | Basse | Mise en page | à 1024 px l'en-tête ne montre que le logo du commerce | nom complet seulement dans `title` / `aria-label` | assumé (nom visible dès `xl` et sur mobile) | capture |
| A-9 | Info | Sécurité | 2FA du propriétaire facultative (D-05) | un mot de passe volé suffit à ouvrir la console de la plateforme | non modifié (décision du propriétaire) ; fortement conseillé (P-5) | — |
| A-10 | Info | Données | RLS active seulement pour l'export complet | les autres routes reposent sur le filtrage applicatif (testé par `tenant-isolation.http.test.ts`) | non étendu dans cette mission (plan : audit de sécurité § 4.4) | `tenant-rls.http.test.ts` |

Contrôle des données d'amorçage : aucun script de *seed* n'écrit en production ; `ensure-standard-plan.ts` est
idempotent et crée la formule **inactive** ; l'aperçu (PGlite en mémoire) est refusé par `getDatabase()` hors
développement.

## 3. Corrections

| Statut | Éléments |
| --- | --- |
| Corrigé et testé | A-1, A-2, A-3, A-4, A-5 |
| Non testable en production | paiement GeniusPay réel, webhook réel, e-mails Resend, push sur téléphone, impression thermique, adresse IP derrière Cloudflare |
| En cours | contrôle de l'aperçu Vercel (Preview) de cette branche après poussée |
| Non corrigé | A-8 (assumé), A-10 (extension de la RLS, chantier à part) |
| Décision du propriétaire | A-6 (dépôt privé), A-7 (codes sur formule inactive ?), A-9 (2FA obligatoire ?), offre Vercel Pro et Neon payante, tarif public |

## 4. Parcours commercial

Page publique → formule → compte → commerce (assistant) → **page Abonnement** → paiement GeniusPay ou code →
confirmation **par le serveur** → tableau de bord.

- Le retour de GeniusPay (`/business/subscription/return`) n'active rien : l'activation suit la relecture
  `GET /payments/{reference}` ou le webhook signé, une seule fois (idempotence de la facture).
- Sans droit d'usage : chaque route métier répond 403 `subscription_required`, chaque page `/business/*`
  redirige vers `/business/subscription`. Tests : URL directe de page, appel direct d'API, commerce ou statut
  glissés dans la requête, paiement en attente puis redirection de retour, paiement refusé, code inconnu, relecture
  répétée du retour (une seule activation), commerce d'un autre propriétaire (réponse identique à un paiement
  inconnu). Une session ouverte avant l'expiration n'a pas de test dédié : la garde relit l'état commercial en base
  à chaque requête, sans cache dans la session.
- Échu ou suspendu : lecture ouverte, écriture refusée (inchangé).
- Non prouvé en production : il n'existe encore ni compte, ni formule, ni paiement réel.

## 5. Intégrations

| Service | Configuré | Vérifié | Reste |
| --- | --- | --- | --- |
| Vercel | oui (Hobby, Node 24.x) | déploiement READY | offre Pro avant tout commerçant tiers |
| Neon | oui (`main` migrée) | sauvegarde restaurée, RLS par le pooler | offre avec sauvegardes ; secrets du workflow |
| GeniusPay | clés live posées | **non** (seule vérification = paiement réel) | déclarer le webhook ; premier paiement de faible montant décidé par le propriétaire |
| Resend | non | non | domaine, DNS, clé |
| Turnstile | clés posées | refus vérifiés en test, pas en production | contrôle sur le domaine définitif |
| Sentry | DSN posés | aucun événement observé | provoquer une erreur contrôlée après P-3 |
| Web Push | `VAPID_SUBJECT` posé | non | réception sur un téléphone |
| R2 | non | non | bucket privé et jetons |
| Crons Vercel | déclarés | non observés | lire les journaux après 24 h |
| PostHog | après consentement | non | — |

## 6. Ce que le propriétaire doit fournir

Détail et procédures : `owner-action-checklist.md`.

**Bloquant avant le premier utilisateur (vous)**
- Dépôt GitHub en privé, renouvellement de toute clé collée hors Git pendant la période publique.
- `QADR_OWNER_USERNAME` / `QADR_OWNER_PASSWORD` (P-3), `QADR_REGISTRATION_ALLOWLIST` (P-3 bis).
- Formule Standard créée inactive (P-5 bis), puis votre commerce ouvert par un code (P-5 ter).
- Conseillé : second facteur (P-5).

**Avant le premier commerçant pilote**
- Offre Vercel Pro (C-1), Neon avec sauvegardes (C-2), secrets GitHub de sauvegarde (P-4).
- Domaine, DNS Cloudflare, `BETTER_AUTH_URL`, Turnstile sur ce domaine (C-4).
- Resend (C-5), sans quoi ni invitation ni réinitialisation par e-mail.
- Relecture de `/privacy` et des conditions (C-10).

**Avant tout encaissement réel**
- Webhook déclaré chez GeniusPay et premier paiement de faible montant décidé par vous (C-6).
- Formule activée au tarif décidé (D-04 : 5 000 FCFA / 30 jours).

**Avant l'ouverture commerciale**
- `QADR_REGISTRATION=open` (C-3), vérification de l'adresse IP vue par la limitation (C-11).
- Décisions : 2FA obligatoire ? codes sur formule inactive ?

**Plus tard**
- Variables Preview (L-1), R2 (L-2), push et impression réels (L-5), sort de la préparation Workers (L-7),
  revue mensuelle des accès (L-8).

## 7. Plan d'exploitation

1. **Chaque jour** : Sentry (nouvelles erreurs), journaux Vercel des crons `/api/cron/*`, factures
   `subscription_invoice` restées `pending` plus de 24 h.
2. **Chaque semaine** : lancement du workflow « Sauvegarde Neon » et contrôle de l'archive ; `npm audit` sur
   `apps/web` ; relecture des événements d'audit de la plateforme.
3. **Chaque mois** : restauration d'essai sur une branche Neon jetable (`backup-restore.md`), revue des accès
   (L-8), rotation des secrets exposés à un tiers.
4. **Toute modification** : branche, CI verte (lint, types, tests, build), aperçu Vercel, puis fusion décidée par
   le propriétaire ; toute migration de production par `scripts/migrate-production.ts` après répétition sur une
   copie de `main`.
5. **Incident** : `production-runbook.md` (retour au déploiement précédent par Vercel, aucune restauration de base
   sans accord).

## Vérifications de cette mission

- `npm run lint`, `npx tsc --noEmit` : sans erreur.
- `npx drizzle-kit check` : « Everything's fine » ; `npx drizzle-kit generate` : « No schema changes » (aucune
  migration ajoutée).
- `npx vitest run` (suite complète, PGlite) : 103 fichiers, **880 tests réussis**, 10 ignorés (essais réels R2 et
  PostgreSQL, qui exigent des variables `QADR_TEST_*`), 0 échec. `business-branding.http.test.ts` et
  `landing-content.test.ts` relancés seuls après leur dernière modification : 11/11.
- `npm run build` : réussi.
- Débordement horizontal mesuré par navigateur sans interface : 0 px à 320, 360, 1024, 1100 et 1280 px, en fr, en
  et ar.
- Non fait : aucun essai sur Neon de staging ni en production, aucun paiement, aucun e-mail, aucune capture d'un
  téléphone réel.

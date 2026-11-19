# Mission CTO du 2026-11-19 : caisse, forfaits publics, connexion des employés

> Rapport de l'agent. Il sépare ce qui est prouvé (commande, résultat) de ce qui ne l'est pas.
> Aucun paiement réel, aucune vente, aucun client ni aucun compte n'a été créé en production.
> Branche `feat/mission-codes-2026-11-16`. **Aucune migration** : `drizzle-kit check` et `drizzle-kit generate`
> répondent « No schema changes ».

**Verdict : livré en production (`9ea0e31`), voir § K.

## A. Connexion des employés (codes EQP-)

- **Cause** : `/login` ouvrait l'onglet « E-mail » par défaut, avec un champ `type=email`. Après une déconnexion, un
  employé (compte sans e-mail, nom d'utilisateur seul) tapait son nom d'utilisateur dans ce champ : le navigateur
  refusait l'envoi. Le serveur, lui, fonctionnait (`signInByUsername`, testé).
- **Correction** : un seul champ « E-mail ou nom d'utilisateur » (`lib/auth/login-identifier.ts`) ; un « @ » envoie
  vers la connexion par e-mail, sinon vers `/api/account/sign-in/username`. Un nom d'utilisateur valide ne contient
  jamais « @ » (`usernameSchema`, testé). « Mot de passe oublié » mène à `/recover-account` quand l'identifiant est
  un nom d'utilisateur.
- **Tests** : `login-identifier.test.ts` (3) ; `team-invite-codes.http.test.ts` « 8 bis » : déconnexion → 401 →
  reconnexion par nom d'utilisateur → accès au commerce avec le rôle fixé par le code → le code déjà utilisé reste
  refusé (409). Révocation, changement de rôle et fermeture des sessions : tests existants du même fichier, verts.
- Connexion des commerçants par e-mail : inchangée.

## B. Forfaits sur la page publique

- **Cause** : `pricing-section.tsx` filtrait `plan.code === "STANDARD"` ; tout autre forfait publié restait
  invisible. Et aucune route n'invalidait le cache de 10 minutes.
- **Correction** : toutes les formules actives en XOF sont montrées, triées par prix ; disposition
  `lib/landing/pricing-layout.ts` (1 colonne sur téléphone, 2 sur tablette, 3 au-delà, 4 cartes en 2 × 2) ;
  `invalidatePublicPlans()` après `POST /api/platform/plans` et `PATCH /api/platform/plans/[planId]`.
- Libellé de la console : « Publié : visible sur la page publique et attribuable » / « Non publié (masqué) ».
- **Limite** : pas d'état distinct « brouillon » ou « archivé » (il faudrait une migration de `subscription_plan`).
  Un forfait n'est jamais supprimé ; le retirer le masque et ses abonnements gardent leur référence.
- **Tests** : `pricing-section.test.ts` (1, 2 et 10 formules, état vide, base indisponible, disposition) ;
  `public-plans-publication.http.test.ts` (10 forfaits créés par la route, champs publics seulement, forfait non
  publié absent, retrait puis republication, rien d'effacé). Aperçu local : 3 formules et l'offre Business visibles
  (avant : Standard seule).

## C. Caisse

- Formules inchangées et désormais testées sur les exemples du mandat (1 000/1 000, 2 000/10 000, 300 000/301 000,
  chaque Mobile Money, mixte, mixte avec monnaie, surplus Mobile Money refusé, partiel, crédit, préremplissage).
- **Confirmer la réception** : chaque ligne Mobile Money ou « autre » exige une case cochée par le caissier ; la
  vente ne part pas sans elle ; modifier le montant ou le moyen la décoche. Vérifié dans l'aperçu local : bouton
  « Encaisser » désactivé, puis actif après la case.
- **Référence de transaction** facultative (`payment.provider_reference`, unique par commerce, 409
  `payment_reference_used` en cas de doublon ; refusée sur les espèces ou en double dans une vente).
- « Reste dans le tiroir » (= remis − rendu) affiché sous la monnaie à rendre ; le Mobile Money n'entre jamais dans la
  caisse (`cash_session_id` nul, testé).
- **Tests** : `settlement.test.ts` (21), `commercial.integration.test.ts` (référence, doublon, rejeu, caisse).

## D. Ticket

- Chaque ligne Mobile Money porte « enregistré manuellement » et sa référence éventuelle (fr/en/ar, référence isolée
  de gauche à droite en arabe). Vérifié à l'écran dans l'aperçu local : « Wave 3 500 F », « enregistré
  manuellement », « Réf. WV-TEST-1911 », caissier, « Statut : Payé ».
- Retour par le logo et masquage de la navigation à l'impression : déjà livrés le 2026-11-17 (inchangés).
- Le détail de la vente montre aussi la référence, la somme remise et la monnaie.
- **Non vérifié sur une imprimante réelle (B-2).**

## E. Produits, crédits, e-mail facultatif, Super Admin, WhatsApp

- Formulaire produit : colonnes réductibles (`minmax(0,1fr)`) pour qu'un libellé long ne chevauche pas le champ voisin.
  Non contrôlé visuellement à 320 px.
- Crédits (dette de départ, remboursements partiels et totaux, historique), e-mail facultatif et accès Super Admin :
  livrés lors des missions précédentes, non modifiés.
- WhatsApp : non modifié.

## F. Page publique « cinématique »

Les images de référence annoncées par le mandat ne se trouvent pas dans l'espace de travail (seules les images du
projet vidéo `production-video/`, distinct, non suivi). Aucune direction visuelle n'a été inventée à leur place :
à fournir (chemin ou fichiers) pour cette partie.

## G. Vérifications

| Contrôle | Commande (depuis `apps/web`) | Résultat |
| --- | --- | --- |
| Vitest complet, machine seule | `npx vitest run` | **119 fichiers, 1 054 réussis, 10 ignorés, 0 échec** (2 245 s). Les 10 ignorés : bucket R2 réel, sans `QADR_TEST_R2_*` (prévu). |
| Types | `npm run typecheck` | 0 erreur |
| ESLint | `npm run lint` | 0 erreur |
| Schéma | `npx drizzle-kit check` puis `generate` | « No schema changes » |
| Build | `npm run build` | réussi |
| Secrets | motifs (URL Postgres, `npg_`, clés Stripe/Resend/GitHub/AWS/Vercel/Turnstile, JWT, clés privées) sur tout le diff et les nouveaux fichiers | aucun |

### Test d'export expliqué

`exports.integration.test.ts`, « ignore les identifiants de commerce et d'utilisateur glissés dans la requête », a
dépassé 30 s deux fois. **Cause** : ce test était le premier à faire `await import()` de la route
`/api/business/reports/export` ; son temps comptait donc le chargement à froid de tout le graphe de modules (Next,
Better Auth, Sentry, générateurs XLSX/PDF). Mesuré machine au repos : 12 099 ms pour ce test, ~100 ms pour les
autres. Pendant la suite complète (phase d'import cumulée : 1 338 s), ce chargement dépassait la limite.
**Correction** : l'import se fait une fois dans un `beforeAll` (limite des hooks : 120 s) ; les assertions sont
identiques. Après correction : 172 ms pour ce test, 8/8 verts. La route n'avait aucun défaut.

### Parcours métier sur Neon staging

Le projet Vercel `web` n'a aucune variable de base pour Preview (toutes limitées à Production) : un déploiement
Preview n'aurait pas de base, donc ni parcours métier possible ni risque d'écrire en production. Les parcours ont
été validés par le harnais HTTP sur PostgreSQL réel (`QADR_TEST_POSTGRES_TARGET=staging`, branche
`mission-14-staging`, rôle `qadr_m14_staging`, une base jetable `qadr_t_*` par fichier, supprimée ensuite), un
fichier à la fois :

| Fichier | Résultat |
| --- | --- |
| `merchant-journey.http.test.ts` | 11/11 |
| `team-invite-codes.http.test.ts` (reconnexion employé comprise) | 18/18 |
| `public-plans-publication.http.test.ts` | 4/4 |
| `tenant-isolation.http.test.ts` | 21/21 |
| `commercial-sign-up.http.test.ts` | 10/11, puis **11/11** après correction |

**Défaut trouvé sur PostgreSQL réel (présent en production depuis le 2026-11-18)** : deux inscriptions simultanées
avec le même nom d'utilisateur lisaient toutes deux « libre » ; l'index `user_username_unique` refusait la seconde
(SQLSTATE 23505), non convertie, d'où un **500** au lieu de 409. PGlite sérialise les requêtes et ne pouvait pas le
montrer. Correction : `usernameTakenOnRace` (`lib/domain/team-codes.ts`, via `lib/db/unique-violation.ts`, testé)
transforme cette violation en 409 `username_taken`, pour l'inscription sans e-mail et pour l'entrée d'un employé par
code `EQP-`.

Le premier passage complet (74 fichiers « en échec ») est écarté : 73 fichiers n'avaient pas pu se charger
(`ENOENT` sur un fichier temporaire de Vitest, effacé par un second Vitest lancé en parallèle), aucun test
n'avait échoué sur une assertion.

## H. Livraison

| Étape | Preuve |
| --- | --- |
| Commits | `7f65df4` (mission), `9ea0e31` (course d'inscription), branche `feat/mission-codes-2026-11-16`, sans force |
| CI GitHub | runs 44581540975 (`7f65df4`) et 44600908679 (`9ea0e31`) : succès |
| `main` | avance rapide `7f64f6d..9ea0e31` (ancêtre vérifié, aucune fusion) |
| Vercel `web`, production | `dpl_AsLe7m3bZWHFWmkNGubAQM8nL83K`, état READY, SHA `9ea0e31`, alias `web-phi-beryl-45.vercel.app`, `web-qadragency.vercel.app`, `web-git-main-qadragency.vercel.app` |
| Pages (adresse canonique) | `/`, `/login`, `/register`, `/redeem-code`, `/join-business`, `/recover-account`, `/platform/login` : 200 ; `/business/sales` sans session : 307 ; `/api/account/me` sans session : 401 ; URL propre au déploiement : protection Vercel (302 SSO) |
| Contenu servi | `/login` : un seul champ « E-mail ou nom d'utilisateur », aucun `type="email"`, lien « Zone de l'administration » ; Tarifs : la formule publiée en base (5 000 F CFA pour 30 jours) |
| Erreurs | Sentry, production, dernière heure : aucune ; journaux Vercel de la fenêtre : 0 enregistrement renvoyé (ingestion non confirmée) |

Rien n'a été écrit dans Neon Production : ni vente, ni paiement, ni compte, ni formule.

## K. Verdict

**Livré en production et vérifié** pour la connexion des employés, les forfaits publics, la caisse (Mobile Money
déclaratif, référence, tiroir) et le ticket, ainsi que pour la course d'inscription trouvée sur staging.
**Non vérifié** : affichage de 2 et 10 formules en production (une seule est publiée ; couvert par les tests),
impression sur imprimante réelle (B-2), formulaire produit à 320 px, journaux Vercel de la fenêtre.
**Non fait** : page publique « cinématique » (images de référence absentes), états « brouillon » et « archivé » des
formules (migration nécessaire), Preview sur staging (le projet `web` n'a pas de base Preview).

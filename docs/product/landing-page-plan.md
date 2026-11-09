# Landing page Qadr Ops : cahier des charges

> **Statut : cahier des charges. Rien n'est construit.** Ce document prépare la future page publique de
> présentation. Il ne modifie ni le code ni l'existant. Rédigé le 2026-11-09 à partir de l'inspection du
> dépôt (`apps/web/src/app/`, `docs/`, `design-system/`).
>
> Toute affirmation de la page sur le produit doit correspondre à une fonction **réellement codée** et
> décrite dans `docs/`. En cas de doute, on ne l'écrit pas.

## 0. Constats préalables (écarts à trancher)

Ces points ressortent de l'inspection. Ils conditionnent la construction et sont repris au § 9.

1. **Une page d'accueil existe déjà à `/`** (`apps/web/src/app/page.tsx`, composant
   `components/landing/sector-picker.tsx`, styles `.site-header`, `.hero-section`… dans `src/app/legacy.css`).
   Elle est en français écrit en dur (pas de `t()`), n'utilise ni Tailwind ni `src/components/ui/`, n'a aucun
   lien vers `/register` ou `/login`, et affiche « Produit en construction · Les fonctions présentées décrivent
   la cible du produit » ainsi qu'une « maquette fictive ». La nouvelle landing la **remplacera** : décision du
   propriétaire requise (remplacement direct, ou conservation provisoire).
2. **Conflit de direction artistique.** La demande cite les polices Calistoga/Inter et les jetons du design
   system. Or :
   - `design-system/qadr-ops/MASTER.md` : bleu `#2563EB`, orange `#EA580C`, fond `#F8FAFC`, Calistoga + Inter ;
   - `docs/design-system.md` (mission 04, « direction artistique officielle ») et `src/app/globals.css` :
     fond lavande `canvas #F3F2FB`, violet `brand #5B4DF2`, bleu nuit `night #1B1A2E`, police **Plus Jakarta
     Sans** chargée par `next/font` ; « Calistoga est retirée », « l'orange n'est plus utilisé dans l'interface ».
     Inter n'est chargée nulle part.

   Le code suit aujourd'hui la mission 04. Le propriétaire doit choisir : (a) landing alignée sur l'application
   (Plus Jakarta Sans, violet/nuit), recommandé pour la cohérence entre la page et les captures du logiciel ;
   ou (b) identité « marketing » Calistoga (titres) + Inter (texte), à charger **seulement** sur la landing,
   avec les jetons existants de `@theme` pour les couleurs. Dans les deux cas, l'arabe utilise la police arabe
   du système (`--font-arabic`), les polices latines ne couvrant pas l'arabe.
3. **Le rendu statique est aujourd'hui impossible.** La mise en page racine (`src/app/layout.tsx`) appelle
   `getRequestLocale()`, qui lit le cookie `qadr-locale` via `cookies()` (`src/lib/i18n/server.ts`) : toute
   page, y compris `/`, est donc rendue à la demande. Voir § 3.2 pour la proposition.
4. **Ni `robots.ts` ni `sitemap.ts`** n'existent dans `src/app/`.
5. **`/privacy` existe** mais : texte en français seulement, bandeau « projet à valider juridiquement », et
   métadonnées `robots: { index: false }` (via `localizedPageMetadata`). Aucune page de **conditions
   générales** n'existe.
6. **Paiement des abonnements** : GeniusPay est intégré mais n'a été essayé qu'en bac à sable
   (`docs/billing-geniuspay.md`, `docs/privacy/data-map.md`). Rien ne peut être annoncé comme actif.

## 1. Objectifs et public

### 1.1 Objectifs

1. Faire comprendre en moins de 10 secondes ce que fait Qadr Ops : **vendre, suivre le stock, la caisse et les
   crédits, chaque commerce dans son propre espace**.
2. Convertir : créer un compte (`/register`) ou se connecter (`/login`).
3. Rassurer sans exagérer : montrer le vrai logiciel, dire clairement ce qui existe et ce qui n'existe pas.
4. Être trouvée : référencement sur des requêtes comme « logiciel de gestion de stock Côte d'Ivoire »,
   « logiciel de caisse quincaillerie », « gestion boutique Abidjan » (liste à valider par le propriétaire).

### 1.2 Public

| Public | Attente | Conséquence sur la page |
| --- | --- | --- |
| Propriétaire de petit commerce (quincaillerie, téléphonie, boutique, vêtements), Côte d'Ivoire | Savoir si l'outil est simple, combien il coûte, s'il marche sur son téléphone | Phrases courtes, visuels du vrai écran sur téléphone, prix clair, pas de jargon |
| Gérant ou caissier envoyé par le propriétaire | Se connecter vite | Bouton « Se connecter » visible en permanence |
| Utilisateur peu à l'aise avec la lecture ou les logiciels | Comprendre par l'image | Icônes **avec** libellé, captures annotées, peu de texte par bloc |
| Lecteur anglophone ou arabophone | Lire dans sa langue | fr/en/ar, arabe en RTL complet |

## 2. Principes

- **Premium** : composition aérée, typographie soignée, captures nettes, ombres légères (`shadow-card`). Pas
  d'effet gratuit.
- **Moderne** : grille propre, cartes `rounded-xl`, boutons pilule, mêmes composants que l'application.
- **Chaleureuse** : photos de vrais commerces de proximité, ton direct et respectueux (« votre boutique »,
  « votre équipe »), jamais condescendant.
- **Professionnelle** : aucun chiffre inventé, aucun témoignage fictif, mentions légales présentes.
- **Mobile-first** : conçue d'abord pour un écran de 360 à 390 px, connexion 3G/4G irrégulière ; l'ordinateur
  est une adaptation.
- **Rapide** : budget de performance chiffré (§ 3.6), aucune bibliothèque lourde (ni three.js, ni Lottie, ni
  GSAP sur la landing ; l'animation de l'inscription reste sur `/register`).
- **Accessible** : contraste ≥ 4,5:1 (jetons `fg`, `fg-muted` déjà conformes), cibles tactiles ≥ 44 px
  (`Button`), navigation clavier, `prefers-reduced-motion` respecté, textes alternatifs sur chaque visuel.
- **Orientée conversion** : un seul appel principal (« Créer mon compte ») répété aux endroits clés, un appel
  secondaire (« Voir le logiciel » / « Se connecter »).

## 3. Architecture technique proposée (dans `apps/web`)

> Avant d'écrire du code : lire `apps/web/node_modules/next/dist/docs/` (Next.js 16.4, voir `AGENTS.md`),
> notamment les conventions `metadata`, `sitemap`, `robots`, `generateStaticParams` et groupes de routes.

### 3.1 Route

- Route publique `/` (remplace l'actuelle `src/app/page.tsx`, voir § 0.1).
- Composants dans `src/components/landing/` (dossier existant, à reprendre ; `sector-picker.tsx` sera réécrit
  avec `t()` et Tailwind).
- Aucune donnée de commerce, aucune session, aucun appel à la base sur la landing.

### 3.2 Rendu statique et langue

Problème : la mise en page racine lit un cookie, ce qui rend toute page dynamique (§ 0.3).

Proposition (à valider après lecture de la doc Next.js 16) :
- groupes de routes avec deux mises en page racines : `(marketing)` pour les pages publiques, `(app)` pour le
  reste, qui garde la lecture du cookie ;
- langue portée par l'URL pour les pages publiques : `/` (français par défaut), `/en`, `/ar`, générées par
  `generateStaticParams`, avec `lang` et `dir` posés sur `<html>` dans la mise en page `(marketing)` ;
- balises `hreflang` (`alternates.languages`) entre les trois versions ;
- le sélecteur de langue de la landing écrit aussi le cookie `qadr-locale`, pour que `/register` et `/login`
  s'ouvrent dans la langue choisie.

Alternative plus simple : garder le cookie et accepter un rendu dynamique mis en cache par Vercel/Cloudflare.
Moins bon pour le référencement (une seule URL pour trois langues) ; à écarter sauf contrainte.

Points de vigilance : `PwaRegistrar`, `AnalyticsProvider` et `I18nProvider` sont aujourd'hui dans la mise en
page racine ; la mise en page `(marketing)` doit décider lesquels elle garde (le service worker doit rester
enregistré pour que l'application reste installable ; il n'intercepte que les navigations et ne met en cache
que `/offline.html`, voir `docs/pwa.md`).

### 3.3 Textes et traductions

- Toutes les chaînes dans `src/lib/i18n/messages/` (nouveau fichier `landing.ts`, clés `landing.*`, sur le
  modèle de `meta.ts` : `landingFr`, `landingEn: LandingMessages`, `landingAr`).
- `messages.test.ts` vérifie déjà la parité des clés et des variables : la landing en bénéficie.
- Arabe : relecture par un locuteur natif **avant publication** (limite déjà notée dans
  `docs/design-system.md`).
- Montants : `formatXof` (`src/lib/i18n/format.ts`), qui isole chaque montant pour l'arabe.
- Nombres, téléphones, adresses e-mail : `dir="ltr"` / `<bdi>`.

### 3.4 Interface

- Tailwind CSS 4.3.3 et jetons `@theme` de `src/app/globals.css` uniquement (la palette Tailwind par défaut
  est retirée ; aucune couleur arbitraire).
- Composants `src/components/ui/` : `Button` / `buttonClasses` (liens d'appel), `Card`, `Badge`, `Alert`,
  `Icon` (seules les flèches se retournent en RTL), `PageHeader` si utile.
- Le preflight Tailwind n'est pas chargé : chaque composant pose ses marges (`m-0`).
- Propriétés logiques partout (`ms-`, `pe-`, `start-`, `text-start`, `border-s`).
- La landing ne dépend **pas** de `legacy.css` ; les classes `.site-header`, `.hero-section`… pourront être
  retirées de `legacy.css` une fois l'ancienne page supprimée (à faire dans la même livraison, après
  vérification qu'aucun autre écran ne les utilise).

### 3.5 Polices

Selon la décision du § 0.2 :
- option (a) : Plus Jakarta Sans déjà chargée (~27 Ko, latin) ; aucun coût supplémentaire ;
- option (b) : Calistoga (titres, ~20 Ko latin) + Inter (texte, sous-ensemble latin, graisses 400/600
  seulement), via `next/font/google` (fichiers auto-hébergés, aucun appel à Google à l'exécution), chargées
  dans la mise en page `(marketing)` uniquement, `display: "swap"`.

En arabe : police arabe du système (`--font-arabic`), titres en gras dans cette police.

### 3.6 Budget de performance (téléphone d'entrée de gamme, 4G lente)

| Mesure | Budget |
| --- | --- |
| HTML + CSS critique | ≤ 50 Ko compressés |
| JavaScript de la page (hors cadre Next.js) | ≤ 30 Ko compressés ; la page doit être lisible sans JavaScript |
| Polices | ≤ 60 Ko au total, préchargées, `swap` |
| Image principale (LCP) | ≤ 120 Ko (AVIF/WebP via `next/image`, `priority`, tailles adaptées) |
| Poids total au premier affichage | ≤ 400 Ko |
| LCP | < 2,5 s ; CLS < 0,1 ; INP < 200 ms (profil mobile Lighthouse) |

Règles : images sous le pli en chargement différé, dimensions toujours déclarées, aucune vidéo en lecture
automatique, aucun carrousel, aucune police d'icônes (icônes SVG de `icon.tsx`). Mesure à faire sur un vrai
téléphone Android d'entrée de gamme avant publication ; une mesure en émulation ne vaut pas preuve.

### 3.7 Référencement et métadonnées

- `generateMetadata` par langue : `title`, `description` (partir de `meta.siteTitle` / `meta.siteDescription`
  existants), `alternates.canonical`, `alternates.languages` (fr, en, ar, `x-default` → fr).
- Open Graph et Twitter : image 1200×630 par langue (§ 6), `og:locale` `fr_FR` / `en_GB` / `ar`.
- `src/app/robots.ts` : autoriser `/`, `/en`, `/ar`, `/privacy`, futures conditions ; interdire `/business`,
  `/platform`, `/api`, `/onboarding`, `/select-business`, `/invitations`, `/design-system`.
- `src/app/sitemap.ts` : pages publiques seulement, avec variantes de langue.
- Données structurées JSON-LD `Organization` (Qadr Agency) et `SoftwareApplication` **sans** note ni avis
  (`aggregateRating` interdit tant qu'il n'existe pas de vrais avis vérifiables). `offers` seulement quand les
  prix sont fixés.
- Décision à prendre : rendre `/privacy` indexable (aujourd'hui `index: false`).
- Domaine canonique : à fixer (cf. `docs/production-setup-guide.md`, domaine de production non créé).

### 3.8 Mesure d'audience

- PostHog seulement après consentement (existant, `docs/analytics.md`). Les événements de la landing
  (clic « Créer mon compte », choix de langue, ouverture FAQ) doivent être **ajoutés au catalogue fermé**
  `src/lib/analytics/events.ts` ; aucun autre événement n'est envoyé.
- Aucun outil tiers supplémentaire (pas de pixel publicitaire) sans décision et mise à jour de
  `docs/privacy/data-map.md`.

### 3.9 Sécurité

- En-têtes existants (`src/lib/security-headers.ts`) conservés. Toute intégration tierce (vidéo hébergée,
  carte, chat) imposerait de revoir la CSP : à éviter.
- Formulaire de contact : voir § 4.11 (pas de formulaire au lancement, ou formulaire avec Turnstile et limite
  `rateRules`).

## 4. Plan section par section

Ordre de la page : 4.1 → 4.13. En-tête fixe : logo, liens d'ancre (Fonctions, Secteurs, Tarifs, FAQ),
sélecteur de langue (FR / EN / ع), « Se connecter » (lien), « Créer mon compte » (bouton). Sur téléphone :
logo, « Se connecter », bouton « Créer mon compte » compact et menu.

### 4.1 Présentation (haut de page)

- **Message** : « Vendez, suivez votre stock et votre caisse, au même endroit. » Sous-titre : pour les
  quincailleries, boutiques de téléphones, boutiques générales et de vêtements ; chaque commerce a son espace
  séparé ; en français, anglais et arabe.
- **Contenu** : titre, sous-titre (≤ 25 mots), deux boutons, une ligne de réassurance factuelle (« Fonctionne
  dans le navigateur du téléphone et de l'ordinateur. Installable sur l'écran d'accueil. »).
- **Visuel** : capture réelle de la **caisse** (`/business/pos`) sur téléphone, et du **tableau de bord**
  (`/business/dashboard`) sur ordinateur en arrière-plan, avec données de démonstration marquées comme telles.
- **CTA** : « Créer mon compte » → `/register` ; « Se connecter » → `/login`.

### 4.2 Problèmes résolus

- **Message** : « Fini le cahier qui ne tombe jamais juste. »
- **Contenu** : trois à quatre situations concrètes, chacune reliée à une fonction réelle :
  - « Je ne sais pas ce qui reste en stock » → stock mis à jour à chaque vente et achat, historique des
    mouvements, inventaire physique ;
  - « Qui me doit combien ? » → crédits clients et paiements partiels, dettes de départ ;
  - « La caisse ne tombe pas juste » → ouverture et clôture de caisse, écart affiché ;
  - « Mes employés ont-ils accès à tout ? » → rôles (propriétaire, gérant, caissier).
- **Visuel** : photo d'un comptoir avec cahier de compte (scène à photographier ou sous licence), puis
  vignette de l'écran correspondant.
- **CTA** : aucun (lecture), ou lien d'ancre « Voir les fonctions ».

### 4.3 Fonctionnalités principales

> Règle : ne citer **que** ce qui suit, vérifié dans le code et `docs/` au 2026-11-09. Toute nouvelle carte
> exige une référence à la doc correspondante.

| Fonction (libellé proposé) | Réalité dans le code | Référence |
| --- | --- | --- |
| Caisse rapide, sans code-barres obligatoire | Vente par recherche texte, quantités décimales, paiements multiples | `pos-workspace.tsx`, `/business/pos` |
| Espèces et Mobile Money **enregistrés** | Moyens `cash`, `wave`, `orange_money`, `mtn_momo`, `other` saisis par l'utilisateur ; **aucune confirmation automatique** | `docs/architecture.md`, schéma `payment` |
| Stock à jour et historique | Mouvements de stock à chaque vente/achat, historique paginé | `docs/stock-initial.md`, `/business/stock` |
| Inventaire physique | Comptage, écarts, validation | `/business/inventory` |
| Clients et crédits | Soldes, paiements partiels, dettes de départ | `/business/customers`, `docs/stock-initial.md` |
| Fournisseurs, achats, dépenses | Achats, paiements fournisseurs, dépenses par catégorie | `/business/suppliers`, `/purchases`, `/expenses` |
| Caisse du jour | Ouverture, mouvements, clôture figée | `docs/reports.md`, `/business/cash` |
| Rapports et exports | Jour/semaine/mois/année/période ; export Excel, PDF (fr/en), CSV | `docs/reports.md`, `docs/exports.md` |
| Reçus au nom du commerce | Ticket à l'écran avec nom et logo du commerce ; impression navigateur | `docs/printing.md` |
| Import de votre catalogue | Fichiers CSV et Excel (XLSX), revue avant enregistrement | `docs/imports.md`, `/business/imports` |
| Équipe et rôles | Invitations, rôles, désactivation d'un membre | `docs/authentication.md`, `/business/team` |
| Notifications | Notifications dans l'application et push sur le téléphone | `docs/notifications.md` |
| Application installable | Ajout à l'écran d'accueil (PWA) | `docs/pwa.md`, `/business/install` |
| Trois langues | Français, anglais, arabe (de droite à gauche) | `docs/design-system.md` |
| Vos données vous appartiennent | Export complet des données du commerce par le propriétaire (ZIP JSON + CSV) | `docs/privacy/data-export.md` |
| Espace séparé par commerce | Isolation côté serveur, testée entre deux commerces | `docs/validation.md` |

Formulations à **éviter** dans cette section : « impression automatique », « compatible avec toutes les
imprimantes thermiques » (aucune imprimante réelle testée, B-2), « import de photos ou PDF » (désactivé, D-03),
« paiement Mobile Money intégré », « fonctionne sans internet ».

- **Message** : « Tout ce qu'il faut pour tenir la boutique. »
- **Contenu** : 6 cartes maximum en premier plan (caisse, stock, crédits, caisse du jour, rapports, équipe),
  les autres dans une liste « Et aussi ».
- **Visuel** : une capture réelle par carte (§ 6), recadrée sur la zone utile, avec légende.
- **CTA** : « Créer mon compte ».

### 4.4 Secteurs

- **Message** : « Pensé pour votre métier. »
- **Contenu** : quatre onglets (reprise de l'idée de `sector-picker.tsx`, traduite) : quincaillerie (unités
  pièce, sac, mètre), téléphonie (suivi par numéro de série facultatif : champ `track_serial`), boutique
  générale (catégories), vêtements (variantes taille et couleur : `product_variant.size` / `color`). Ne
  mentionner que des attributs présents dans le schéma.
- **Visuel** : photo de chaque type de commerce (scènes à obtenir, § 6.2) + capture d'une fiche produit du
  secteur.
- **CTA** : « Créer mon compte » → `/register`, sans paramètre de secteur tant que `/register` ne le lit pas
  (seuls `?promo=` et `?plan=` sont lus aujourd'hui).

### 4.5 Démonstration

- **Message** : « Voyez le vrai logiciel. »
- **Contenu** : parcours en trois étapes illustrées : 1. créer son commerce (assistant en cinq étapes,
  `docs/onboarding.md`) ; 2. ajouter ou importer ses articles ; 3. vendre et lire le rapport du jour.
- **Visuel** : courte vidéo muette (≤ 30 s, sous-titrée fr/en/ar, chargée au clic, hébergée sur le même
  domaine ou R2) **ou** suite de captures. Pas de démonstration interactive publique au lancement (le mode
  aperçu PGlite est réservé au développement).
- **CTA** : « Essayer avec mon commerce » → `/register`.

### 4.6 Tarification

- **Message** : « Un prix clair, en francs CFA. »
- **Contenu** : **prix à fournir par le propriétaire.** Les plans existent en base (`subscription_plan`,
  console Super Admin) ; la landing affichera les prix arrêtés par le propriétaire, ce qui est inclus
  (quotas utilisateurs/produits de `plan-limits.ts`, si retenus), la durée d'essai éventuelle et les
  conséquences de l'expiration (opérations bloquées, données conservées, export toujours possible).
  Moyens de paiement de l'abonnement : **ne rien annoncer** tant que GeniusPay n'est pas validé en production.
- **Visuel** : cartes de plans, aucune image.
- **CTA** : « Choisir ce plan » → `/register?plan=<code>` (paramètre déjà lu par l'assistant). Mention « Vous
  avez un code ? » → `/register?promo=` seulement pour des campagnes publiques réellement créées.

### 4.7 Inscription

- **Message** : « Créez votre commerce en quelques minutes. »
- **Contenu** : rappel des cinq étapes de l'assistant ; ce qui est demandé (nom, e-mail, mot de passe, nom et
  type du commerce ; téléphone, adresse et logo facultatifs).
- **Visuel** : capture de l'assistant (`/register`), version statique (pas de scène 3D sur la landing).
- **CTA** : « Créer mon compte » → `/register`.

### 4.8 Connexion

- **Message** : « Déjà client ? »
- **Contenu** : lien direct, rappel « mot de passe oublié ». Connexion Google/Apple **non mentionnée** tant
  que les identifiants ne sont pas configurés (le bouton n'apparaît pas sans eux).
- **Visuel** : aucun.
- **CTA** : « Se connecter » → `/login` ; « Mot de passe oublié » → `/forgot-password`.

### 4.9 FAQ

- **Message** : « Vos questions. »
- **Contenu** (réponses factuelles, à valider) :
  - Faut-il un ordinateur ? (Non : navigateur du téléphone, application installable.)
  - Faut-il un lecteur de codes-barres ? (Non.)
  - Ça marche sans internet ? (**Non** : une connexion est nécessaire ; une page hors ligne s'affiche en cas
    de coupure. Ne rien promettre de plus.)
  - Mes employés voient-ils tout ? (Rôles et permissions.)
  - Puis-je récupérer mes données ? (Oui, export complet par le propriétaire.)
  - Où sont mes données ? (Réponse alignée sur `docs/privacy/data-map.md` : hébergement hors de Côte
    d'Ivoire ; aucune promesse de « données en Afrique ».)
  - Quelles langues ? (Français, anglais, arabe.)
  - Le paiement Mobile Money est-il automatique ? (Non : les paiements sont enregistrés par le commerçant.)
  - Puis-je imprimer des reçus ? (Oui depuis le navigateur ; imprimantes thermiques : en cours de validation.)
- **Visuel** : aucun (accordéon `<details>` natif, sans JavaScript).
- **CTA** : « Une autre question ? » → contact.

### 4.10 Confiance (bloc court, sans chiffres)

- **Contenu** : espace séparé par commerce, mots de passe chiffrés, export de vos données, politique de
  confidentialité. **Aucun** logo de client, compteur d'utilisateurs, note ou témoignage.
- **Visuel** : icônes avec libellé.

### 4.11 Contact

- **Message** : « Parlons de votre commerce. »
- **Contenu** : coordonnées de Qadr Agency **à fournir** (e-mail, numéro WhatsApp professionnel, ville).
  Au lancement : liens `mailto:` / `https://wa.me/` (aucune donnée collectée par Qadr Ops). Un formulaire
  ne viendra qu'avec Turnstile, limite de débit (`rateRules`), traitement documenté et e-mails Resend
  opérationnels (non vérifiés à ce jour).
- **Visuel** : aucun ou photo de l'équipe Qadr Agency (réelle, avec accord).
- **CTA** : « Écrire sur WhatsApp » / « Envoyer un e-mail ».

### 4.12 Confidentialité

- **Contenu** : lien vers `/privacy` (existante). Tant que le texte est un projet, conserver son bandeau.
  Traductions en/ar à prévoir ou mention « disponible en français ».
- **CTA** : « Politique de confidentialité » → `/privacy`.

### 4.13 Conditions générales

- **Contenu** : page `/terms` (ou `/conditions`) **à rédiger par un juriste** : conditions d'utilisation et
  conditions de vente des abonnements (prix, durée, renouvellement, résiliation, sort des données à
  l'expiration, rôle de sous-traitant de Qadr Agency). Ne pas publier de texte générique copié.
- **CTA** : lien dans le pied de page ; case à cocher d'acceptation sur `/register` à prévoir (hors périmètre
  de la landing, décision du propriétaire).

### Pied de page

Logo, Qadr Agency, liens (Fonctions, Tarifs, FAQ, Contact, Confidentialité, Conditions), sélecteur de langue,
mentions légales (raison sociale, RCCM, adresse : à fournir), « © Qadr Agency ».

## 5. Captures du logiciel : règles de production

- Produites depuis l'application réelle, en mode aperçu (`npm run preview`, PGlite, développement) ou sur la
  branche `staging`, **jamais** depuis des données de vrais commerçants.
- Commerce de démonstration au nom manifestement fictif (ex. « Quincaillerie Démo »), produits et clients
  inventés, montants plausibles. Légende discrète « Données de démonstration » sur chaque capture.
- Trois langues : chaque capture principale existe en fr, en et ar (RTL).
- Formats : téléphone 390×844 (DPR 3), ordinateur 1440×900 (DPR 2) ; export AVIF + WebP ; texte alternatif
  rédigé dans les trois langues.
- Le bandeau « aperçu » de l'application et toute mention technique sont masqués par configuration, pas par
  retouche d'image.
- Captures existantes dans `docs/captures/mission-*` : utiles comme repères, **non réutilisables** telles
  quelles (contexte de test, formats variés).

## 6. Liste des visuels à produire

### 6.1 Captures réelles du logiciel (fr / en / ar)

| # | Écran | Route | Format | Section |
| --- | --- | --- | --- | --- |
| C1 | Caisse avec panier en cours | `/business/pos` | téléphone | 4.1, 4.3 |
| C2 | Tableau de bord du jour | `/business/dashboard` | ordinateur | 4.1, 4.3 |
| C3 | Stock et historique d'un article | `/business/stock` | téléphone | 4.3 |
| C4 | Inventaire physique avec écart | `/business/inventory` | téléphone | 4.3 |
| C5 | Fiche client avec crédit et paiement partiel | `/business/customers` | téléphone | 4.2, 4.3 |
| C6 | Clôture de caisse | `/business/cash` | téléphone | 4.2, 4.3 |
| C7 | Rapport du mois + menu d'export | `/business/reports` | ordinateur | 4.3 |
| C8 | Reçu à l'écran au nom du commerce | `/business/sales/[id]/receipt` | téléphone | 4.3 |
| C9 | Revue d'un import CSV/XLSX | `/business/imports/[id]` | ordinateur | 4.3 |
| C10 | Équipe et rôles | `/business/team` | téléphone | 4.2, 4.3 |
| C11 | Assistant d'inscription (version statique) | `/register` | téléphone | 4.7 |
| C12 | Fiche produit par secteur (×4) | `/business/products` | téléphone | 4.4 |
| C13 | Écran d'installation | `/business/install` | téléphone | 4.3 |

### 6.2 Scènes de commerces (à photographier ou à obtenir sous licence)

| # | Scène | Usage |
| --- | --- | --- |
| P1 | Comptoir de quincaillerie à Abidjan, commerçant(e) avec téléphone | 4.1 / 4.4 |
| P2 | Boutique de téléphones et accessoires | 4.4 |
| P3 | Boutique générale (alimentation, produits du quotidien) | 4.4 |
| P4 | Boutique de vêtements, portants | 4.4 |
| P5 | Cahier de comptes manuscrit sur un comptoir (sans données lisibles de vraies personnes) | 4.2 |
| P6 | Mains tenant un téléphone avec l'application (capture incrustée proprement) | 4.5 |

Exigences : autorisation écrite des personnes photographiées (droit à l'image) et du commerce ; licence
commerciale vérifiée pour toute banque d'images (conserver la preuve) ; aucune enseigne ou marque tierce
lisible sans accord ; représentation fidèle des commerces ciblés (pas de décor étranger générique).

### 6.3 Produits et illustrations

- Photos détourées d'articles typiques (sac de ciment, câble, téléphone, chemise) pour les cartes secteurs :
  produits génériques, sans marque visible.
- Icônes : jeu SVG existant (`icon.tsx`), complété si besoin dans le même style.
- Image Open Graph 1200×630 par langue (logo, phrase clé, capture C1).
- Logo Qadr Ops en SVG (version claire et sombre) : à fournir ou à valider (l'actuel est un mot-symbole CSS).

## 7. Interdits explicites

1. **Aucun faux témoignage**, aucun avis inventé, aucune note étoilée, aucune photo de « client satisfait »
   mise en scène comme réelle.
2. **Aucun chiffre client** : ni nombre de commerces, ni volume de ventes traité, ni « +X % de chiffre
   d'affaires », ni temps gagné, tant qu'il n'existe pas de mesure réelle, sourcée et autorisée.
3. **Aucune promesse hors ligne** : l'application exige une connexion (`docs/pwa.md`).
4. **Aucune IA non livrée** : pas de « reconnaissance de vos cahiers », « OCR », « import de photos ou de PDF »
   (désactivé, décision D-03), « assistant intelligent ». Qadr Capture se limite aujourd'hui aux fichiers CSV
   et XLSX.
5. **Ne pas annoncer Mobile Money, Wave, Orange Money, MTN ou GeniusPay comme « intégrés » ou « automatiques »**
   tant que l'intégration n'est pas validée de bout en bout en production. On peut dire que l'on
   **enregistre** un paiement Wave/Orange Money/MTN reçu.
6. Pas d'« impression automatique » ni de liste d'imprimantes compatibles (aucune imprimante réelle testée).
7. Pas de « données hébergées en Côte d'Ivoire / en Afrique », ni « conforme ARTCI/RGPD » sans audit juridique.
8. Pas de logos de partenaires (Vercel, Neon, Cloudflare…) en caution de sécurité.
9. Pas de compte à rebours, de fausse rareté ni de prix barré fictif.
10. Pas de capture contenant des données réelles de commerçants ou de leurs clients.

## 8. Prérequis techniques avant construction

1. Décisions du § 9 prises par écrit (au minimum : direction artistique, remplacement de `/`, prix).
2. Lecture de la documentation Next.js 16.4 locale (`apps/web/node_modules/next/dist/docs/`) sur les groupes
   de routes à plusieurs mises en page racines, `generateStaticParams`, `metadata`, `robots`, `sitemap`.
3. Prototype de la séparation `(marketing)` / `(app)` validé : l'application (cookie de langue, PWA,
   analytics, Turnstile) doit rester identique ; `npm run typecheck`, `npm run lint`, `npm test`,
   `npm run build` verts ; vérification que `/` est bien générée en statique dans la sortie du build.
4. Domaine de production et domaine canonique créés (aujourd'hui non créés, `docs/production-setup-guide.md`).
5. Textes rédigés en français, traduits en anglais et en arabe, arabe relu par un locuteur natif.
6. Visuels du § 6 produits, licences et autorisations archivées.
7. Page de conditions générales rédigée par un juriste ; statut de `/privacy` tranché (indexation,
   traductions).
8. Événements d'audience de la landing ajoutés au catalogue `events.ts` (avec tests existants).
9. Coordonnées de contact et mentions légales fournies.
10. Critères de recette : Lighthouse mobile (budget § 3.6) sur la version déployée en préproduction, test sur
    un vrai téléphone Android d'entrée de gamme, contrôle RTL complet en arabe, navigation clavier,
    lecteur d'écran (TalkBack ou NVDA) sur le parcours « Créer mon compte ».

## 9. Décisions attendues du propriétaire

| # | Décision | Options |
| --- | --- | --- |
| D1 | Direction artistique de la landing | (a) celle de l'application (Plus Jakarta Sans, violet/nuit) ; (b) Calistoga + Inter réservées à la landing |
| D2 | Sort de la page d'accueil actuelle `/` | Remplacer ; conserver jusqu'à la mise en ligne de la nouvelle |
| D3 | Langue dans l'URL (`/`, `/en`, `/ar`) pour les pages publiques | Oui (recommandé) ; non (cookie, rendu dynamique) |
| D4 | Prix, plans affichés, durée d'essai, quotas annoncés | À fournir |
| D5 | Moyens de paiement de l'abonnement annoncés | Rien tant que GeniusPay n'est pas validé ; liste après validation |
| D6 | Contact | E-mail, WhatsApp, adresse ; formulaire ou non |
| D7 | Conditions générales | Juriste mandaté, calendrier |
| D8 | `/privacy` | Indexable ou non ; traductions en/ar |
| D9 | Visuels | Photographe local ou banque d'images (budget) ; personnes et commerces partenaires pour les prises de vue |
| D10 | Vidéo de démonstration | Oui/non, hébergement (même domaine ou R2) |
| D11 | Mots-clés et domaine canonique | Liste validée, nom de domaine |
| D12 | Mentions légales | Raison sociale, RCCM, adresse de Qadr Agency |

# Page publique `/` : état livré

Ce document complète le cahier des charges `landing-page-plan.md` et la direction artistique
`docs/design/direction-artistique.md`. Il dit ce qui est construit, sur quels faits et avec quelles hypothèses.
**La page n'est pas déployée.** Elle est vérifiée en local uniquement.

Historique : une première version (mission 16, lot F) reprenait la direction de l'application (violet, Plus
Jakarta Sans). Elle est remplacée le 2026-11-10 par la version « cahier de la boutique », en bleu roi.

## 1. Fichiers

| Fichier | Rôle |
| --- | --- |
| `apps/web/src/app/page.tsx` | Route `/` : métadonnées traduites, Open Graph, données structurées `SoftwareApplication` (sans note, avis ni prix) |
| `components/landing/landing-page.tsx` | Composant serveur : hero, bénéfices, métiers, fonctions, intégrations, FAQ, pied de page |
| `components/landing/day-section.tsx` | « Une journée à la boutique » : six moments horodatés, fragments d'écran en HTML |
| `components/landing/pricing-section.tsx` | Tarifs lus en base (composant serveur asynchrone) |
| `components/landing/landing-header.tsx` | En-tête fixe, menu sur téléphone et tablette (client) |
| `components/landing/landing-motion.tsx` | GSAP + ScrollTrigger : journée ; à partir de 1024 px, parallaxe des photos et pages superposées des écrans (client) |
| `components/landing/interface-screens.tsx`, `lib/landing/interface-screens.ts` | « Les vrais écrans » en pages superposées, manifeste des captures |
| `lib/landing/ambiance.ts`, `public/landing/ambiance/` | Images d'ambiance (photos de métiers, fond « salle quadrillée »), § 5 bis |
| `components/landing/receipt*.ts(x)` | Ticket d'exemple : HTML (rendu serveur, repli) et 3D Three.js facultative |
| `components/brand/brand-logo.tsx`, `lib/brand.ts`, `public/brand/` | Marque et mascotte **provisoires**, source unique (voir `docs/design/direction-artistique.md` § 5) |
| `components/video/video-embed.tsx`, `lib/video/source.ts` | Lecteur vidéo réutilisable (YouTube, Vimeo, fichier MP4/WebM) |
| `lib/landing/demo-video.ts`, `lib/landing/contact.ts` | Lecture de `QADR_DEMO_VIDEO_URL` et de `QADR_CONTACT_URL` |
| `components/landing/landing.css`, `fonts.ts` | Styles propres à la page (motifs, entrée du hero), police Rubik |
| `lib/domain/public-plans.ts` | Lecture des formules publiées (`subscription_plan`), cache 10 min |
| `lib/i18n/messages/landing.ts` | Textes fr/en/ar, typés par `Shape` (parité vérifiée par `messages.test.ts`) |
| `public/patterns/qadr-curves.svg`, `qadr-links.svg`, `qadr-room-grid.svg` | Points ondulés (export Durves fourni), maillons entrelacés, salle quadrillée vectorielle (§ 5 bis) |
| `src/lib/landing/landing-content.test.ts` | Garde-fou : aucune mention de démonstration, aucun chiffre ni nom inventé, aucune capture servie |
| `app/robots.ts` | Tout interdit hors `VERCEL_ENV=production` |

## 2. Inventaire : chaque promesse et sa preuve dans le code

| Affirmation de la page | Vérifié dans |
| --- | --- |
| Caisse avec recherche, sans code-barres obligatoire | caisse : recherche par nom, référence ou SKU |
| Espèces, Wave, Orange Money, MTN MoMo **enregistrés par le commerçant** (pas reçus en ligne) | moyens de paiement de la vente ; aucune intégration Mobile Money des ventes |
| Plusieurs paiements dans une même vente, reste à crédit | paiements partiels, solde client |
| Stock de départ distinct d'un achat, mouvements avec auteur, inventaire avec écarts | `writeStockOpening`, mouvements de stock, inventaire |
| Caisse du jour : ouverture, mouvements, clôture, écart ; caisse clôturée figée | `cash-session.ts`, déclencheur de gel |
| Rapports jour → année, exports Excel/CSV/PDF (PDF en fr/en seulement) | `reports.ts`, `lib/exports/` |
| Rôles (un caissier ne voit pas les réglages) | `lib/auth/permissions.ts` |
| Téléphonie : « chaque modèle et ses déclinaisons ont leur propre stock et leur référence » | variantes de produit (`on_hand` et SKU par variante). **Pas de suivi des numéros de série** : `trackSerial` n'est qu'un indicateur, la page ne le promet plus |
| Vêtements : taille et couleur rattachées au même article | variantes |
| Quantités décimales (1,5 m) | quantités `numeric` |
| Ticket dans une autre langue que l'écran, imprimé depuis le navigateur | `receipt-document.ts`, impression navigateur |
| Import de catalogue CSV/Excel vérifié avant l'enregistrement | `/business/imports` (rien n'est écrit avant confirmation) |
| Export complet des données du commerce par le propriétaire | `GET /api/business/data-export` |
| Un espace séparé par commerce | isolation par `business_id`, `tenant-isolation.http.test.ts` |
| Installable sur l'écran d'accueil | manifeste et service worker (`docs/pwa.md`) |

Section « Ce qui est branché, et ce qui ne l'est pas encore » :
- **Disponible** : paiements enregistrés, Excel/CSV, rapports PDF fr/en, ticket depuis le navigateur,
  installation sur l'écran d'accueil.
- **En cours de validation** : paiement de l'abonnement par GeniusPay (sandbox seulement), impression
  thermique directe (aucune imprimante réelle testée), notifications sur l'écran du téléphone (aucun appareil
  réel n'en a reçu).
- **Pas encore disponible** : fonctionnement hors ligne, lecture des photos de cahiers et des PDF,
  confirmation automatique des paiements Mobile Money.

**Absents volontairement :** témoignages (la section existe mais ne s'affiche pas tant que la liste est
vide), nombre de clients, logos de partenaires, notes, contact, conditions générales, mentions légales.

## 3. Tarifs et code promotionnel

- Les prix ne sont jamais écrits dans le code de la page. `getPublicPlans()` lit les formules **actives** en
  XOF de `subscription_plan`, triées par prix puis par code, avec les limites d'articles et de membres.
- Cache `unstable_cache` de 10 minutes, étiquette `public-plans` : une formule modifiée dans la console
  apparaît au plus tard 10 minutes après (ou tout de suite après `revalidateTag("public-plans")`, non branché).
- Aucune formule publiée : la section le dit et renvoie vers l'inscription. Base injoignable : état
  « indisponible », jamais un prix inventé ni une page en erreur.
- En aperçu local, les formules viennent de la base de démonstration PGlite et un badge « Formules fictives
  de l'aperçu local » est affiché.
- Le code Qadr Agency se saisit pendant la création du commerce (`/api/public/campaigns/check`). La page ne
  le simule pas : elle explique où le saisir et renvoie vers `/register`.
- Au 2026-11-10, **aucun prix réel** n'est publié en staging ni en production.

### 3.1 Tarif officiel et offre Business (reprise du 2026-11-10)

- **Offre Standard : 5 000 FCFA pour 30 jours** (décision D-04 du propriétaire, durée confirmée le
  2026-11-10). Elle n'est écrite nulle part dans le code : elle existe quand une ligne
  `subscription_plan` active la porte. La page affiche alors ce montant et sa durée
  (`duration_days`), et GeniusPay facture ce même montant pour cette même durée : prix affiché et prix
  facturé ont une seule source (`public-plans.integration.test.ts`, bloc « offre Standard »). La page
  écrit « pour 30 jours », pas « par mois » : la période facturée est de 30 jours exactement. Les
  formules « Essentiel » et « Équipe » de l'aperçu local restent fictives (badge affiché).
- **Créer la formule** (propriétaire de la plateforme, `/platform/plans`, une fois la base cible migrée
  et le compte propriétaire créé) :

  | Champ | Valeur |
  | --- | --- |
  | Code | `STANDARD` |
  | Nom | `Standard` |
  | Prix (XOF) | `5000` |
  | Durée (jours) | `30` |
  | Active | oui |
  | Fonctions (caisse, rapports, stock, achats) | **toutes activées** (confirmé par le propriétaire le 2026-11-10) |
  | Articles max, utilisateurs max | **laisser vides** : sans limite (confirmé par le propriétaire le 2026-11-10). La page affichera « Articles sans limite » et « Membres d'équipe sans limite » |

  La formule apparaît sur la page publique au plus tard 10 minutes après (cache). Elle n'est créée dans
  aucune base à ce jour : la production n'est pas migrée, et l'écrire en préproduction demande votre
  accord (écriture dans une base distante).
- **Qadr Ops Business** (« Solution personnalisée », « Sur devis ») : carte ajoutée à la suite des
  formules. Ce n'est pas une formule facturée : elle ne vient pas de la base et n'a pas de prix. Son
  bouton « Discuter de mon projet » ouvre `QADR_CONTACT_URL` (`mailto:`, `tel:`, `https://wa.me/…` ou
  page `https://` ; toute autre forme est refusée, voir `contact.test.ts`). Aucun numéro ni adresse
  n'est écrit dans le code. **Sans cette variable, l'offre n'est pas affichée en production** ; hors
  production la carte reste visible avec la mention du réglage manquant.
- Avec trois cartes ou plus, l'encart du code Qadr Agency passe sous les cartes pour leur laisser la
  largeur ; avec une ou deux cartes il reste à côté.
- Le système promotionnel n'a pas été touché (aucun fichier de `lib/domain` modifié).

### 3.2 Vidéo de démonstration (reprise du 2026-11-10)

- Section `#demo`, après les bénéfices. L'adresse vient de `QADR_DEMO_VIDEO_URL` : lien YouTube, lien
  Vimeo, ou fichier `.mp4` / `.webm` (HTTPS ou chemin du site).
- **Sans adresse valide, la section n'existe pas en production** : aucune vidéo fictive. Hors production,
  un emplacement vide marqué comme tel garde la mise en page vérifiable.
- `VideoEmbed` ne charge rien avant le clic : ni lecteur tiers, ni fichier, ni cookie. La page ne paie
  qu'une image de couverture en chargement différé, donc le hero et le LCP ne changent pas. La lecture ne
  démarre jamais seule ; elle suit un clic ou la touche Entrée, puis le lecteur reçoit le focus.
- Lecteurs tiers en mode respectueux : `youtube-nocookie.com`, Vimeo avec `dnt=1`, iframe en bac à
  sable ; une ligne nomme l'hébergeur avant la lecture. Fichier illisible : message, bouton
  « Réessayer » et lien direct.
- Formats `16/9`, `9/16`, `1/1`, `4/3` ; le composant sert aussi aux tutoriels et à l'aide.
- Vérifié en navigateur sans interface avec un fichier WebM d'essai (retiré ensuite) : aucun lecteur ni
  requête avant l'action, lecture après Entrée, repli sur fichier absent. **Non vérifié** : un vrai lien
  YouTube ou Vimeo (aucune vidéo officielle n'est publiée), et la lecture MP4 (le navigateur d'essai n'a
  pas le codec H.264).
- Le film « Reprenez le contrôle » existe dans `production-video/out/video/` (70 à 217 Mo par fichier) :
  trop lourd pour le dépôt et pour `public/`. Il doit être publié chez un hébergeur vidéo ou dans un
  stockage objet, puis son adresse mise dans la variable.

## 4. Aucune donnée d'exemple (mission CTO du 2026-11-14)

Jusqu'au 2026-11-14, le ticket, la journée et deux captures de l'aperçu montraient des montants, un commerce et
un client inventés, signalés par un badge « Données de démonstration » ; les captures portaient en plus le
bandeau « Prévisualisation · données fictives ». La page de production ne doit rien montrer de tel. Désormais :

- **téléphone du hero** : caisse schématique en HTML (`PhoneSketch`) : vrais libellés (« Caisse »,
  « Rechercher un article… », « Panier », « Encaisser »), articles figurés par des traits ;
- **ticket** : modèle de ticket (« Votre commerce », « Article », « Qté × prix », « Total », « Payé »,
  « Reste à crédit »), montants remplacés par « · · · » en HTML comme en 3D ;
- **journée** : chaque moment garde son heure, sa question et son explication ; le fragment d'écran montre les
  champs réels (fournisseur, article, quantité reçue, coût d'achat, total calculé par le serveur, écart…) et
  des traits à la place des valeurs ; plus de badge « Exemple » ;
- **fonctions** : la capture du tableau de bord est retirée (la liste des fonctions suffit) ;
- **vidéo** : titre « Présentation de Qadr Ops », sans image de couverture ;
- les six captures sont archivées dans `docs/product/captures-apercu/` (hors `public/`, donc plus servies).

`landing-content.test.ts` échoue si un texte public (fr/en/ar) reparle de démonstration, d'exemple ou de
données fictives, s'il réintroduit un des anciens montants ou noms, si un composant de la page pointe vers
`/landing/…` ou écrit un montant en dur, ou si une image revient dans `public/landing/`. Les seules images
servies sont les captures de `public/landing/apercu/` et les images d'ambiance de `public/landing/ambiance/`
(§ 5 bis), chacune déclarée dans son manifeste. Seuls les textes
affichés hors production (badge des formules de l'aperçu, emplacement vidéo vide) sont exemptés.

## 5. Captures de remplacement

De vraies captures pourront revenir quand un commerce pilote aura donné son accord écrit et que ses données
auront été vérifiées : jamais une capture de l'aperçu.

## 5 bis. Fond « salle quadrillée », images d'ambiance et pages superposées (2026-11-17)

Quatre images fournies par le propriétaire, **générées par IA** : une salle blanche quadrillée en perspective
(fond) et trois boutiques (téléphonie, vêtements, quincaillerie). Fichiers servis : `public/landing/ambiance/`
uniquement, déclarés dans `src/lib/landing/ambiance.ts` ; recadrage et conversion WebP par un script ponctuel
(sharp), sources hors dépôt.

**Fond.** Toutes les sections claires (avantages, vidéo, commerces, journée, fonctions, écrans, intégrations,
tarifs, questions) n'ont plus de fond propre : elles défilent devant un seul décor `.landing-room-backdrop`,
collé à l'écran (`position: sticky`, hauteur `100lvh`, pas `background-attachment: fixed` que Safari iOS ignore).
Le hero et le pied de page restent bleu nuit. Deux rendus :

| Écran | Rendu | Raison |
| --- | --- | --- |
| portrait de moins de 1024 px | l'image `salle-quadrillee.webp` (736 × 1104, 5 Ko), en `cover` | sur téléphone elle est réduite (≈ 0,7×), sur tablette portrait proche de 1× : nette |
| paysage, ou ≥ 1024 px | reproduction vectorielle `public/patterns/qadr-room-grid.svg` (2 Ko), lignes blanches en masque sur un dégradé de jetons | à 1280 px l'image serait agrandie 1,7× (lignes floues) et recadrée sur sa bande centrale vide |

Le SVG reprend les mesures relevées sur l'image : colonnes espacées de 128 px au bord (116 dans le SVG),
horizontales tous les 83 px (51, 134, 217, 299, 380 depuis le haut, en miroir au sol), fuite du plafond à 81 % de
la hauteur et du sol à 19 %, grille effacée vers 38 % / 62 %, halo flou sous un trait fin. Couleurs : jetons
seulement (`white`, `canvas`, `surface-muted`, `line`). Contraste : le texte posé directement sur la salle est en
`ink`, `fg` ou `fg-muted` (≥ 5,3:1 sur le gris le plus sombre) ; la mention de devise des tarifs est passée de
`fg-subtle` (4,2:1) à `fg-muted`.

**Photos.** Section « Fait pour votre commerce » : chaque carte de métier porte sa photo (bande 16:10 sur
téléphone et tablette pour ne pas allonger la page, portrait 4:5 à partir de 1024 px, cartes paires décalées).
La boutique générale, sans photo, reçoit un panneau bleu nuit au motif de maillons. Les photos ne sont jamais
présentées comme des clients : texte alternatif « Illustration : … » (« صورة تعبيرية: … » en arabe, car
« توضيحي » est refusé par le test des mots de démonstration) et mention visible sous la grille
(« Images d'illustration : aucune ne montre le commerce d'un client. »). Chargement différé, dimensions
réservées, `srcset` en deux largeurs.

| Fichier | Source | Recadrage (px source) | Marques |
| --- | --- | --- | --- |
| `telephonie-300/600.webp` | 1.jpg | x 0-600, y 300-1050 | panneau « iPhone 15 / Galaxy S24 / Pixel 8 » (x ≥ 622) hors cadre ; téléphones génériques en vitrine |
| `vetements-368/736.webp` | 2.jpg | y 675-1245, pleine largeur | enseignes lumineuses GUCCI / LOUIS VUITTON / CHANEL (jusqu'à y ≈ 655) hors cadre ; le filigrane « Meta AI » (y ≈ 1270-1290) sort aussi du cadre, conséquence du recadrage, sans retouche |
| `quincaillerie-368/736.webp` | 3.jpg | y 300-1220, pleine largeur | grands cartons de marques d'outillage du haut retirés ; restent de petites étiquettes de marques en rayon (décor, aucun gros plan) |

**Pages superposées.** Section « Les vrais écrans » : les six écrans de bureau suivent le parcours (vue
d'ensemble → produits → stock → caisse → clients → rapports). À partir de 1024 px, chaque page colle un peu plus
bas que la précédente et la recouvre (CSS `sticky`, sans JavaScript) ; sa largeur est bornée par la hauteur de
l'écran pour que la légende reste visible. La colonne de gauche indique la page lue. Téléphone et ticket
ferment la section. En dessous de 1024 px : simple liste.

**Mouvement** (`landing-motion.tsx`, seulement si `prefers-reduced-motion: no-preference` et ≥ 1024 px) : léger
parallaxe des photos dans leur cadre, cartes des métiers qui se posent une fois, page recouverte qui recule
(échelle 0,93) et s'assombrit, page suivante qui se pose (bascule de 9° annulée). Rien sur téléphone. La section
des écrans est exclue de `content-visibility` (comme la journée), car ses positions sont lues par GSAP.

## 6. Performance

Rendu différé des sections hors écran (`content-visibility: auto` dans `landing.css`, sauf le hero, la
journée et les écrans). Sans lui, Chrome mettait en page tout le texte de la page avant le premier affichage : une seule
mise en page de 2,3 s, dont 1,5 s de mise en forme du texte, avant le FCP (processeur ×4). Conséquences :
- le défilement doux est coupé sur cette page (`scroll-behavior: auto`) : Chrome interrompait le défilement
  vers `#faq` dès qu'une section différée prenait sa vraie hauteur ;
- `landing-motion.tsx` recalcule les déclencheurs GSAP quand la hauteur de `#contenu` change ;
- une capture « pleine page » montre les sections hors écran vides : c'est un artefact de capture. Pour
  contrôler le rendu, agrandir la fenêtre à la hauteur de la page.

L'image du téléphone du hero est préchargée avec `fetchPriority="high"`.

## 7. Vérifications (2026-11-10)

Build de production local (`npm run build`, puis `next start` sur le port 3005, configuration
`qadr-web-local-production`), Chromium piloté par Playwright. Réseau « 4G lente » simulé : 150 ms de latence,
1,6 Mbit/s. Cache désactivé. Trois passages par cas.

| Cas | LCP | CLS | INP (clic réel sur le menu) |
| --- | --- | --- | --- |
| 390 px, processeur ×4, fr / ar | 2,7 à 3,0 s (avant le rendu différé : 3,2 à 4,6 s) | 0 | 88 à 160 ms |
| 390 px, processeur ×2, fr / ar | 2,0 s | 0 | non mesuré |
| 390 px, processeur ×1, fr / ar | 1,9 s / 1,0 s | 0 | non mesuré |
| 1440 px, processeur ×1, fr / ar | 2,0 s / 1,1 s | 0,0002 / 0 | non mesuré |

- **Objectif LCP ≤ 2,5 s : non atteint avec le processeur ×4** sur ce poste ; atteint à ×1 et ×2. Pour
  comparaison, `/login` affiche son premier contenu en 1,6 à 1,8 s dans les mêmes conditions. Le coût restant
  vient surtout du socle commun : 150 Ko de CSS dont `legacy.css`, Sentry, PostHog et le bloc Turnstile
  chargés par la mise en page racine.
- Aucun défilement horizontal en fr, en et ar à 320, 360, 390, 768, 1024, 1280 et 1440 px.
- Liens d'ancre (`#features`, `#pricing`, `#faq`) : arrivée exacte en fr à 1440 px, en ar à 390 px et en en à
  320 px.
- Journée : le moment actif et l'horloge suivent le défilement après le rendu différé.
- Tarifs : sans `DATABASE_URL`, la page affiche l'état « indisponible », sans erreur 500 ni prix inventé.
  Avec des formules, le test `public-plans.integration.test.ts` vérifie le tri, le filtrage des formules
  inactives et les grands montants.
- Le premier `npm run build` a échoué une fois au téléchargement de Rubik depuis Google Fonts
  (`next/font`) ; les builds suivants ont réussi sans modification. La police est téléchargée au build, pas
  par le visiteur.

## 8. Non vérifié

- Relecture des textes arabes par un locuteur natif.
- Mesure sur un vrai téléphone d'entrée de gamme, ou avec Lighthouse / PageSpeed sur un déploiement réel.
- Lecteur d'écran (NVDA, TalkBack, VoiceOver).
- Image Open Graph dédiée (absente).
- Logo officiel : la mascotte reste provisoire tant que le fichier source n'est pas fourni.
- Prix réels : aucune formule publiée en staging ni en production (Standard, 5 000 FCFA pour 30 jours, toutes fonctions incluses, sans limite d'articles ni d'utilisateurs : décidé ; formule à créer).
- Vidéo de démonstration réelle et canal de contact Business : variables non renseignées.
- Blender n'est pas installé : aucun modèle 3D n'a été produit avec lui.

## 9. Hypothèses en attente de décision

| Sujet | Hypothèse appliquée | Pour changer |
| --- | --- | --- |
| Logo | Mascotte SVG provisoire dessinée d'après l'image fournie (118 × 205 px, inutilisable telle quelle) ; favicon et icônes de l'application générés à partir d'elle depuis le 2026-11-10 | fournir le fichier source (SVG ou PNG ≥ 1024 px), puis suivre `lib/brand.ts` |
| Tarif Standard | 5 000 FCFA pour 30 jours (D-04) ; formule pas encore créée en base ; toutes fonctions incluses, sans limite d'articles ni d'utilisateurs (confirmé) | créer la formule dans `/platform/plans` (fiche au § 3.1) |
| Offre Business | Carte masquée en production sans `QADR_CONTACT_URL` | fournir le canal de contact réel |
| Vidéo | Section masquée en production sans `QADR_DEMO_VIDEO_URL` | publier la vidéo et fournir son adresse |
| Langue | Cookie `qadr-locale`, une seule URL | routes `/en`, `/ar` avec `hreflang` possibles |
| Contact, mentions légales | Mentions légales absentes ; le pied de page renvoie seulement vers `/privacy` ; le seul contact est celui de l'offre Business | à fournir par le propriétaire |
| `sitemap`, URL canonique | Absents (domaine non choisi) | à ajouter avec le domaine |
| Image de partage | Aucune image Open Graph dédiée | à produire |

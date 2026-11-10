# Direction artistique Qadr Ops (palette bleue, 2026-11-10)

Ce document fixe l'identité visuelle de la page publique et du logiciel. Il remplace la direction violette de la
mission 04 pour les couleurs. La structure des composants, elle, ne change pas.

## 1. Idée directrice : « le cahier de la boutique, en mieux »

Le commerçant ivoirien tient aujourd'hui sa boutique avec un cahier, une calculatrice et sa mémoire. La page
ne vend pas un « tableau de bord » : elle montre ce cahier devenu juste, ligne après ligne, au fil d'une
journée de boutique. Trois choix en découlent.

1. **La journée comme fil conducteur.** La section centrale suit une journée réelle, de la réception de la
   marchandise jusqu'à la clôture de la caisse. Chaque moment montre le vrai fragment d'écran qui répond à la
   question du commerçant. C'est la seule séquence numérotée de la page, parce que c'est la seule vraie suite.
2. **Le ticket de caisse comme objet.** Le seul objet en 3D est un ticket thermique, une fonction réelle du
   logiciel. On n'ajoute ni pièces de monnaie, ni graphiques flottants, ni sphères décoratives.
3. **Le bleu royal plein.** Le haut et le bas de la page sont des aplats de bleu profond, texturés par le
   motif de points ondulés. Entre les deux, les sections sont blanches et sobres. Toute l'audace est dans
   l'ouverture ; le reste reste calme.

## 2. Couleurs

Palette fournie par le propriétaire (IMAGE 2). Jetons dans `apps/web/src/app/globals.css` (`@theme`).

| Jeton | Valeur | Rôle |
| --- | --- | --- |
| `qadr-950` / `night` | `#03108E` | aplats du hero et du pied de page, panneaux forts du logiciel |
| `qadr-900` / `brand-strong` | `#042EB7` | survol des actions, liens forts |
| `qadr-800` | `#063FCE` | dégradés, ticket 3D |
| `qadr-600` / `brand` | `#1853D7` | action principale (blanc dessus : 6,4:1) |
| `qadr-500` / `cta-mark` | `#3168DF` | points du motif, accents |
| `canvas` | `#F5F7FA` | fond de page |
| `surface` | `#FFFFFF` | cartes, sections claires |
| `ink` | `#171B26` | titres et texte principal |

- Les teintes `qadr-400` à `qadr-50` sont dérivées pour les fonds doux. Elles ne remplacent aucune valeur
  fournie.
- L'orange et l'ambre sont abandonnés : `cta` vaut désormais le bleu royal.
- Les couleurs d'état restent distinctes du bleu de marque : vert pour la réussite, brun pour
  l'avertissement, rouge pour l'erreur, bleu-vert `#0B6A8C` pour l'information.
- La console Super Admin (`pf-*`) garde son identité monochrome.

Contrastes calculés le 2026-11-10 (formule de luminance relative WCAG 2.2, seuil AA texte courant 4,5:1) :
- blanc sur `#03108E` : 14,3:1 ;
- blanc sur `#1853D7` : 6,45:1 (boutons pleins) ;
- `#C3CDF4` (`night-fg`) sur `#03108E` : 9,1:1, et 6,85:1 sur `#063FCE`, la zone la plus claire du dégradé du hero ;
- `#E6EDFC` sur `#03108E` : 12,2:1 ;
- `#545D72` (`fg-muted`) sur `#F5F7FA` : 6,1:1 ; sur blanc : 6,6:1 ;
- `#636C82` (`fg-subtle`) sur `#F5F7FA` : 4,89:1 ; sur `#F2F6FE` (`qadr-50`) : 4,85:1 : à réserver au texte secondaire ;
- `#1853D7` sur `#F5F7FA` : 6,0:1 (liens) ;
- `#3168DF` sur blanc : 5,0:1.

## 3. Typographie

- **Titres de la page publique : Rubik** (Google Fonts, licence OFL). Elle couvre le latin et l'arabe, avec
  les mêmes graisses. Ses angles légèrement arrondis répondent à la mascotte et donnent une voix amicale sans
  être enfantine. Graisses 700 à 800, approche serrée en latin et normale en arabe (l'espacement négatif
  casse la liaison des lettres arabes).
- **Texte courant : Plus Jakarta Sans**, celle du logiciel. En arabe, c'est la police arabe du système.
- Une seule échelle :
  - titre du hero : `clamp(2.6rem, 7vw, 5.6rem)` ;
  - titres de section : `clamp(2rem, 4.4vw, 3.4rem)` ;
  - texte : 1,05 rem ;
  - lignes de moins de 70 caractères.
- Ni petites capitales espacées au-dessus des titres, ni mot isolé coloré dans un titre.

## 4. Motifs

| Fichier | Origine | Usage |
| --- | --- | --- |
| `public/patterns/qadr-curves.svg` | export Durves fourni par le propriétaire (`my-durves-vector.svg`) : 7 744 cercles convertis en un seul tracé (447 Ko → 60 Ko, 6,8 Ko compressé) | texture du hero et du pied de page, appliquée en `mask-image` et colorée par les jetons |
| `public/patterns/qadr-links.svg` | dessiné pour Qadr Ops : maillons arrondis entrelacés en diagonale, inspirés du symbole du sac de la mascotte | trame discrète des tarifs et de l'appel final |

Les motifs sont toujours colorés par `background-color` (jeton) et `mask-image` : aucune couleur n'est écrite
dans les SVG.

## 5. Mascotte et logo

- Le logo officiel (IMAGE 3) n'est disponible qu'en capture de 118 × 205 px. Il est **inutilisable** pour
  une icône ou une impression.
- `components/landing/mascot.tsx` est une **interprétation vectorielle provisoire** : pieuvre bleue, clin
  d'œil, sac blanc marqué du maillon, quatre tentacules visibles.
  - Elle sert dans la page et pour la marque du menu.
  - Elle ne remplace pas le logo officiel.
  - L'icône de l'application (`public/icons/`) n'est pas modifiée tant que le fichier source n'est pas
    fourni.
- **À fournir par le propriétaire** : le logo en SVG, ou en PNG d'au moins 1024 px, ainsi que la version
  simplifiée pour l'icône de l'application.

## 6. Mouvement

- **GSAP seul** (ScrollTrigger, via `@gsap/react`) pour le mouvement lié au défilement. SplitText n'est pas
  utilisé : les trois lignes du titre sont déjà des éléments séparés, ce qui reste juste en arabe.
- **Pas de Lenis.**
  - Le défilement natif reste plus fiable sur les téléphones Android d'entrée de gamme visés.
  - Il garde le comportement attendu par les lecteurs d'écran et le zoom.
  - Il évite une dépendance. Le brief demande une seule solution de défilement : c'est le défilement natif.
- **Deux moments seulement :**
  1. À l'ouverture : le titre du hero apparaît ligne par ligne, puis les bulles de questions s'affichent.
     Cette entrée est en **CSS pur** (`landing.css`, délais `--d`) : elle part dès le premier affichage. Une
     première version la confiait à GSAP ; sur un téléphone lent, le titre restait caché jusqu'au
     chargement du JavaScript, ce qui retardait le LCP.
  2. Pendant le défilement de la journée : l'aiguille de l'horloge et la ligne de progression suivent la
     lecture.
- Les liens d'ancre sautent directement à leur section, sans défilement doux : les sections hors écran sont
  rendues à la demande et Chrome interromprait le défilement doux en chemin (`docs/product/landing-page.md` § 6).
- `prefers-reduced-motion` : tout est affiché immédiatement, sans animation ni ticket animé. Les moments de
  la journée ne sont estompés que si GSAP a posé `data-day="ready"`.

## 7. 3D

- **Blender n'est pas installé** sur le poste : aucun modèle GLB n'a été produit.
- Le ticket est généré en Three.js :
  - un plan courbé, avec une texture dessinée dans un canvas ;
  - chargé à la demande, seulement si WebGL2 est disponible, que le mouvement n'est pas réduit et que le
    ticket est visible ;
  - densité de pixels plafonnée (1,5, ou 1,25 sur téléphone) ;
  - ressources GPU libérées au démontage, avec un canvas neuf à chaque montage (un canvas dont le contexte
    a été libéré ne peut plus en recréer un) ;
  - remonté si le ticket HTML change de proportions (rotation de l'écran), plutôt qu'étiré.
- Sans WebGL : un ticket en HTML, identique, affiché d'emblée. Il sert aussi de rendu serveur, donc le LCP
  ne dépend jamais de la 3D.

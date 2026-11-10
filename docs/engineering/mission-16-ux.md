# Mission 16, lot F : audit produit et UX (local)

Toutes les mesures ont été faites le 2026-11-10 dans l'aperçu PGlite (`qadr-web-preview-slow-network`, port
3001), avec Playwright, sur le commerce de démonstration. Rien n'a été vérifié sur un vrai téléphone.

## 1. Corrections

| Constat | Correction | Fichier |
| --- | --- | --- |
| 13 pages avec un titre d'onglet générique ou faux | `generateMetadata` → `localizedPageMetadata("meta.<clé>")`, 16 clés fr/en/ar, test de parité dans `messages.test.ts` | `[section]/page.tsx`, `inventory`, `opening`, `team`, `sales/[saleId]`, `receipt`, `meta.ts` |
| Liens « mot de passe oublié », « créer un compte », etc. de 18 px de haut | `inline-flex min-h-11` (44 px) | `components/auth/auth-forms.tsx` |
| En-tête du commerce plus large que l'écran de 8 px à 1280 px (à cause de la barre de défilement) | `min-w-0` sur le groupe de droite, pastille du commerce limitée à `max-w-52` | `components/business/business-shell.tsx` |
| Rapports à 320 px : bouton « période précédente » coupé hors de la carte | champs de date et ligne en `min-w-0` | `components/business/reports-workspace.tsx` |
| Stock à 320 et 360 px : page plus large que l'écran (+57 à +77 px), à cause des grilles implicites dimensionnées sur le contenu | cartes en `min-w-0 grid-cols-[minmax(0,1fr)]` | `components/business/stock-workspace.tsx` |
| Stock à 320 px : nom du produit coupé en « Ciment … » | nom sur deux lignes au plus (`line-clamp-2`), nom complet dans `title` | `components/business/stock-workspace.tsx` |
| Même schéma de grille pour les cartes de colonnes de l'import (pas encore observé faute de fichier chargé) | même correction, par précaution | `components/business/imports-workspace.tsx` |
| Le tableau de bord prenait la date d'Abidjan en dur et non le fuseau du commerce | `businessDate(assertValidTimezone(...))` | `lib/domain/business-data.ts`, voir `fuseaux-horaires.md` |

## 2. Balayage des largeurs

Critères :
- `scrollWidth` doit être égal à `clientWidth` : aucun défilement horizontal de la page ;
- aucun élément ne doit sortir de l'écran hors d'une zone prévue pour défiler (tableaux, puces de filtre) ;
- `dir="rtl"` doit être actif en arabe.

| Écrans | Largeurs et langues | Résultat après correction |
| --- | --- | --- |
| `/`, la page publique | 375, 768, 1280 px ; fr, en, ar | conforme |
| `/login`, `/register` | 320, 360, 390, 768 px ; ar | conforme |
| Les 21 sections de `/business/*` | 320 px en fr, en, ar ; 390 px en fr, ar ; 768 px en ar | conforme |
| `/business/reports`, `/business/stock` | 320 et 390 px ; fr, en, ar (revérifiés après correction) | conforme |

`/business` seul répond 404 : le tableau de bord est `/business/dashboard`. C'était déjà le cas avant cette
mission ; rien n'a été changé.

## 3. Constats non corrigés

- **Cibles de 40 px** : logo de l'en-tête et puces de filtre (`min-h-10`) dans l'espace commerce. C'est
  au-dessus du minimum WCAG 2.2 AA (24 px), mais en dessous des 44 px recommandés. Il faudrait modifier
  des composants partagés : ce changement est à décider avec le design.
- **Serveur d'aperçu** : `next dev` redémarre de lui-même quand il approche de son seuil de mémoire, après
  environ 80 pages compilées. Pendant ce temps, le service worker affiche à juste titre la page hors ligne.
  Les écrans concernés ont été remesurés après chaque redémarrage.
- **Police** : l'aperçu utilise la police de repli au lieu de Plus Jakarta Sans. Les mesures de largeur
  peuvent légèrement changer avec la vraie police, à revérifier sur un build de production.
- Pas de test avec un lecteur d'écran, ni de mesure de contraste automatisée sur toutes les pages.

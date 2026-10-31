# Design system Qadr Ops (application `apps/web`)

## Mission 04 (2026-10-30) — direction artistique officielle

Le propriétaire a fixé une référence visuelle (tableau de bord « FINNOVA ») : on en reprend le **style**, pas le produit, le nom ni les données.

- **Couleurs** (`src/app/globals.css`, `@theme`) :
  - fond lavande `canvas #F3F2FB` ;
  - cartes blanches `surface` ;
  - violet d'action `brand #5B4DF2`, avec les dégradés `.bg-brand-gradient` et `.bg-brand-glow` ;
  - bleu nuit `night #1B1A2E` (`.bg-night-gradient`) pour la navigation et les panneaux forts.
  - L'orange n'est plus utilisé dans l'interface.
- **Police** : Plus Jakarta Sans, variable, latin, environ 27 Ko préchargés, via `next/font`. En arabe, la police arabe du système. Calistoga est retirée.
- **Formes** :
  - cartes `rounded-xl` (24 px), boutons et onglets en pilule ;
  - ombres très légères (`shadow-card`) ; `shadow-brand` sous les actions violettes.
- **Navigation** (`business-shell.tsx`) :
  - **Ordinateur (≥ 1024 px)** : logo à gauche, pilule bleu nuit au centre (7 modules + menu « Plus »), puis à droite la langue, les paramètres et le commerce actif.
  - **Téléphone et tablette** : barre basse flottante bleu nuit, quatre modules et « Modules », zones de sécurité respectées.
- **Composants ajoutés** : `StatCard`, `BarChart` (CSS, sans bibliothèque), `IconButton`, `Monogram` (`ui/data-display.tsx`) et `Card tone="night" | "brand"`.
- **Écrans refondus en Tailwind** : tableau de bord (`dashboard-workspace.tsx`), caisse (`pos-workspace.tsx`), inventaire et navigation.
- **Écrans réalignés sans réécriture** : produits, ventes, clients, stock, fournisseurs, achats, dépenses, paramètres, rapports et détail de vente. Ils passent par `src/app/business-theme.css`, couche `qadr`, qui l'emporte sur `legacy.css`.
  - Leurs textes restent en français en dur.
  - Ils sont à migrer écran par écran vers `src/components/ui`.
- **Montants** : `formatXof` isole chaque montant (LRI … PDI), pour qu'il garde le bon ordre au milieu d'une phrase arabe.

---

Historique mission 03. Ce document complète `design-system/qadr-ops/MASTER.md`. Celui-ci reste la référence pour l'identité : bleu `#2563EB`, orange `#EA580C`, fond `#F8FAFC`, Calistoga pour les titres. Un seul écart : le texte courant utilise les polices du système et non Inter, pour ne rien télécharger.

## Technique

- **Tailwind CSS 4.3.3** avec `@tailwindcss/postcss` 4.3.3 (versions exactes, publiées le 2026-07-16), configuré dans `postcss.config.mjs`.
- **`src/app/globals.css`** déclare l'ordre des couches : `theme, base, legacy, qadr, components, utilities`.
  - **`legacy.css`** contient l'ancien CSS des écrans existants, chargé dans la couche `legacy`. Les utilitaires Tailwind l'emportent toujours sur lui.
  - **Le preflight de Tailwind n'est pas chargé**, pour ne pas réinitialiser les écrans existants. Les nouveaux composants posent donc eux-mêmes leurs marges (`m-0`), bordures et fonds.
  - **Les règles `.business-page input/select`** de `legacy.css` s'appliquent encore aux champs placés dans l'espace commerce. Elles seront retirées quand chaque écran aura migré.
- **Jetons (`@theme`)** : la palette par défaut de Tailwind est retirée (`--color-*: initial`). Seules les couleurs Qadr Ops existent, ce qui empêche les couleurs arbitraires.

| Jeton | Usage |
| --- | --- |
| `canvas`, `paper`, `surface`, `surface-muted` | Fonds : page, encarts « papier », cartes, zones neutres |
| `line`, `line-strong` | Bordures discrètes ; bordures de champs |
| `ink`, `fg`, `fg-muted`, `fg-subtle` | Titres, texte, texte secondaire, indications (contraste ≥ 4,5:1 sur blanc) |
| `brand`, `brand-strong`, `brand-soft` | Actions principales, liens, sélection |
| `cta`, `cta-strong`, `cta-mark`, `cta-soft` | Action de clôture (encaisser, démarrer, envoyer). `cta-mark` (#EA580C) sert aux marques graphiques uniquement : son contraste avec le blanc est insuffisant pour du texte |
| `ok`, `warn`, `danger`, `info` (+ `-soft`, `-line`) | États fonctionnels, toujours accompagnés d'un texte |

- **Rayons** : `sm` 6 px, `md` 10 px, `lg` 14 px, `xl` 20 px.
- **Ombres** : `card`, `raised`, `overlay`.
- **Courbe de mouvement** : `ease-snappy`.
- **Typographie** : `font-heading` (Calistoga, chargée par `next/font` : environ 20 Ko, latin seulement) pour les titres. Polices système pour le texte courant. En arabe, police arabe système, et les titres passent en gras dans cette même police.
- **Mouvement** : animations courtes (150 à 300 ms), coupées par `prefers-reduced-motion`.

## Composants (`src/components/ui/`)

| Fichier | Composants |
| --- | --- |
| `button.tsx` | `Button` (`primary`, `cta`, `secondary`, `ghost`, `danger` ; état de chargement), `buttonClasses` pour les liens. Hauteur minimale de 44 px |
| `field.tsx` | `Field` (libellé visible, aide et erreur reliées par `aria-describedby`), `Input`, `Select`, `Textarea` |
| `quantity-input.tsx` | `QuantityInput` : clavier décimal, boutons ±1 de 48 px, nombres toujours affichés de gauche à droite, aucun code-barres requis |
| `controls.tsx` | `SearchField`, `Segmented` (filtres), `ConfirmDialog` (élément `<dialog>` natif) |
| `feedback.tsx` | `Badge`, `Alert` (`role=alert` pour les erreurs, `status` sinon), `EmptyState`, `ProgressBar`, `Skeleton` |
| `layout.tsx` | `PageHeader`, `Card`, `CardTitle` |
| `icon.tsx` | Icônes SVG inline ; seules les flèches se retournent en RTL |

La vitrine `/design-system` présente tous les composants dans les trois langues. Elle n'est accessible qu'en développement : en production, la route renvoie 404.

## Multilingue et RTL

- **Fichiers** : `src/lib/i18n/` contient `config.ts` (langues, direction, cookie `qadr-locale`), `messages/{fr,en,ar}.ts` et `translate.ts` (clés typées `MessageKey`).
- **Fonctionnement** : le layout racine lit le cookie, puis pose `lang` et `dir` sur `<html>`. Les composants client utilisent `useI18n()`.
- **Contrôles** : TypeScript impose que `en` et `ar` aient la structure de `fr`. Le test `messages.test.ts` vérifie aussi qu'aucune traduction n'est vide et que les variables `{…}` sont identiques d'une langue à l'autre.
- **Mise en page** : toujours avec les propriétés logiques (`ms-`, `pe-`, `start-`, `border-s`, `text-start`). Les règles gauche/droite de `legacy.css` pour l'espace commerce ont été converties en propriétés logiques.
- **Limites** :
  - La préférence de langue est un cookie du navigateur, pas encore une préférence enregistrée par utilisateur.
  - La traduction arabe doit être relue par un locuteur natif.
  - Les écrans autres que l'inventaire et la navigation restent en français en dur.

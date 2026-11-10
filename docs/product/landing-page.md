# Page publique `/` : état livré (mission 16)

Ce document complète le cahier des charges `landing-page-plan.md` : il dit ce qui est construit, sur quels faits
et avec quelles hypothèses. **La page n'est pas déployée.** Elle est vérifiée en local uniquement.

## 1. Fichiers

| Fichier | Rôle |
| --- | --- |
| `apps/web/src/app/page.tsx` | Route `/` : métadonnées traduites, Open Graph, données structurées `SoftwareApplication` (sans note, avis ni prix) |
| `apps/web/src/components/landing/landing-page.tsx` | Composant serveur de la page, sans JavaScript client propre (sélecteur de langue mis à part) |
| `apps/web/src/lib/i18n/messages/landing.ts` | Textes fr/en/ar, typés par `Shape` (parité vérifiée par `messages.test.ts`) |
| `apps/web/src/app/robots.ts` | Tout interdit hors `VERCEL_ENV=production` ; en production, seule la partie publique est indexable |
| `apps/web/public/landing/*.png` | Six captures : tableau de bord (1280 × 800) et caisse sur téléphone (390 × 844), en fr/en/ar |

L'ancienne page d'accueil, qui affichait une maquette fictive en français seulement, reste dans l'historique
Git. `sector-picker.tsx` et les classes de `legacy.css` qu'elle utilisait sont conservés.

## 2. Inventaire : chaque promesse et sa preuve dans le code

| Affirmation de la page | Vérifié dans |
| --- | --- |
| Caisse avec recherche, sans code-barres obligatoire | `/business/sales`, recherche textuelle par nom, référence ou SKU |
| Espèces, Wave, Orange Money, MTN MoMo **enregistrés** (pas encaissés en ligne) | liste des moyens de paiement de la vente ; aucune intégration Mobile Money des ventes |
| Une vente envoyée deux fois n'est enregistrée qu'une fois | `runIdempotent`, clé `Idempotency-Key` |
| Stock, mouvements, inventaire | `stock`, `inventory`, `setVariantStock` |
| Crédits clients et paiements partiels | dettes et paiements des clients |
| Ouverture et clôture de caisse, avec écart | `cash-session.ts`, `cashDifference` |
| Rapports jour/semaine/mois/année et exports Excel/CSV/PDF | `reports.ts`, `lib/exports/` ; la page précise que le PDF n’existe qu’en français et en anglais (422 en arabe) |
| Rôles (caissier, gestionnaire de stock…) | `lib/auth/permissions.ts` |
| Numéros de série pour les téléphones, taille et couleur pour les vêtements | `trackSerial`, variantes taille/couleur |
| Ticket dans une autre langue que l'écran | paramètre de langue du ticket (`receipt-document.ts`) |
| Import de catalogue CSV/Excel | `/business/imports` ; **PDF et photos non annoncés** (D-03) |
| Notifications **dans l'application** | boîte de notifications ; les notifications push ne sont pas annoncées (aucun appareil réel testé) |
| Installable sur l'écran d'accueil | manifeste et service worker (`docs/pwa.md`) |
| Export complet des données | `GET /api/business/data-export` |
| Chaque commerce a son espace séparé | isolation par `business_id`, `tenant-isolation.http.test.ts` |

Le bloc « Ce que Qadr Ops ne fait pas encore » le dit en clair :
- pas de fonctionnement hors ligne ;
- les paiements Mobile Money des ventes sont saisis, pas reçus automatiquement ;
- les PDF et les photos ne sont pas encore importés.

**Absents volontairement :**
- témoignages, nombre de clients, logos de partenaires, notes ;
- prix, durée d'essai, moyens de paiement de l'abonnement ;
- contact, conditions générales, mentions légales.

## 3. Hypothèses retenues en attendant les décisions D1 à D12

| # | Hypothèse appliquée | Pour changer |
| --- | --- | --- |
| D1 | Direction artistique de l'application (Plus Jakarta Sans, violet, nuit) | remplacer les classes du composant |
| D2 | La nouvelle page remplace `/` | restaurer l'ancienne depuis Git |
| D3 | Langue par cookie `qadr-locale`, comme le reste de l'application (rendu dynamique, une seule URL) | des routes `/en`, `/ar` avec `hreflang` restent possibles |
| D4, D5 | Aucun prix ni moyen de paiement affiché | ajouter une section quand les offres sont fixées |
| D6, D7, D12 | Ni contact ni mentions légales ; le pied de page renvoie seulement vers `/privacy` | à fournir par le propriétaire |
| D8 | `/privacy` reste en français seul | traduction à décider |
| D9, D10 | Captures du logiciel seulement ; pas de photos ni de vidéo | budget de prise de vue |
| D11 | Pas de `sitemap` ni d'URL canonique (domaine non choisi) | les ajouter avec le domaine |

## 4. Captures

- Elles sont prises dans l'aperçu PGlite (`npm run preview`), avec le **commerce de démonstration**. Le
  bandeau « Prévisualisation · données fictives » reste visible sur chaque image, et un badge « Données de
  démonstration » est posé sur la page : aucune donnée ne peut passer pour un vrai client.
- Avant la prise, l'invitation d'installation, l'indicateur de développement Next.js et la barre de
  défilement sont masqués.
- L'aperçu n'embarque pas la police Plus Jakarta Sans : les captures montrent la police de repli (Arial). Il
  faudra les refaire depuis un build de production avant la mise en ligne.
- Les noms de produits du catalogue de démonstration restent en français dans les captures arabes et
  anglaises : les noms saisis par un commerçant ne sont jamais traduits.

## 5. Vérifications faites (2026-11-10, local)

- `tsc --noEmit` et `eslint` (landing, `page.tsx`, `robots.ts`) : sans erreur. `messages.test.ts` : 11/11.
- Navigateur (Playwright, aperçu sur le port 3001), en fr, en et ar, à 375, 768 et 1280 px :
  - `scrollWidth` égal à `clientWidth` (aucun défilement horizontal) ;
  - liens, boutons et sélecteurs d'au moins 44 px de haut (seul le lien d'évitement, masqué, fait 1 px tant
    qu'il n'a pas le focus) ;
  - `dir="rtl"` et `lang="ar"` en arabe.
- Corrections faites pendant la vérification :
  - en-tête sur téléphone : le bouton d'inscription n'est plus forcé à l'affichage, et le logo ne se coupe
    plus ;
  - titres en arabe : `letter-spacing` normal et interligne plus grand (l'espacement négatif abîme la
    liaison des lettres) ;
  - capture d'ordinateur en `loading="eager"` (signalée par Next.js comme LCP à 1280 px).

## 6. Non vérifié

- Le texte arabe est à faire relire par un locuteur natif.
- Aucun audit Lighthouse ou WebPageTest sur un vrai téléphone ni sur un réseau lent.
- Pas d'aperçu des partages (Open Graph) sur WhatsApp ni Facebook : la page n'a pas encore d'image de
  partage.
- Pas de test avec un lecteur d'écran (TalkBack, VoiceOver).

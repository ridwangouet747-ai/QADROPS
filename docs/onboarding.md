# Inscription immersive (mission 08)

`/register` (et `/onboarding` pour un compte déjà connecté) affichent `OnboardingWizard` : formulaire en cinq étapes à gauche, boutique qui se construit à droite (ordinateur) ou dans un bandeau compact au-dessus du formulaire (téléphone, tablette). Les anciens formulaires (`RegisterForm`, `OnboardingForm`) restent dans `components/auth`, inutilisés.

## Étapes

1. **Compte** : nom, e-mail, mot de passe et confirmation ; Better Auth `signUp.email` avec le jeton Turnstile. Avec `?next=` (invitation), le parcours s'arrête là et suit le lien.
2. **Commerce** : nom, activité (quincaillerie, téléphonie, boutique générale, vêtements), type (boutique, kiosque, dépôt/grossiste, autre).
3. **Coordonnées** : téléphone et adresse, facultatifs.
4. **Identité** : logo facultatif (PNG/JPEG/WebP, réduit à 256 px, contrôles existants), nom affiché sur les documents (`receipt_settings.display_name`).
5. **Vérification** : récapitulatif, retour possible à chaque étape, création via la route existante `POST /api/account/businesses`.

Validation : React Hook Form 7.89 + Zod + `@hookform/resolvers` 5.9.1, schémas purs dans `src/lib/onboarding/wizard.ts`, erreurs traduites sous chaque champ. Brouillon dans `sessionStorage` (jamais le mot de passe, jamais localStorage/IndexedDB), avec une `creationKey` : rejouer la création renvoie le même commerce (`replayed: true`) ; une clé déjà utilisée par un autre compte n'est jamais reprise. La bienvenue n'apparaît qu'après la réponse 201 du serveur ; une erreur réseau ou serveur laisse le formulaire et le brouillon intacts. Formulaires en `method="post"` et boutons inactifs avant hydratation : aucune donnée personnelle ne peut finir dans l'URL.

## Rendu adapté à l'appareil (`chooseSceneMode`)

| Situation observée | Rendu |
| --- | --- |
| `prefers-reduced-motion`, `saveData` ou WebGL absent | Illustration SVG statique, fondus d'opacité seulement ; ni three.js ni Lottie téléchargés |
| WebGL disponible, écran < 1024 px, pointeur tactile seul, ≤ 4 Go de mémoire ou ≤ 4 cœurs | Scène **3D** en qualité réduite (`tier: "low"`) |
| Ordinateur capable | Scène **3D** en pleine qualité (`tier: "high"`) — three 0.186.1, React Three Fiber 9.8.1, sans Drei |

Depuis le complément de la mission 08, la 3D n'est plus réservée à l'ordinateur : téléphone et tablette reçoivent la vraie scène Three.js en qualité réduite. Le rendu initial est statique ; la décision se fait après le premier affichage (`requestIdleCallback`) : la saisie n'attend jamais la 3D. Lottie (`lottie-web` 5.13 « light », animation générée par `lottie-shop.ts`) ne sert plus que de repli animé après une perte de contexte WebGL ; un échec de Lottie mène au statique. En développement, `?scene=3d|lottie|static` force un rendu (la qualité reste celle de l'appareil).

## Scène 3D

Primitives Three.js uniquement (aucun modèle GLB, aucune texture externe, aucune vidéo) : socle, fondations, murs, toit, store rayé, portes vitrées, enseigne dessinée dans un canvas (nom et logo, arabe compris), aménagement par activité (rayonnages et sacs de ciment, présentoirs de téléphones, portants de vêtements, étagères et réfrigérateur), comptoir, suspensions, plantes, réverbère. Ouverture finale : portes qui glissent, lumière chaude, confettis instanciés, caméra qui se rapproche.

Performance : `frameloop="demand"` (aucune image au repos), arrêt complet hors écran et onglet masqué (`frameloop="never"`), DPR plafonné (1,75 / 1,25), sans antialiasing ni « high-performance » sur appareil modeste, aucune ombre dynamique (ombre de contact factice), aucun post-traitement. Une seule scène montée à la fois. Cadrage calculé selon le format du cadre. Mesure en navigateur : 78 géométries, 3 textures, 5 programmes, stables après trois allers-retours d'étapes (aucune fuite) ; 45 à 59 appels de dessin.

Mesures du rendu réel (Edge 156 sans interface, GPU AMD Radeon Vega 8 via ANGLE/Direct3D 11, WebGL2, 2026-10-31), lues sur le `WebGLRenderer` exposé en développement :

| Capture | Qualité | DPR appareil → rendu | Antialiasing | Appels de dessin | Triangles | Géométries / textures |
| --- | --- | --- | --- | --- | --- | --- |
| `3d-branding-fr-1366.png` (enseigne et logo) | high | 1 → 1 | oui | 67 | 1 636 | 67 / 3 |
| `3d-details-en-768.png` (tablette, tactile) | low | 2 → 1,25 | non | 59 | 1 232 | 59 / 3 |
| `3d-review-ar-390.png` (téléphone, RTL) | low | 3 → 1,25 | non | 67 | 1 840 | 67 / 3 |
| `3d-welcome-fr-1366.png` (bienvenue, confettis) | high | 1 → 1 | oui | 76 | 2 484 | 76 / 3 |

Les captures statiques `static-reduced-fr-390.png` (mouvement réduit, WebGL présent) et `static-nowebgl-ar-1366.png` (`--disable-3d-apis`) confirment : aucun `<canvas>`, aucune ressource three/Lottie téléchargée. Aucune des captures ne déborde en largeur (`scrollWidth == innerWidth`).

Synchronisation avec la saisie (mission 09) : la boutique suit les champs, pas seulement l'étape (`scenePlan(stage, values, accountFilled)`). La dalle monte d'un cran par champ du compte rempli ; murs, enseigne et rayonnages apparaissent à la première lettre du nom ; le comptoir avec le téléphone ; l'éclairage avec l'adresse ; une étape dépassée reste construite. Fluidité : le formulaire se redessine à chaque frappe, mais `OnboardingScene` et la structure 3D ne se redessinent que si le plan visible change (`samePlan`) ; l'enseigne a son propre composant, redessine son canvas au plus une fois par image et décode le logo une seule fois ; chaque frappe donne un petit rebond à l'enseigne. La caméra compose un seul état (cadrage d'étape, redimensionnement du bandeau mobile pendant la saisie, parallaxe) avec des `quickTo` qui se recalent sans repartir de zéro, au lieu de tweens concurrents sur la même propriété ; les apparitions utilisent `overwrite` pour qu'une saisie effacée puis retapée ne double pas l'animation.

Mesure (2026-10-31, serveur de développement, Edge sans interface, frappe simulée de « Boutique Awa » à l'étape Commerce, nom vide au départ) :

| Profil | Appels de dessin avant → après | Images rendues au repos (1,5 s) | Délai frappe → 2ᵉ image, médiane / max |
| --- | --- | --- | --- |
| 1366 px, qualité haute | 5 → 61 | 0 avant, 0 après | 70 ms / 564 ms (1ʳᵉ lettre : apparition de la façade) |
| 390 px, tactile, qualité basse | 5 → 53 | 0 avant, 0 après | 64 ms / 468 ms |

Ces délais sont mesurés en mode développement (React non optimisé, compilation à la volée) ; ils ne valent pas mesure de production et aucun téléphone réel n'a été testé. Capture : `docs/captures/mission-09/onboarding-sync-fr-390.png` (enseigne mise à jour pendant la frappe).

Animations : GSAP 3.15 + `@gsap/react` 2.1.2 (une seule bibliothèque, Motion retirée) pour les transitions d'étape, la bienvenue et la scène ; désactivées si l'utilisateur réduit les mouvements.

## Poids

three.js en morceaux séparés (≈ 240 Ko compressés) chargés seulement en mode 3D ; lecteur Lottie ≈ 46 Ko + 9 Ko compressés, seulement en mode Lottie. Aucune de ces bibliothèques n'apparaît dans les manifestes de `/login`, `/platform` ou des écrans Business.

## Limites

Aucun téléphone réel testé : le téléphone et la tablette sont des émulations (taille, DPR, tactile) sur un GPU d'ordinateur ; la fluidité sur un téléphone d'entrée de gamme reste à mesurer. Les captures ont révélé que l'illustration 4:3 n'était dimensionnée que par sa largeur et sortait du bandeau mobile de 230 px ; elle tient désormais aussi dans la hauteur (unités de conteneur `cqh`). Le choix de la langue de l'interface n'est pas enregistré par utilisateur. Les titres d'onglet et la description du site sont traduits côté serveur (`localizedPageMetadata`, clés `meta.*`). Sur l'écran de bienvenue, le lien facultatif « J'ai un code d'accès » mène à `/business/subscription` et suspend la redirection automatique.

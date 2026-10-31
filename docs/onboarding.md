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
| `prefers-reduced-motion` ou `saveData` | Illustration SVG statique, fondus d'opacité seulement |
| Écran < 1024 px, pointeur tactile seul, ≤ 4 Go de mémoire ou ≤ 4 cœurs, WebGL absent | Animation **Lottie** (lecteur `lottie-web` 5.13 « light », SVG) générée en code (`lottie-shop.ts`, < 60 Ko de JSON, aucun fichier téléchargé) |
| Ordinateur capable | Scène **3D** (three 0.186.1, React Three Fiber 9.8.1, sans Drei) |

Le rendu initial est statique ; la décision se fait après le premier affichage (`requestIdleCallback`) : la saisie n'attend jamais la 3D. Une perte de contexte WebGL bascule vers Lottie, un échec de Lottie vers le statique. En développement, `?scene=3d|lottie|static` force un rendu.

## Scène 3D

Primitives Three.js uniquement (aucun modèle GLB, aucune texture externe, aucune vidéo) : socle, fondations, murs, toit, store rayé, portes vitrées, enseigne dessinée dans un canvas (nom et logo, arabe compris), aménagement par activité (rayonnages et sacs de ciment, présentoirs de téléphones, portants de vêtements, étagères et réfrigérateur), comptoir, suspensions, plantes, réverbère. Ouverture finale : portes qui glissent, lumière chaude, confettis instanciés, caméra qui se rapproche.

Performance : `frameloop="demand"` (aucune image au repos), arrêt complet hors écran et onglet masqué (`frameloop="never"`), DPR plafonné (1,75 / 1,25), sans antialiasing ni « high-performance » sur appareil modeste, aucune ombre dynamique (ombre de contact factice), aucun post-traitement. Une seule scène montée à la fois. Cadrage calculé selon le format du cadre. Mesure en navigateur : 78 géométries, 3 textures, 5 programmes, stables après trois allers-retours d'étapes (aucune fuite) ; 45 à 59 appels de dessin.

Animations : GSAP 3.15 + `@gsap/react` 2.1.2 (une seule bibliothèque, Motion retirée) pour les transitions d'étape, la bienvenue et la scène ; désactivées si l'utilisateur réduit les mouvements.

## Poids

three.js en morceaux séparés (≈ 240 Ko compressés) chargés seulement en mode 3D ; lecteur Lottie ≈ 46 Ko + 9 Ko compressés, seulement en mode Lottie. Aucune de ces bibliothèques n'apparaît dans les manifestes de `/login`, `/platform` ou des écrans Business.

## Limites

Aucun téléphone réel testé (simulations navigateur seulement). Le mode statique et l'absence de WebGL sont couverts par les tests unitaires et le code de repli, pas par des captures. Le choix de la langue de l'interface n'est pas enregistré par utilisateur.

# Mission 16 : Cloudflare, R2, Turnstile et notifications push

Rapport du lot E, rédigé le 2026-11-10. Lecture seule sur Cloudflare : rien n'a été créé, modifié ni supprimé.
Aucun objet n'a été écrit dans R2 ; aucune notification n'a été envoyée à un appareil réel.

## 1. État réel du compte Cloudflare (lu le 2026-11-10)

Lecture faite avec le connecteur Cloudflare (API, requêtes `GET` seulement). `npx wrangler whoami` répond
« not authenticated » : Wrangler n'est pas connecté sur ce poste.

| Élément | État lu |
| --- | --- |
| Compte | Un seul compte, de type `standard`. |
| Zones (domaines) | **Aucune.** Aucun domaine n'est relié à Cloudflare, donc aucun enregistrement DNS, aucun mode proxy, aucune règle WAF, aucun réglage TLS ou cache. |
| Domaines achetés chez Cloudflare (*Registrar*) | Aucun. |
| Turnstile | **Aucun widget.** Les clés de production n'existent pas (constat déjà fait en mission 15). |
| R2 | **Aucun bucket** (juridiction par défaut et `eu`). |
| Workers | Aucun script déployé (la préparation Workers reste inutilisée, décision D-01). |

Conséquence pour `apps/web/.env.local` : `R2_BUCKET_NAME` est renseigné (`qadropsbucket`) alors que
`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID` et `R2_SECRET_ACCESS_KEY` sont **vides**, et ce bucket n'existe pas dans le
compte. `readStorageConfig` considère une configuration partielle comme une erreur : en local, toute route qui
ouvre le stockage (import de catalogue, original d'un import, cron de purge) lève « Cloudflare R2 nécessite
… ensemble ». À corriger par le propriétaire : soit vider aussi `R2_BUCKET_NAME`, soit renseigner les quatre
variables d'un bucket **de test**. Le nom `qadropsbucket` ne porte aucun marqueur de test : le test
d'intégration réel refuse de l'utiliser (§ 3).

## 2. Cloudflare devant Vercel : proxy orange ou DNS seul

Décision D-04, toujours ouverte. Rien n'est à trancher tant qu'aucun domaine n'est ajouté à Cloudflare.

### 2.1 Ce que fait le code aujourd'hui

`src/lib/auth/client-ip-headers.ts` lit **`x-forwarded-for` sur Vercel** et `cf-connecting-ip` **seulement
sur Cloudflare Workers** (détecté par `navigator.userAgent === "Cloudflare-Workers"`, fixé par le runtime).
La phrase de `CLAUDE.md` « lit `cf-connecting-ip` puis `x-forwarded-for` » décrit l'état de la mission 11 et
n'est plus exacte ; `docs/rate-limiting.md` décrit l'état réel.

### 2.2 Quand `cf-connecting-ip` est-il falsifiable ?

- Cloudflare **écrase** `cf-connecting-ip` sur toute requête qui passe par son proxy : un client ne peut pas
  le choisir **à travers Cloudflare**.
- Mais l'application reste joignable **sans** Cloudflare : l'adresse `*.vercel.app` du projet (et l'adresse
  IP Vercel du domaine) répond à n'importe qui. Une requête envoyée directement à Vercel peut porter un
  `cf-connecting-ip` arbitraire, que Vercel transmet tel quel. Lire cet en-tête sur Vercel permettrait donc
  de changer d'adresse à chaque essai et d'échapper à la limitation par adresse.
- `x-forwarded-for` est réécrit par Vercel : il n'est pas falsifiable, mais derrière le proxy il contient
  l'adresse **du nœud Cloudflare**, pas celle du visiteur (Vercel ne relaie l'adresse d'origine qu'avec
  *Verified Proxy*, offre Enterprise, selon la documentation relue en mission 14.1).

### 2.3 Pour que la chaîne soit de confiance en mode proxy

Il faudrait, **ensemble** :
1. une preuve que la requête vient de Cloudflare : un en-tête secret ajouté par une règle Cloudflare
   (*Transform Rules → Modify Request Header*, offre gratuite) et vérifié en temps constant par l'application
   avant de croire `cf-connecting-ip` ; ou une règle du pare-feu Vercel qui n'admet que les plages d'adresses
   publiées par Cloudflare (disponibilité selon l'offre Vercel **à vérifier**) ;
2. le refus du trafic direct sur l'adresse de production (`*.vercel.app` de production protégé par la
   protection de déploiement Vercel, domaine personnalisé seul public) ;
3. une modification de `client-ip-headers.ts` (domaine de l'authentification, hors de ce lot) qui ne lit
   `cf-connecting-ip` que si l'en-tête secret est présent et juste.

Attention : `docs/production-setup-guide.md` § 8.2 propose, pour le mode proxy, de seulement configurer
`ipAddressHeaders: ["cf-connecting-ip"]`. **Sans les points 1 et 2, ce réglage rend la limitation par adresse
contournable.** À corriger dans ce guide par son responsable.

### 2.4 Autres conséquences du proxy

| Sujet | DNS seul (nuage gris) | Proxy (nuage orange) |
| --- | --- | --- |
| Limitation par adresse | Juste (adresse réécrite par Vercel) | Faussée (adresse du nœud Cloudflare) tant que § 2.3 n'est pas fait |
| Certificat TLS | Émis et renouvelé par Vercel | Mode SSL Cloudflare **Full (strict)** obligatoire, jamais *Flexible* ; Vercel déconseille le proxy, l'émission ou le renouvellement de son certificat par défi HTTP peut échouer (à surveiller) |
| Cache | Celui de Vercel seulement | Deux couches : règle de contournement pour `/api/*`, `/business/*`, `/platform/*`, `/sw.js` ; cache long seulement sur `/_next/static/*` et `/icons/*` |
| Pare-feu | Pare-feu Vercel | WAF Cloudflare en plus, mais Vercel voit toutes les requêtes venir de quelques adresses Cloudflare (sa propre protection peut les ralentir) |
| Turnstile, R2 | Indépendants du mode | Indépendants du mode |

**Recommandation inchangée : DNS seul (nuage gris)** pour le lancement. Le proxy ne vaut la peine que si le
WAF Cloudflare devient nécessaire, et seulement après le § 2.3. Vérification réelle à faire sur un déploiement
Preview (voir `docs/rate-limiting.md`, « Chaîne de confiance »).

### 2.5 Turnstile

Code relu (`src/lib/auth/turnstile.ts`, `components/auth/turnstile-widget.tsx`) : Siteverify à chaque jeton,
clé d'idempotence pour le réessai, nom d'hôte et action contrôlés avec les vraies clés, clés de test refusées
en production, `remoteip` issu de `clientIpFrom` (même politique que ci-dessus). Aucun écart constaté.
Reste à faire par le propriétaire : créer le widget (mode *Managed*), y déclarer **exactement** le nom d'hôte
de `BETTER_AUTH_URL` (et celui de staging s'il a son propre widget), puis renseigner les deux clés dans Vercel.

## 3. R2

### 3.1 Audit de l'adaptateur

| Exigence | État |
| --- | --- |
| URL signées 5 min | `DOWNLOAD_URL_TTL_SECONDS = 300`, bornes 1 s à 7 jours dans `presignUrl` |
| Clé d'objet aléatoire | `import_source/<64 hex>` (256 bits), sans nom de fichier ni commerce, contrôlée par expression régulière et contrainte SQL |
| Contrôle du commerce | Fait en base avant tout appel (`getImportOriginal` : jointure par `(business_id, id)`, 404 identique pour un autre commerce) |
| Suppression | Idempotente (404 accepté) ; abandon immédiat ; purge planifiée ; ligne gardée en `deleted` |
| Taille maximale | Par finalité (2 Mio import, plafond 20 Mio), vérifiée avant la base et avant R2 |
| Types autorisés | Détection par octets ; exécutables, archives, macros refusés |
| Intégrité | `x-amz-content-sha256` signé + `Content-MD5` ; empreinte SHA-256 vérifiée en lecture mémoire |
| Écrasement | `If-None-Match: *` |
| Secrets dans les erreurs | Aucun (messages génériques, URL jamais reprise) |

Aucun défaut trouvé dans le code. Les seuls points non vérifiés sont ceux qui dépendent du comportement réel
de R2 (412 sur `If-None-Match`, refus d'un `Content-MD5` faux, en-tête `Content-Disposition` restitué par
l'URL signée, expiration réelle) : c'est l'objet du test ci-dessous.

### 3.2 Test d'intégration réel (désactivé par défaut)

- `src/lib/storage/r2-test-target.ts` : lit **uniquement** `QADR_TEST_R2_ACCOUNT_ID`,
  `QADR_TEST_R2_BUCKET_NAME`, `QADR_TEST_R2_ACCESS_KEY_ID`, `QADR_TEST_R2_SECRET_ACCESS_KEY` (et
  `QADR_TEST_R2_JURISDICTION` facultatif). Jamais les `R2_*` de l'application. Bucket refusé s'il ne porte pas
  le segment `test`, `tests`, `staging`, `dev` ou `preview`.
- `src/lib/storage/r2.integration.test.ts` (10 cas) : dépôt/lecture, refus d'écrasement (412), `Content-MD5`
  faux refusé, URL signée lisible sans identifiants et servie en pièce jointe, signature altérée refusée,
  URL détournée vers une autre clé refusée, URL expirée refusée, lecture non signée refusée (bucket privé),
  jeton incapable de lister les buckets ou d'écrire ailleurs, suppression idempotente puis 404 ; puis avec
  PGlite : A lit son original par URL signée, B reçoit la même réponse qu'un import inconnu, 413/415 sans
  aucun envoi à R2, abandon et purge qui suppriment réellement les objets. Tous les objets créés sont
  supprimés en fin de suite.
- Exécuté ici : **sauté** (aucune variable `QADR_TEST_R2_*`). Avec `QADR_TEST_R2_BUCKET_NAME=qadropsbucket`
  et des valeurs factices, le fichier s'arrête avant toute requête : « le bucket « qadropsbucket » ne porte pas
  de marqueur test/staging/dev/preview ».

### 3.3 À créer par le propriétaire pour lancer ce test

1. Bucket **`qadr-ops-fichiers-staging`** (ou tout nom avec un segment `staging`/`test`), sans accès public,
   sans domaine `r2.dev`.
2. Jeton d'API R2 **Object Read & Write**, portée **ce seul bucket** (le test vérifie qu'il ne peut ni
   lister les buckets ni écrire ailleurs ; un jeton *Admin* le fera échouer, ce qui est voulu).
3. Dans un terminal PowerShell, depuis `apps/web` :
   ```powershell
   $env:QADR_TEST_R2_ACCOUNT_ID='<identifiant du compte>'
   $env:QADR_TEST_R2_BUCKET_NAME='qadr-ops-fichiers-staging'
   $env:QADR_TEST_R2_ACCESS_KEY_ID='<Access Key ID>'
   $env:QADR_TEST_R2_SECRET_ACCESS_KEY='<Secret Access Key>'
   npx vitest run src/lib/storage/r2.integration.test.ts
   Remove-Item Env:QADR_TEST_R2_*
   ```
4. Coût : quelques dizaines d'opérations et quelques Kio par passage ; à confirmer sur la page de tarifs R2.

## 4. Notifications push

### 4.1 Couverture par les tests

| Point | Test |
| --- | --- |
| Abonnement navigateur, enregistrement, 409 puis adresse neuve | `client.test.ts` (nouveau), `push-device-isolation.http.test.ts` |
| Révocation par l'utilisateur, appareil retiré | `notifications.integration.test.ts` |
| Déconnexion (`forgetThisDevice`), même serveur injoignable | `client.test.ts` (nouveau) ; session supprimée côté serveur : `push-device-isolation.http.test.ts` |
| Isolation entre comptes (409 / `foreign`) | `push-device-isolation.http.test.ts`, `client.test.ts` (révocation locale) |
| Expiration 404/410 → appareil désactivé | `web-push.test.ts` (nouveau, réponse du service) + `notifications.integration.test.ts` (désactivation) |
| Échec d'envoi : 429/5xx relance, 4xx définitif, panne réseau | `web-push.test.ts` (nouveau) + `notifications.integration.test.ts` |
| Renouvellement `pushsubscriptionchange` | Présent dans `public/sw.js`, testé par `service-worker.test.ts` |
| Sujet VAPID d'exemple | `vapid-config.test.ts` (nouveau) |

### 4.2 `VAPID_SUBJECT`

- Valeur à poser : **`mailto:support@<domaine retenu>`** (par exemple `mailto:support@qadr-ops.ci` si ce
  domaine est acheté), sur une boîte réellement lue ; ou `https://<domaine>` d'une page de contact.
- Pourquoi `@example.com` doit disparaître : ce domaine est réservé à la documentation (RFC 2606) ; aucun
  message n'y arrive. Le sujet sert au service push (Google, Mozilla, Microsoft, Apple) à joindre l'exploitant
  avant de limiter ou bloquer ses envois (RFC 8292 § 2.1). Certains services sont réputés refuser un sujet
  invalide (non vérifié ici faute d'envoi réel).
- `.env.example` contient encore `VAPID_SUBJECT=mailto:support@example.com` et
  `scripts/generate-vapid-keys.mjs` affiche `mailto:votre-adresse@exemple.com` : à remplacer par leurs
  responsables (hors de ce lot). Le `.env.local` actuel utilise une adresse personnelle `@gmail.com` : elle est
  acceptée (elle est réelle) mais une adresse de rôle sur le domaine est préférable.
- Nouveau comportement (`src/lib/notifications/vapid-config.ts`, utilisé par `vapidFromEnvironment`) : en
  production, un sujet sur un domaine d'exemple ou local désactive le push (« non configuré », les
  notifications internes continuent) et écrit une fois l'avertissement `push.vapid_subject_placeholder`, sans
  valeur. Hors production il reste toléré. Un sujet mal formé (`mailto:` sans adresse valide, `http://`,
  identifiants dans l'URL) est refusé partout.

## 5. Essais sur téléphone réel (à faire par le propriétaire)

Prérequis : application déployée en HTTPS (Preview ou production) avec `VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY` et un `VAPID_SUBJECT` réel ; deux comptes de test (A propriétaire, B d'un autre commerce).
Noter pour chaque étape : appareil, version du système, navigateur, heure, résultat.

### 5.1 Android, Chrome

1. Ouvrir le site dans Chrome, se connecter avec A.
2. *Notifications → Réglages → Activer sur cet appareil* ; accepter la demande d'autorisation. L'appareil
   apparaît dans la liste (« Chrome · Android »).
3. Console Super Admin : *Notifications → Tester* vers A. La notification arrive écran verrouillé, avec le
   titre seul et « Ouvrez Qadr Ops pour voir le détail » (aucun montant).
4. Toucher la notification : l'application s'ouvre sur la bonne page, dans le même onglet si déjà ouvert.
5. Faire une vente avec un caissier de A : le propriétaire reçoit « vente » ; le caissier ne reçoit rien.
6. Fermer Chrome complètement (glisser hors des applications récentes), refaire le test : la notification
   arrive quand même.
7. Mode avion pendant un test, puis le couper : la notification arrive dans la durée de vie (TTL) prévue.
8. Se déconnecter : refaire un test, **rien** n'arrive ; l'appareil n'est plus listé.
9. Se reconnecter avec **B** sur le même téléphone, activer : B reçoit ses tests, A ne reçoit plus rien sur ce
   téléphone.
10. *Paramètres Android → Applications → Chrome → Notifications* : couper pour le site, refaire un test côté
    console : pas d'affichage ; le journal de livraison indique l'échec ou l'expiration sans erreur 500.
11. Réactiver, puis retirer l'appareil depuis la liste des appareils : plus aucun envoi.

### 5.2 iPhone, Safari (iOS 16.4 ou plus récent), application installée

1. Ouvrir le site dans Safari → *Partager → Sur l'écran d'accueil*. Le push web **n'existe pas** dans un
   onglet Safari ordinaire : vérifier que l'écran l'explique au lieu de proposer un bouton inopérant.
2. Lancer l'application depuis l'icône de l'écran d'accueil, se connecter avec A.
3. Activer les notifications **par un toucher** sur le bouton (iOS refuse une demande non déclenchée par
   un geste) ; accepter.
4. Refaire les étapes 3 à 5 du § 5.1 (test console, contenu sans montant, ouverture au toucher).
5. Fermer l'application (balayage) et verrouiller : un test arrive quand même.
6. Mode *Concentration* / *Ne pas déranger* : vérifier le comportement attendu (retenue, puis remise).
7. Déconnexion puis test : rien n'arrive. Reconnexion avec B : isolation comme au § 5.1, étape 9.
8. Supprimer l'icône de l'écran d'accueil, attendre, refaire un test côté console : le service push d'Apple
   doit répondre 410 et l'appareil passer en « expiré » dans le journal.
9. Si l'envoi vers Apple est refusé (403), relever le code d'erreur du journal : c'est en général le JWT VAPID
   (sujet invalide, horloge) ; ne pas réessayer en boucle.

### 5.3 Ce qui ne peut pas être vérifié sans ces essais

Remise réelle par FCM et par le service d'Apple, affichage écran verrouillé, comportement de
`pushsubscriptionchange` lors d'une vraie rotation, délais et regroupement des notifications.

## 6. Variables

À ajouter à `.env.example` par son responsable (commentées, sans valeur), avec la mention « tests seulement,
bucket de test » : `QADR_TEST_R2_ACCOUNT_ID`, `QADR_TEST_R2_BUCKET_NAME`, `QADR_TEST_R2_ACCESS_KEY_ID`,
`QADR_TEST_R2_SECRET_ACCESS_KEY`, `QADR_TEST_R2_JURISDICTION`. Remplacer l'exemple
`VAPID_SUBJECT=mailto:support@example.com` par un commentaire qui exige une adresse réelle du domaine.

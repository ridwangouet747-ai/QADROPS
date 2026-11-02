# Impression thermique (missions 10 et 11, phase 5)

Module **facultatif**, désactivé par défaut et activable par commerce (`/business/printing`). Sans imprimante, Qadr Ops fonctionne comme avant ; le ticket à l'écran (`/business/sales/:id/receipt`, impression navigateur) reste disponible.

> **Rien de ce qui suit n'a été vérifié sur une imprimante réelle (blocage B-2).** Les octets produits sont testés un par un et envoyés à une imprimante simulée ; la sortie papier (accents, page de codes, image arabe, logo, coupe) doit être contrôlée sur place par le propriétaire avec le matériel des commerçants pilotes (§ 7).

## 1. Architecture

| Couche | Emplacement | Rôle |
| --- | --- | --- |
| Document unique | `apps/web/src/lib/printing/receipt-document.ts` | `ReceiptDocument` : la vente validée, traduite, datée au fuseau du commerce, montants déjà calculés |
| Mise en page | `src/lib/printing/receipt-ticket.ts` | `layoutReceipt` : blocs logiques (texte, paire libellé/montant, filet, logo, coupe), page de test ; encodeurs texte et image |
| Profils | `src/lib/printing/profiles.ts` | Largeur (58 mm = 384 points / 32 colonnes, 80 mm = 576 points / 48 colonnes), page de codes, mode d'écriture |
| Moteur ESC/POS | `src/lib/printing/escpos.ts` | ESC @, ESC t n, ESC a, ESC E, GS !, GS v 0 (trame), GS V, DLE EOT ; pages PC858, PC850, Windows-1252 |
| Trame | `src/lib/printing/raster.ts` (pur), `raster-canvas.ts` (navigateur) | Logo et ticket en image 1 bit |
| Service métier | `src/lib/domain/printing.ts`, `receipt.ts` | Réglages, imprimantes et profils, tâches, réimpression idempotente, `getSaleReceiptDocument` |
| API | `/api/business/printing[/devices[/:id]][/jobs[/:id]]` | Permissions `printer:configure` / `printer:print` ; `PATCH /devices/:id` change le profil |
| Liaison navigateur | `src/lib/printing/agent-client.ts` | Appairage, rendu des octets, envoi au service local, état incertain |
| Service local | `apps/print-agent/` | Transmet les octets à l'imprimante (TCP, périphérique, partage Windows, simulée) |
| Interface | `src/components/printing/printing-workspace.tsx`, `src/components/receipts/thermal-receipt.tsx`, caisse | Assistant, profils, tests, aperçu, historique, réimpression, ticket à l'écran |

La vente n'est jamais touchée par l'impression : le serveur prépare le ticket **à partir d'une vente déjà enregistrée dans ce commerce** (commerce lu dans la session, jamais dans la requête) ; une panne laisse la vente intacte.

## 2. Un seul modèle de ticket (`ReceiptDocument`)

`getSaleReceipt` lit la vente, ses lignes, ses paiements et l'identité du commerce ; `buildReceiptDocument` en fait un document **figé** :

- **identité du commerce client** : nom d'affichage du ticket (ou nom du commerce), adresse, téléphone, e-mail, pied de ticket, logo si « afficher le logo » est coché. La marque Qadr Ops n'apparaît pas ;
- **libellés traduits** (fr, en, ar) depuis `src/lib/i18n/messages/printing.ts` (`printing.receipt.*`), sens `rtl` en arabe ;
- **date au fuseau du commerce** (`business_profile.timezone`, `Africa/Abidjan` par défaut ou si le fuseau est invalide), au format `jj/mm/aaaa hh:mm` suivi du nom court du fuseau (« GMT ») : le ticket se lit de la même façon quel que soit l'appareil ;
- **montants** en entiers XOF sérialisés en chaînes (jamais de flottant) : sous-total et remise si une remise existe, total, encaissé (paiements `confirmed` et `partially_refunded`), reste à payer (nul pour une vente annulée ou remboursée, qui porte un bandeau).

Le ticket à l'écran, le ticket ESC/POS en texte et le ticket en image affichent tous `layoutReceipt(document)` : **aucun rendu ne recalcule un montant** (constat I-5). Un champ absent n'est pas imprimé ; rien n'est inventé.

### Ticket à l'écran

`/business/sales/:id/receipt?lang=fr|en|ar` : langue choisie par la personne (par défaut, celle de l'interface), indépendante de la langue de l'interface. En arabe, l'article est en `dir="rtl"` ; montants, références, dates et téléphones sont isolés (`<bdi dir="ltr">` et caractères LRI/PDI) pour ne jamais se lire à l'envers. Aperçu 58 / 80 mm (largeur par défaut : celle des réglages du ticket). Impression par le dialogue du navigateur : elle ne prouve pas qu'un ticket est sorti. Erreurs traduites (403 : accès refusé ; 404 : page introuvable ; sinon message générique, jamais le texte brut du serveur).

## 3. Profils d'imprimante

Chaque imprimante déclarée porte un profil (migration `0016_printer_profiles`, colonnes `print_device.code_page` et `render_mode`, avec contraintes `CHECK`) :

| Réglage | Valeurs | Défaut |
| --- | --- | --- |
| Largeur | 58 mm (384 points, 32 colonnes), 80 mm (576 points, 48 colonnes) | choisie à l'ajout |
| Page de codes (mode texte) | `pc858` (ESC t 19, avec €), `pc850` (ESC t 2, sans €), `wpc1252` (ESC t 16) | `pc858` |
| Écriture | `auto`, `text`, `raster` (image) | `auto` |

En `auto`, le ticket part **en image** s'il est en arabe ou si un caractère sort de la page de codes (il serait imprimé « ? »), et **en texte** sinon. Les numéros ESC t n sont ceux de la table Epson, suivie par la plupart des « compatibles ESC/POS » ; certains modèles génériques numérotent autrement : le choix « image » ne dépend d'aucune page de codes et sert de repli. La page de test annonce la largeur, les colonnes et le mode d'écriture ; un second bouton imprime la page de test en arabe (donc en image).

## 4. Arabe et logo en trame

**Arabe** : les pages de codes arabes (CP864, Windows-1256) exigent la mise en forme contextuelle des lettres et l'ordre visuel, et leur numéro ESC t varie selon les fabricants. Sans matériel pour vérifier, la voie retenue est la plus sûre : le **navigateur** dessine le ticket sur un canvas (mise en forme et sens de lecture corrects, polices du système), le réduit à 1 bit (seuil) et l'envoie en trame **GS v 0**, par bandes de 128 lignes au plus (certaines imprimantes refusent une image haute d'un seul tenant). Le serveur renvoie alors `render: "raster"`, `payload: null` et la mise en page ; il ne fabrique aucune image. Un ticket en image pèse 48 octets (58 mm) ou 72 octets (80 mm) par ligne de points ; au-delà de 1 Mio, il est refusé (`too_large`).

**Logo** : l'image enregistrée (PNG, JPEG ou WebP de 200 Ko au plus, contrôlée à l'enregistrement) est décodée par le navigateur, ramenée à 60 % de la largeur du papier au plus (120 points de haut en 58 mm, 160 en 80 mm, agrandie au plus deux fois), passée en niveaux de gris (transparence posée sur du blanc) puis **tramée** (Atkinson) et centrée. En mode texte, elle est insérée en tête du ticket en GS v 0 ; si elle ne peut pas être décodée, le ticket part sans logo, complet. Une image entièrement blanche n'est pas imprimée.

Les fonctions d'image (`raster.ts`) sont pures et testées octet par octet ; le dessin sur canvas (`raster-canvas.ts`) ne peut pas l'être dans Vitest (pas de canvas en environnement Node) : il n'est vérifié que par la relecture et doit l'être sur place.

## 5. Fiabilité

- Chaque tâche a un identifiant unique transmis au service local, qui **n'imprime jamais deux fois la même tâche** (il renvoie le premier résultat).
- Une seule impression d'origine par (vente, imprimante) : contrainte unique en base. Un double clic ou une impression automatique rejouée renvoie la même tâche ; si elle est déjà transmise, rien n'est renvoyé.
- **Réimpression idempotente** (I-8) : chaque intention de réimprimer porte une clé (`idempotencyKey`) créée par l'interface et gardée tant que la réponse n'est pas arrivée. Elle passe par `runIdempotent` (opération `print.reprint`) : un double clic renvoie la même tâche, un seul audit `printer.receipt_reprinted`. La route HTTP exige la clé (`400 idempotency_key_required`).
- **Incertain** : délai dépassé ou coupure pendant l'envoi. Aucune relance automatique : l'historique demande « Le ticket est sorti » / « Il n'est pas sorti » ; dans le second cas, une réimpression liée est lancée.
- **Échec** (papier, capot, hors ligne, ticket refusé par le service local, image impossible à dessiner) : relancer depuis la caisse crée une réimpression liée, jamais la même tâche.
- **Libellés honnêtes** (I-7) : le statut historique `printed` veut dire « transmis à l'imprimante sans erreur signalée ». L'interface affiche « Transmis » et précise que seul le papier prouve la sortie.
- **Erreurs** (I-9) : codes stables (`forbidden`, `not_found`, `module_disabled`, `business_blocked`, `idempotency_key_required`, `raster_unavailable`, `too_large`, `pairing_expired`, `paper_out`…) traduits en fr/en/ar ; un code inconnu devient « erreur inconnue ».
- Toute création de tâche (test, ticket, réimpression) vérifie `assertBusinessOperational` : un commerce suspendu ou expiré ne peut plus imprimer, mais son ticket à l'écran reste consultable.
- **Vente annulée ou remboursée** : bandeau « VENTE ANNULÉE », « VENTE REMBOURSÉE » ou « REMBOURSÉE EN PARTIE », plus de reste à payer.

## 6. Service local d'impression (`apps/print-agent`, version 0.2.0)

Node.js 20+ **sans aucune dépendance** (pas de module natif à compiler).

```powershell
cd apps/print-agent
copy config.example.json agent-config.json   # puis adapter imprimantes et origines
node src/cli.mjs
```

Au démarrage, la console affiche l'adresse (`http://127.0.0.1:17777`), la durée de validité des appairages et un **code d'appairage à 8 chiffres valable 10 minutes**, à saisir dans Qadr Ops.

Sécurité :
- écoute uniquement sur `127.0.0.1` ;
- **en-tête `Host` contrôlé** (I-10) : seuls `127.0.0.1:<port>`, `localhost:<port>` et `[::1]:<port>` (port réellement écouté) sont acceptés ; tout autre nom reçoit `421 host_not_allowed` avant la moindre lecture. Une page piégée qui ferait pointer son domaine vers l'ordinateur (« DNS rebinding ») est donc refusée ;
- origines autorisées listées dans `allowedOrigins` (CORS strict) ; requête sans origine refusée ; en-tête `Access-Control-Allow-Private-Network` pour Chrome ;
- appairage : code à usage unique, 5 essais au plus, jeton aléatoire de 32 octets dont seule l'empreinte SHA-256 est conservée (`~/.qadr-print-agent/agent-state.json`, droits 600) ;
- **appairage à durée limitée** (I-10) : `tokenTtlDays`, 90 jours par défaut (entre 1 et 365). Passé ce délai, le service répond une fois `401 pairing_expired`, efface le jeton, puis `401 not_paired` ; `GET /status` indique `pairingExpired: true`. Qadr Ops affiche « appairage expiré : demandez un nouveau code ». Les appairages créés avant la version 0.2.0 n'avaient pas d'échéance : au premier démarrage, ils en reçoivent une (date d'appairage + durée, et **jamais moins de 30 jours** après ce démarrage), annoncée dans la console. Aucun poste n'est coupé sans préavis ;
- le navigateur ne choisit qu'une imprimante **déclarée dans la configuration** et envoie des octets ESC/POS (1 Mio au plus, `413 too_large` sinon ; données vides refusées) ; aucune commande système n'est exposée ;
- le jeton reste dans le navigateur de l'ordinateur appairé (`localStorage`) ; il n'est jamais envoyé à Qadr Ops.

Transports :

| `transport` | Usage | État matériel |
| --- | --- | --- |
| `tcp` | Imprimante réseau, port brut 9100 | Oui si l'imprimante répond à DLE EOT (papier, couvercle, coupe, hors ligne) |
| `windows_share` | Imprimante USB installée sous Windows et partagée (copie binaire vers `\\localhost\PARTAGE`) | Non (le spouleur ne le transmet pas) |
| `device` | `/dev/usb/lp0` (Linux), `\\.\COM3` ou `LPT1` | Non |
| `simulated` | Fichier ; tests et démonstration | Simulé |

Un état que l'imprimante ne communique pas est affiché « inconnu », jamais deviné.

## 7. Ce qui n'est pas vérifié sur du matériel (à faire sur place)

**Aucune imprimante physique n'a été testée.** Les tests utilisent une imprimante réseau simulée (serveur TCP qui reçoit les octets et répond aux demandes d'état) et une imprimante fichier. À contrôler par le propriétaire, idéalement sur une XPrinter XP-58 USB et une Epson TM-T20 réseau :

1. Page de test en français, profil `pc858` : accents, « € », « ° », alignement de la colonne de droite à 32 et 48 colonnes. Si des caractères sont faux, essayer `pc850` ou `wpc1252`, puis le mode « image ».
2. Page de test en arabe : lisibilité de l'image, netteté (seuil), largeur réelle (384 / 576 points), vitesse d'impression.
3. Ticket de vente avec logo : rendu du tramage, taille, centrage.
4. Ticket long (nombreuses lignes, noms longs) : impression en bandes sans coupure ni saut, coupe finale.
5. Service local : appairage, expiration (réduire `tokenTtlDays` à 1 pour l'essai), refus d'un nom d'hôte étranger.

## 8. Limites

- Pas de rendu arabe en mode texte : un profil forcé « texte » imprime des « ? » (visibles dans l'aperçu, sans avertissement dédié).
- Le dessin du ticket en image dépend des polices du système du poste de caisse ; une police arabe doit être installée (c'est le cas sous Windows, Android et macOS récents).
- Pas de WebUSB ni de WebSerial (support navigateur partiel) : le service local est la voie fiable.
- Le service local n'est pas encore empaqueté (installateur, démarrage automatique Windows) ni signé.

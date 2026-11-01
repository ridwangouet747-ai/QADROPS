# Impression thermique (mission 10)

Module **facultatif**, désactivé par défaut et activable par commerce (`/business/printing`). Sans imprimante, Qadr Ops fonctionne comme avant ; le ticket à l'écran (`/business/sales/:id/receipt`, impression navigateur) reste disponible.

## 1. Architecture

| Couche | Emplacement | Rôle |
| --- | --- | --- |
| Moteur de tickets | `apps/web/src/lib/printing/escpos.ts` | Octets ESC/POS purs (ESC @, ESC a, ESC E, GS !, ESC t 19 → PC858, GS V, DLE EOT), repli des lignes, lecture d'état |
| Modèles | `src/lib/printing/receipt-ticket.ts` | Ticket de vente 58/80 mm, page de test ; aucune donnée inventée |
| Service métier | `src/lib/domain/printing.ts` | Réglages par commerce, imprimantes déclarées, file des tâches, résultats, historique |
| API | `/api/business/printing[/devices[/:id]][/jobs[/:id]]` | Permissions `printer:configure` / `printer:print` |
| Liaison navigateur | `src/lib/printing/agent-client.ts` | Appairage, envoi au service local, état incertain |
| Service local | `apps/print-agent/` | Transmet les octets à l'imprimante (TCP, périphérique, partage Windows, simulée) |
| Interface | `src/components/printing/printing-workspace.tsx`, caisse | Assistant, test, aperçu, historique, réimpression, impression automatique |

La vente n'est jamais touchée par l'impression : le serveur prépare le ticket **à partir d'une vente déjà enregistrée dans ce commerce** ; une panne laisse la vente intacte (test « une panne d'imprimante n'affecte jamais la vente »).

## 2. Fiabilité

- Chaque tâche a un identifiant unique transmis au service local, qui **n'imprime jamais deux fois la même tâche** (il renvoie le premier résultat).
- Une seule impression d'origine par (vente, imprimante) : contrainte unique en base. Un double clic ou une impression automatique rejouée renvoie la même tâche ; si elle est déjà imprimée, rien n'est renvoyé à imprimer.
- **Incertain** : délai dépassé ou coupure pendant l'envoi. Aucune relance automatique : l'historique demande « Le ticket est sorti » / « Il n'est pas sorti » ; dans le second cas, une réimpression (nouvelle tâche liée à l'originale, tracée dans l'audit) est lancée.
- Impression automatique (option) : après la réponse du serveur à la vente, en arrière-plan, seulement sur l'ordinateur appairé.
- **Échec** (papier, capot, hors ligne) : relancer l'impression depuis la caisse crée une réimpression liée à la tâche échouée (tracée dans l'audit), jamais la même tâche, que le service local refuserait de rejouer (mission 11).
- **Vente annulée ou remboursée** : le ticket, à l'écran comme en ESC/POS, porte un bandeau « VENTE ANNULÉE », « VENTE REMBOURSÉE » ou « REMBOURSÉE EN PARTIE » et n'affiche plus de « reste à payer ». Les paiements remboursés sont libellés comme tels (mission 11).

## 3. Service local d'impression (`apps/print-agent`)

Node.js 20+ **sans aucune dépendance** (pas de module natif à compiler).

```powershell
cd apps/print-agent
copy config.example.json agent-config.json   # puis adapter imprimantes et origines
node src/cli.mjs
```

Au démarrage, la console affiche l'adresse (`http://127.0.0.1:17777`) et un **code d'appairage à 8 chiffres valable 10 minutes**, à saisir dans Qadr Ops (Imprimante → 1).

Sécurité :
- écoute uniquement sur `127.0.0.1` : invisible du réseau et de tout serveur public ;
- origines autorisées listées dans `allowedOrigins` (CORS strict) ; requête sans origine refusée ; en-tête `Access-Control-Allow-Private-Network` pour Chrome ;
- appairage : code à usage unique, 5 essais au plus, jeton aléatoire de 32 octets dont seule l'empreinte SHA-256 est conservée (`~/.qadr-print-agent/agent-state.json`, droits 600) ;
- le navigateur ne choisit qu'une imprimante **déclarée dans la configuration** et envoie des octets ESC/POS (200 Ko au plus) ; aucune commande système n'est exposée ; le nom de partage Windows est validé avant la commande `copy /b` ;
- le jeton reste dans le navigateur de l'ordinateur appairé (`localStorage`) ; il n'est jamais envoyé à Qadr Ops.

Transports :

| `transport` | Usage | État matériel |
| --- | --- | --- |
| `tcp` | Imprimante réseau, port brut 9100 | Oui si l'imprimante répond à DLE EOT (papier, couvercle, coupe, hors ligne) |
| `windows_share` | Imprimante USB installée sous Windows et partagée (copie binaire vers `\\localhost\PARTAGE`) | Non (le spouleur ne le transmet pas) |
| `device` | `/dev/usb/lp0` (Linux), `\\.\COM3` ou `LPT1` | Non |
| `simulated` | Fichier ; tests et démonstration | Simulé |

Un état que l'imprimante ne communique pas est affiché « inconnu », jamais deviné.

## 4. Imprimantes et pilotes

Pris en charge par conception : imprimantes ESC/POS 58 et 80 mm (Epson TM-T20/T82, XPrinter XP-58/XP-80, et compatibles génériques), police A (32 colonnes en 58 mm, 48 en 80 mm), page de code PC858 (accents français, €, °).

**Aucune imprimante physique n'a été testée.** Les tests utilisent une imprimante réseau simulée (serveur TCP qui reçoit les octets et répond aux demandes d'état) et une imprimante fichier. Pour valider, il faut un modèle réel : indiquez la marque et le modèle de l'imprimante des commerçants pilotes (idéalement une XPrinter XP-58 USB et une Epson TM-T20 réseau).

## 5. Limites

- **Logo** : non imprimé en ESC/POS (il faut convertir l'image en trame 1 bit ou la stocker dans la mémoire de l'imprimante) ; le ticket à l'écran l'affiche.
- **Arabe** : les pages de code des imprimantes ne permettent pas un rendu correct (formes contextuelles, sens de lecture) ; les caractères arabes sortent en « ? » et l'interface le signale. Une impression en image est à concevoir.
- Pas de WebUSB ni de WebSerial (support navigateur partiel) : le service local est la voie fiable.
- Le service local n'est pas encore empaqueté (installateur, démarrage automatique Windows) ni signé.

# Service local d'impression Qadr Ops

Petit service Node.js (20+), **sans dépendance**, à lancer sur l'ordinateur relié à l'imprimante thermique. Il reçoit de Qadr Ops (via le navigateur) des tickets ESC/POS déjà préparés et les transmet à l'imprimante.

## Installation

1. Installer Node.js 20 ou plus récent.
2. Copier `config.example.json` en `agent-config.json`, puis :
   - `allowedOrigins` : l'adresse exacte de Qadr Ops (ex. `https://app.qadrops.ci`, ou `http://localhost:3001` en essai) ;
   - `printers` : une entrée par imprimante (voir ci-dessous).
3. Lancer `node src/cli.mjs` (ou `npm start`). Noter le **code d'appairage** affiché (8 chiffres, 10 minutes).
4. Dans Qadr Ops : Imprimante → activer → saisir le code → choisir l'imprimante → imprimer une page de test.

## Imprimantes

```json
{ "id": "comptoir", "name": "Caisse", "transport": "tcp", "host": "192.168.1.50", "port": 9100, "paperWidthMm": 80 }
{ "id": "usb", "name": "XPrinter", "transport": "windows_share", "share": "XP58", "paperWidthMm": 58 }
{ "id": "usb-linux", "name": "USB", "transport": "device", "path": "/dev/usb/lp0", "paperWidthMm": 80 }
```

Imprimante USB sous Windows : installer le pilote du fabricant, puis partager l'imprimante (Propriétés → Partage) sous un nom simple, et l'indiquer dans `share`.

## Sécurité

- N'écoute que sur `127.0.0.1` (port 17777 par défaut).
- N'accepte que les origines listées et les navigateurs appairés (jeton conservé sous forme d'empreinte uniquement).
- N'exécute aucune commande reçue : seulement l'envoi d'octets vers une imprimante déclarée.
- Une même tâche n'est jamais imprimée deux fois.
- **En-tête `Host` contrôlé** (version 0.2.0) : seuls `127.0.0.1:<port>`, `localhost:<port>` et `[::1]:<port>` sont acceptés. Une page qui ferait pointer son propre domaine vers cet ordinateur (« DNS rebinding ») reçoit `421 host_not_allowed` avant toute autre vérification.
- **Appairage à durée limitée** : réglage `tokenTtlDays` (90 jours par défaut, entre 1 et 365). Passé ce délai, le navigateur reçoit `401 pairing_expired` une fois, le jeton est effacé et Qadr Ops affiche « appairage expiré » : il faut relancer le service pour obtenir un nouveau code. `GET /status` répond alors `pairingExpired: true`.
- **Appairages antérieurs à la version 0.2.0** (sans échéance) : au premier démarrage, ils reçoivent une échéance égale à la date d'appairage + `tokenTtlDays`, et jamais moins de 30 jours après ce démarrage. La date est affichée dans la console. Aucun poste n'est donc coupé sans préavis.
- Un ticket ne dépasse pas 1 Mio d'octets ESC/POS (`413 too_large`) : un ticket en image (arabe, logo) pèse 48 octets (58 mm) ou 72 octets (80 mm) par ligne de points, soit de l'ordre de 50 à 250 Kio selon sa longueur.

Pour révoquer tous les appairages : arrêter le service et supprimer `~/.qadr-print-agent/agent-state.json`.

## Tests

`node --test "test/**/*.test.mjs"` : imprimante réseau simulée (TCP 9100 avec réponses d'état), imprimante fichier, pannes, reconnexion, appairage, refus d'origine, refus d'en-tête `Host` étranger, expiration de l'appairage (horloge simulée), délai de grâce des anciens appairages et taille maximale d'un ticket.

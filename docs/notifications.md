# Notifications internes et push (mission 10)

Code : `apps/web/src/lib/domain/notifications.ts` (moteur), `src/lib/notifications/` (catalogue, Web Push, client navigateur), `public/sw.js` (service worker), migration `drizzle/0012_notifications_printing.sql`. Tests : `notifications.integration.test.ts`, `catalog.test.ts`, `web-push.test.ts`.

## 1. Architecture : boîte d'envoi transactionnelle

1. L'opération métier (vente, clôture de caisse, suspension…) écrit son événement dans `notification_outbox` **dans sa propre transaction** (`enqueueNotification`). Une clé de déduplication (`dedup_key`, unique) empêche deux événements identiques ; une vente rejouée n'en crée pas.
2. Après la réponse HTTP (`after()` de Next.js), un traitement indépendant prend les événements en attente (`FOR UPDATE SKIP LOCKED` + verrou de 2 minutes : jamais deux processus sur le même événement). Une tâche planifiée protégée par secret (`/api/internal/notifications/process` : `GET` par Vercel Cron avec `CRON_SECRET`, déclarée dans `apps/web/vercel.json`, ou `POST` par un planificateur externe avec `NOTIFICATIONS_CRON_SECRET` ; en-tête `Authorization: Bearer …`) rattrape le reste et ajoute les échéances d'abonnement.
3. Pour chaque destinataire autorisé : notification interne (une seule par événement et par personne, contrainte unique), puis tentative push sur ses appareils.
4. Chaque tentative est tracée (`notification_delivery`) : `sent`, `retry` (3 essais au plus, 5 puis 10 minutes), `failed`, `expired` (404/410 : appareil désactivé), ou sautée (`skipped_preference`, `skipped_quiet`, `skipped_rate`, `skipped_unconfigured`).
5. Un événement en échec est repris jusqu'à 5 fois (1, 5, 30, 120, 720 minutes) puis marqué `failed`.

**Une vente n'attend jamais une notification** : ni le service push ni le traitement ne sont dans sa transaction. Une exception du service push devient une relance ; elle ne fait jamais rejouer l'événement (le test « une panne du service push n'empêche pas la vente » le vérifie).

## 2. Événements réellement émis

| Événement | Émis par | Destinataires (permission) | Catégorie |
| --- | --- | --- | --- |
| `sale.created` | `createSale` | `report:read`, sauf l'auteur de la vente | Activité |
| `payment.pending` | vente avec Mobile Money | `payment:read` | Activité |
| `stock.low` / `stock.out` | vente qui franchit le seuil d'alerte / vide le stock | `inventory:read` | Activité |
| `cash.closing_gap` | clôture de caisse avec écart | `cash:audit` | Activité |
| `subscription.expiring` | tâche planifiée (fin dans 3 jours) | `business:update` | Abonnement |
| `business.suspended` | suspension par Qadr Agency | tous les membres actifs | Sécurité |
| `system.test` | console, bouton « Tester » | l'administrateur lui-même | Système |
| `announcement` | campagne de la console | segment calculé par le serveur | Annonce |

Non branchés car l'événement n'existe pas encore dans le code : paiement Mobile Money **confirmé** ou **échoué** (aucune intégration prestataire), crédit client **à échéance** (aucune date d'échéance dans le modèle), invitation d'un employé (la personne invitée n'est pas encore membre ; l'e-mail Resend existant reste le canal).

Les membres désactivés ne reçoivent rien ; un membre d'un autre commerce non plus.

## 3. Confidentialité

- Aucune variable de modèle ne porte de montant ni de donnée client. Variables autorisées : `business_name`, `user_name`, `event_date`, `event_type`, `status`, `product_name` (corps seulement).
- Le **message push** ne contient que le titre (variables « sûres » uniquement), un texte générique (« Ouvrez Qadr Ops pour voir le détail. ») et un lien interne ; le détail reste derrière la connexion.
- Les modèles sont du texte : remplacement littéral, balisage `<` `>` refusé, longueur limitée, lien interne seulement (`^/([A-Za-z0-9_-][A-Za-z0-9/_-]*)?$` : « //hote » est refusé, car le navigateur y verrait une autre origine), vérifié par Zod, par une contrainte SQL (migration 0013) et par le service worker, qui n'ouvre jamais une autre origine au clic.
- Les abonnements push ne sont acceptés que vers les services connus (FCM, Mozilla, Windows, Apple) en HTTPS : pas de requête serveur vers une adresse choisie par un tiers.
- Un appareil appartient à un seul compte **et à la session qui l'a enregistré** (mission 13, colonne `push_subscription.session_id`, migration 0023). Aucun push ne part si cette session n'existe plus, a expiré ou appartient à un autre compte : déconnexion, expiration, nouveau mot de passe ou révocation coupent les envois même si le navigateur n'a pas pu prévenir le serveur. Au chargement des espaces connectés, `PushDeviceSync` présente l'adresse du navigateur à `POST /api/notifications/push-subscriptions/claim` : `bound` (rattachée à la session courante), `foreign` (elle appartient à un autre compte : **rien n'est modifié chez lui**, seul ce navigateur se désabonne, ce qui révoque l'adresse auprès du service push) ou `unknown`. Une adresse encore active pour un autre compte n'est jamais reprise : l'enregistrement répond 409 `push_endpoint_taken` et le navigateur demande une adresse neuve, une fois. Connaître l'adresse d'un appareil d'autrui ne permet donc ni de le couper, ni de le reprendre (règle de `tenant-isolation.http.test.ts`). Les relances ne partent que si l'appareil appartient toujours au destinataire ; la déconnexion désabonne le navigateur (`DELETE /api/notifications/push-subscriptions`, raison `signed_out`). En aperçu sans session, un appareil enregistré ne reçoit rien. Tests : `push-device-isolation.http.test.ts`, `notifications.integration.test.ts`.
- La console Super Admin voit des types d'événements, des comptes et des codes d'erreur ; jamais le contenu des notifications ni des données commerciales.

## 4. Préférences

Par personne : langue des notifications (fr/en/ar), push activé, et pour chaque catégorie « dans l'application » / « sur l'appareil ». Sécurité et abonnement restent toujours visibles dans l'application et ignorent la plage de tranquillité (définie dans le fuseau du commerce). Les annonces sont désactivées en push par défaut. Limite : 30 push par heure et par personne (hors sécurité et abonnement). Un push n'est envoyé que pour une catégorie visible dans l'application.

## 5. Web Push sans fournisseur payant

Chiffrement `aes128gcm` (RFC 8291) et authentification VAPID (RFC 8292) écrits avec `node:crypto` : le paquet `web-push` (MPL-2.0) n'a plus de version depuis janvier 2024. Le test reproduit octet pour octet le vecteur officiel de la RFC 8291 et vérifie la signature ES256.

Configuration : `node scripts/generate-vapid-keys.mjs`, puis `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:` ou `https:`). Sans ces variables, les notifications internes fonctionnent et les envois push sont marqués « non configuré ».

## 6. Interfaces et API

- Cloche dans l'en-tête (compteur interrogé toutes les 60 s, seulement onglet visible), panneau des 8 dernières, page `/business/notifications` (filtres non lues / catégorie, pagination par date, réglages, appareils).
- Console : `/platform/notifications` (modèles fr/en/ar avec aperçu push et application, test réel, annonces segmentées pausables, statistiques et erreurs sur 30 jours, traitement manuel de la file).
- API : `GET /api/notifications`, `GET /api/notifications/unread-count`, `POST /api/notifications/read`, `GET|PUT /api/notifications/preferences`, `POST|DELETE /api/notifications/push-subscriptions`, `DELETE /api/notifications/push-subscriptions/:id`, `GET /api/notifications/push-config`, `POST /api/internal/notifications/process`, `GET|POST /api/platform/notifications/templates`, `POST /api/platform/notifications/templates/test`, `POST /api/platform/notifications/campaigns`, `POST /api/platform/notifications/campaigns/:id`, `GET|POST /api/platform/notifications/activity`.

## 7. À valider en conditions réelles

- Push réel sur Android (Chrome), Windows (Edge) et iPhone (Safari 16.4+, application ajoutée à l'écran d'accueil) : aucun envoi vers un vrai service push n'a été fait, faute de clés VAPID configurées et d'appareil.
- Tâche planifiée : Vercel Cron Hobby ne s'exécute qu'une fois par jour ; un rattrapage plus fréquent demande un forfait payant ou un planificateur externe gratuit. Sans tâche planifiée, le traitement après réponse et le bouton de la console suffisent pour l'essentiel.
- `FOR UPDATE SKIP LOCKED` et la concurrence de plusieurs instances : à éprouver sur PostgreSQL réel (PGlite n'a qu'une connexion).

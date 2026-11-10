# Mission 16 : GeniusPay et cycle de vie des abonnements (sous-agent D)

Audit du 2026-11-10 du paiement des abonnements Qadr Ops par GeniusPay. Ce document complète `docs/billing-geniuspay.md` (fonctionnement) et `docs/engineering/geniuspay-sandbox-tunnel.md` (essais réels). Rien n'a été fait en live : aucune clé live n'a été créée, lue ni utilisée, et aucun paiement n'a été créé pendant cette mission.

## 1. Audit du code

| Point | Constat | Où |
| --- | --- | --- |
| Création de facture | Prix, devise XOF et durée copiés de la formule en base sous verrou du profil ; montant envoyé par le navigateur ignoré ; une seule facture ouverte par commerce (index unique partiel). | `prepareCheckout` (`lib/domain/subscription-billing.ts`) |
| Montant | `bigint` de bout en bout ; minimum 200 XOF vérifié avant tout appel ; le montant relu doit être un entier exact (`parseProviderAmount`) et égal à la facture. | `geniuspay.ts`, `anomalyOf` |
| Identifiant de transaction | Référence GeniusPay unique par fournisseur (index unique global) ; alphabet `[A-Za-z0-9_-]{1,64}` compatible avec `SANDBOX_…` observé. | schéma, `REFERENCE_PATTERN` |
| URL fournisseur | Toutes les requêtes passent par `getBillingProvider` → `readGeniusPayConfig` → `GeniusPayProvider.request` (seul `fetch` vers GeniusPay du dépôt, vérifié par recherche). HTTPS + liste blanche `geniuspay.ci`/`genius.ci` (et sous-domaines), sans identifiants dans l'URL, `redirect: "error"`, délai 15 s. La passerelle `apps/webhook-gateway` ne contacte jamais GeniusPay. | `geniuspay.ts` |
| Lien de paiement | `checkout_url` exigé en HTTPS ; son hôte n'est pas limité aux domaines GeniusPay (il vient d'une réponse authentifiée de l'API). | `createCheckout` |
| Signature du webhook | HMAC-SHA256 de `horodatage.corps brut`, hexadécimal, `timingSafeEqual`, ±300 s ; corps lu brut et limité à 64 Ko ; confirmée en sandbox réelle le 2026-11-09. | `verifyGeniusPayWebhookSignature`, route webhook |
| Anti-rejeu | Fenêtre de 300 s + déduplication `(provider, event_id)` ; un événement non traité (panne) est retraité à la relance ; un doublon traité répond `duplicate`. | `handleGeniusPayWebhook` |
| Relecture avant activation | Toujours `GET /payments/{reference}` : statut, référence, environnement, métadonnées, devise, montant. Ni la redirection ni le webhook seuls n'activent. | `verifyAttempt`, `anomalyOf` |
| Idempotence | Unicité `(business_id, idempotency_key)` ; réutilisation d'un paiement encore ouvert ; activation unique sous verrous tentative → profil → facture → abonnements. | `startSubscriptionCheckout`, `confirmAttempt` |
| Rapprochement | Cron quotidien, budget 120 s, `maxDuration = 300`. | `reconcilePendingSubscriptionPayments` |

### Trous trouvés et corrigés (avec test)

1. **Clé live acceptée sans `VERCEL_ENV`.** `NODE_ENV=production` sans `VERCEL_ENV` (un `next start` local, un hébergement hors Vercel) acceptait des clés live. Désormais une clé live exige `VERCEL_ENV=production`. Tests : `geniuspay.test.ts` « refuse une clé sandbox en production, une clé live hors production… » et « le passage en live ne se déclenche jamais par l'URL… ».
2. **Famine du rapprochement.** Le cron relisait les 50 tentatives `pending` les plus anciennes. Une tentative qui reste `pending` à chaque passage (anomalie de montant, paiement abandonné) occupait une place pour toujours ; 50 d'entre elles suffisaient à ne plus jamais rattraper un paiement récent dont le webhook s'est perdu. Désormais : les jamais relues d'abord, puis les moins récemment relues, et seulement celles de moins de 7 jours. Tests : « rapprochement : une tentative en anomalie permanente ne monopolise pas les relectures… » et « rapprochement : une tentative de plus de 7 jours n'est plus relue… ».
3. **Changement de formule bloqué à vie.** La lecture sandbox du 2026-11-10 montre trois paiements encore `pending` un jour après leur création (lien de 24 h). Un paiement abandonné bloquait donc indéfiniment tout changement de formule (`409 payment_in_progress`, « attendez son expiration », qui n'arrive jamais). Désormais il ne bloque plus une heure après l'expiration de son lien ; s'il aboutissait quand même, il est enregistré sur la facture annulée et signalé (`subscription.payment_on_void_invoice`), sans période servie. Test : « paiement abandonné resté « pending » chez GeniusPay après expiration du lien… ».
4. **Tentative d'un autre environnement relue avec la mauvaise clé.** Si une préproduction (sandbox) partageait la base de production (c'est l'état actuel des variables Vercel : `DATABASE_URL` commune à Preview et Production, `docs/engineering/vercel-environments.md`), le cron live relisait les références sandbox avec la clé live chaque jour, et la page de retour affichait « vérifié ». Désormais une tentative d'un autre environnement n'est jamais relue : `verification: "unavailable"`, ignorée par le cron, webhook classé `environment_mismatch`. Test : « tentative d'un autre environnement (base partagée par erreur)… ».

### Trous signalés, non corrigés (décision du propriétaire)

- **Base partagée Preview/Production** : le code empêche un mélange de relectures, mais une préproduction sandbox qui écrit dans la base de production y activerait de vrais abonnements avec des paiements fictifs. Seule la configuration Vercel l'empêche (variables `DATABASE_URL` distinctes) : à faire avant tout déploiement Preview.
- **Paiement confirmé pendant une suspension** : un paiement ouvert avant la suspension et confirmé pendant celle-ci crée une nouvelle période `active` qui court pendant la suspension, puis chevauche la période suspendue à la réactivation. Options : ne servir aucune période (comme un doublon, remboursement manuel), ou la faire commencer après la période suspendue. Non tranché.
- **Secret `whsec_` sans environnement** : un secret sandbox avec des clés live n'est pas détectable ; les webhooks live seraient refusés (401) et seuls la page de retour et le cron confirmeraient.
- **Paiements abandonnés jamais clos localement** : ils restent `pending` en base (miroir de GeniusPay), sans effet sur l'accès.

## 2. Scénarios de régression

« Simulé » = test automatisé avec le faux GeniusPay (base PGlite, vraies sessions et routes). « Sandbox » = observé contre GeniusPay sandbox le 2026-11-09 (mission 15) ou relu le 2026-11-10.

| Scénario | Test automatisé (fichier : nom) | Sandbox réelle |
| --- | --- | --- |
| Paiement réussi | `subscription-billing.http.test.ts` : « succès : le prix vient de la base, la redirection seule n'active rien… » | Oui (2026-11-09, 5 000 et 15 000 XOF ; relus `completed` le 2026-11-10) |
| Paiement échoué | idem : « échec : la tentative est close, rien n'est activé… » (`it.each`, aussi annulation et expiration) | Oui (Failure ; relu `failed` le 2026-11-10) |
| Paiement en attente | « en attente (scénario sandbox « Pending ») puis GeniusPay injoignable pendant le webhook… » | Oui (Pending, 2026-11-09 ; trois paiements encore `pending` le 2026-11-10) |
| Double clic | « idempotence : même clé = même paiement… » ; « double clic simultané (même clé) puis nouvelle clé… » | Oui (2 requêtes simultanées + 1 nouvelle clé) |
| Webhook dupliqué | « webhook dupliqué, second événement et événement tardif… » | Non (renvoi depuis le tableau de bord non essayé) |
| Webhook invalide (signature) | « signature falsifiée, mauvais secret, horodatage périmé ou en-têtes absents… » ; `geniuspay.test.ts` : « signature des webhooks GeniusPay » | Partiel : `POST` sans signature → 401 par le tunnel |
| Retour navigateur falsifié (`result=success` sans paiement) | « succès : … la redirection seule n'active rien… » (relecture `pending`, aucun abonnement) | Oui |
| Webhook perdu + relecture API | « webhook perdu : la seule relecture de la page de retour active, une fois » ; « rapprochement planifié : un paiement abouti dont le webhook s'est perdu… » | Oui pour la page de retour (passerelle coupée) ; cron non joué en réel |
| Montant incorrect | « %s chez GeniusPay : rien n'est activé… » (montant incorrect, montant non entier) | Non (impossible à provoquer en sandbox) |
| Devise incorrecte | idem (devise incorrecte) | Non (impossible à provoquer) |
| Timeout du fournisseur | `geniuspay.test.ts` : « délai dépassé (AbortSignal.timeout, 15 s)… » ; « GeniusPay refuse ou ne répond pas à la création… » | **Non** : le scénario « Timeout » du checkout sandbox n'a pas été joué (il exige un nouveau paiement par navigateur) |
| Fournisseur indisponible | « en attente … GeniusPay injoignable pendant le webhook : 503, la relance … active une seule fois » ; « rapprochement planifié … GeniusPay injoignable » ; « GeniusPay refuse ou ne répond pas à la création » | Partiel : hôte erroné du `.env.local` (2026-11-09) → 502 `provider_unavailable`, rien débité |
| Autre environnement | « tentative d'un autre environnement… » ; « environnement différent » (`it.each`) | Non |
| Référence inconnue | « référence inconnue : journalisée sans commerce… » | Oui en lecture : 404 → `null` (2026-11-10) |

## 3. Sandbox et production

| Élément | Sandbox | Production (live) |
| --- | --- | --- |
| Clés | `pk_sandbox_…` / `sk_sandbox_…` | `pk_live_…` / `sk_live_…` |
| Où elles sont acceptées | développement, test, aperçu local, Vercel Preview (`VERCEL_ENV=preview`) | seulement `NODE_ENV=production` **et** `VERCEL_ENV=production` |
| URL de l'API | `https://geniuspay.ci/api/v1/merchant` (observé) ; l'environnement vient de la clé | même hôte attendu (non vérifié en live) ; `GENIUSPAY_BASE_URL` à laisser vide |
| Références | `SANDBOX_` + 16 caractères (observé) | `MTX-…` d'après la documentation (non vérifié) |
| Webhook | URL et `whsec_` déclarés dans le tableau de bord **sandbox** ; essai par Quick Tunnel | URL `https://app.<domaine>/api/webhooks/geniuspay` et `whsec_` live, déclarés dans le tableau de bord **live** |
| Tableau de bord | scénarios Success / Failure / Timeout / Pending | vrais moyens de paiement, vrais fonds |
| Base | PGlite de démonstration (aperçu) ou branche Neon staging | branche Neon `main`, jamais partagée avec Preview |

Le passage en production **ne peut pas** être déclenché par l'URL : l'environnement vient du préfixe des clés ; une clé live est refusée hors `VERCEL_ENV=production` ; une clé sandbox est refusée en production hors Preview ; un paiement relu dans un autre environnement n'active rien.

## 4. Cycle de vie des abonnements

Pas de prélèvement automatique : chaque période se paie par un paiement ponctuel (D-12-2).

| État → transition | Déclencheur | Test |
| --- | --- | --- |
| (aucun) → `active` | paiement GeniusPay vérifié, première période | `subscription-billing.http.test.ts` : « succès : … » |
| `pending` → `trialing` | code d'essai (promotion privée ou campagne) | `platform-console.integration.test.ts` : « ouvre un essai depuis un abonnement en attente… » ; `business-subscription.integration.test.ts` : « applique un code valide… » |
| `pending` → `active` | paiement de la même formule, rien en cours | « cycle de vie : un abonnement « pending » de la même formule devient « active » au paiement… » |
| `trialing` → `active` | paiement de la même formule pendant l'essai (prolongé depuis la fin) | `campaign-invoice-discount.http.test.ts` : « première facture de la formule choisie… » |
| `active` → `active` (renouvellement) | paiement de la même formule : prolongation depuis la fin, sans jour perdu | « renouvellement : la nouvelle période commence à la fin… » |
| autre formule en cours | nouvel abonnement qui commence à la fin de la période en cours | idem (deuxième partie) |
| `trialing`/`active` → `expired` | date de fin atteinte, cron quotidien (accès refusé dès l'échéance) | `platform-console.integration.test.ts` : « expire automatiquement à l'échéance… » |
| `expired` → (nouvel abonnement `active`) | paiement ; le profil `expired` redevient `active` (`expired` reste terminal) | « commerce expiré : il peut payer et reprend… » |
| paiement refusé / annulé / expiré | tentative `failed`/`canceled`/`expired`, abonnement inchangé, nouvel essai possible | « échec / annulation / expiration : … » |
| `trialing`/`active` → `suspended` | Super Admin, motif obligatoire ; checkout refusé (`403 business_suspended`) | `platform-console.integration.test.ts` : « exige un motif, suspend, bloque les opérations, puis réactive… » ; « commerce expiré : … commerce suspendu : paiement refusé » |
| `suspended` → état d'origine ou `expired` | réactivation par le Super Admin | `platform.integration.test.ts` : « suspends and reactivates the commerce subscription… » |
| toute période → `canceled` | Super Admin, motif obligatoire (terminal) | `platform-console.integration.test.ts` : « prolonge puis annule avec motif… » |
| `confirmed` → `refunded` (tentative) | remboursement constaté chez GeniusPay ; la période n'est pas raccourcie | machine `canMove` ; pas de test dédié (non observable en sandbox) |
| transitions interdites | `expired`/`canceled` terminaux, pas de retour à `pending` | « suit une machine à états cohérente » |

## 5. Vérifications de cette mission

- `npx vitest run src/lib/billing/geniuspay.test.ts` : 18 tests réussis.
- `npx vitest run src/test/subscription-billing.http.test.ts` : 32 tests réussis (24 existants + 8 ajoutés), environ 111 s.
- `npx vitest run src/test/campaign-invoice-discount.http.test.ts src/test/preview-billing-webhook.integration.test.ts src/test/webhook-gateway.integration.test.ts src/lib/billing/geniuspay.test.ts` : 4 fichiers, 29 tests réussis.
- `npx eslint` sur les fichiers modifiés : aucune erreur. `npx tsc --noEmit` : aucune erreur dans ces fichiers (les erreurs restantes sont dans des fichiers d'autres lots).
- Aucun test contre Neon (confié à l'agent B).

## 6. Actions du propriétaire

1. **Supprimer le webhook sandbox du tableau de bord GeniusPay** déclaré le 2026-11-09 sur une adresse `trycloudflare.com` (le sous-domaine peut être réattribué) et renouveler le `whsec_` sandbox si possible.
2. Avant tout déploiement Preview : `DATABASE_URL` distincte pour Preview (branche staging), sinon un paiement sandbox activerait un abonnement réel.
3. Trancher le cas « paiement confirmé pendant une suspension » (§ 1).
4. Jouer le scénario « Timeout » du checkout sandbox lors du prochain essai, puis renvoyer un événement depuis le tableau de bord (doublon réel) et observer une éventuelle relance (Q6).
5. Pour le live : créer les clés live seulement dans la portée Production de Vercel, déclarer le webhook live sur le domaine de production, puis faire un premier paiement réel de faible montant avec autorisation explicite.

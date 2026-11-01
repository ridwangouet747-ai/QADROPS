# Analyse produit avec PostHog (missions 03 et 10)

Code : `apps/web/src/lib/analytics/events.ts` (catalogue), `client.ts` (initialisation, consentement, envoi), `components/analytics-provider.tsx` (bandeau). Tests : `client.test.ts`.

## 1. Principes

- **Consentement d'abord** : rien n'est chargé ni envoyé tant que la personne n'a pas accepté (bandeau « Mesure d'audience »). Global Privacy Control et Do Not Track valent refus, sans bandeau. Refuser ne change rien à l'utilisation.
- **Aucune collecte automatique** : `autocapture`, pages vues automatiques, clics morts, enquêtes et **enregistrement de session désactivés**. L'enregistrement de session reste coupé tant que le masquage des écrans de vente, de caisse et des formulaires n'a pas été vérifié.
- **Catalogue fermé** : seuls les événements ci-dessous partent, avec des propriétés à valeurs énumérées ou booléennes. `before_send` supprime toute autre propriété (URL complète, titre, référent…) et remplace le chemin par sa forme générique (`/business/sales/:id`).
- **Pseudonymisation** : l'identifiant envoyé est une empreinte SHA-256 tronquée de l'identifiant interne ; ni e-mail, ni nom, ni commerce.
- **Indépendance** : sans clé configurée, PostHog n'est pas chargé ; une panne ou un bloqueur de publicités n'a aucun effet sur l'application (aucun appel n'est attendu).
- Persistance en mémoire (aucun cookie PostHog).

## 2. Nomenclature

Noms en anglais, `objet_action` au passé, propriétés en `snake_case`.

| Événement | Propriétés | Mesure |
| --- | --- | --- |
| `signup_completed` | — | Activation des comptes |
| `login_succeeded` / `login_failed` | `reason` : credentials, verification, turnstile, network, other | Erreurs de connexion (jamais l'adresse) |
| `sale_recorded` | `payment_mix` (cash, mobile, mixed, credit), `line_count` (1, 2-5, 6+), `has_customer` | Parcours de vente, première vente (premier événement), usage quotidien |
| `sale_failed` | `reason` | Abandons et erreurs à la caisse |
| `cart_abandoned` | `line_count` | Abandons de parcours |
| `feature_viewed` | `feature` (dashboard, pos, stock, inventory, reports, cash, sales, notifications, printing, subscription, team) | Adoption des fonctionnalités, fréquence |
| `report_exported` | `format`, `period` | Usage des rapports |
| `printer_module_toggled` | `enabled` | Activation des modules |
| `printer_test_printed` | `result` | Mise en service de l'imprimante |
| `print_failed` | `error` (code) | Erreurs d'impression |
| `push_enabled` | `result`, `reason` | Activation des notifications |
| `notification_opened` | `category`, `surface` (bell, inbox, push) | Consultation des notifications |
| `client_error` | `area` | Erreurs (prévu au catalogue, non encore émis) |
| `product_created` | — | Prévu au catalogue, non encore émis |

Jamais envoyés : mot de passe, jeton, coordonnées, nom de client, montant, contenu de vente, identifiant de commerce ou de vente.

## 3. Configuration

`NEXT_PUBLIC_POSTHOG_KEY` (clé **publique** de projet `phc_…`) et `NEXT_PUBLIC_POSTHOG_HOST` (`https://eu.i.posthog.com` pour un hébergement européen). Aucune clé personnelle d'API PostHog ne doit être placée dans l'application. Aucun SDK serveur n'est nécessaire pour ce catalogue.

## 4. Coûts et hébergement (à vérifier sur posthog.com/pricing avant décision)

- PostHog Cloud : une tranche gratuite mensuelle d'événements existait à la date de rédaction ; ses montants et conditions peuvent changer. Avec la collecte limitée ci-dessus et l'enregistrement de session coupé, le volume reste faible. Fixer une limite de facturation dans PostHog avant toute mise en production.
- Auto-hébergement (« hobby », Docker) : nécessite une machine dédiée (plusieurs cœurs et beaucoup de mémoire, ClickHouse inclus) ; non déployé, et non recommandé tant que le volume est faible.

Aucun compte PostHog n'a été créé ni contacté pendant la mission ; les tests utilisent une bibliothèque simulée.

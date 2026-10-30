# Architecture cible QADR OPS

## Décisions prises dans le MVP

- Un seul produit et un seul modèle de données, isolé par `tenantId`.
- Une session porte à la fois l'utilisateur et le tenant ; l'API ne lit ni n'écrit une ressource sans contrôler ce tenant.
- Les ventes, paiements, dépenses et mouvements de stock sont distincts. Les montants sont en unités mineures et ne sont jamais calculés dans le navigateur comme source de vérité.
- Une clé `Idempotency-Key` est obligatoire pour créer une vente ou un paiement. La vente et les mouvements de stock sont enregistrés dans une même transaction de stockage.
- Les produits restent génériques : `unit`, `attributes` et `sku` couvrent les unités de quincaillerie, l'IMEI facultatif ou les tailles/couleurs sans quatre systèmes de stock séparés.

## Limites volontaires du périmètre livré

Cette version est un MVP local : il ne faut pas la déployer telle quelle avec le fichier JSON. Les prochains jalons sont PostgreSQL avec RLS, stockage objet privé pour les logos, vérification des sessions par cookies `HttpOnly`, limitation de débit, sauvegardes, journal d'audit immuable et observabilité.

L'administration de plateforme est une zone séparée, protégée par un rôle non attribuable depuis les tenants. Elle peut piloter les promotions et, ultérieurement, l’état des organisations, mais ne doit pas ouvrir leurs données métier sans ticket de support horodaté, motif et trace d'audit. Le rôle `platform_admin` créé par amorçage ne dispose d’aucun endpoint aux produits, ventes ou paiements des clients.

## Promotions et périodes d'essai

Le rôle `platform_admin` est distinct de tous les rôles de tenant et son premier compte est amorcé par variables d'environnement. Chaque code stocke ses restrictions, ses dates, ses limites et son état. À l'utilisation, une transaction unique vérifie le code, les quotas globaux/par entreprise, les restrictions de secteur et de formule, puis écrit une utilisation qui contient un instantané immuable de l'avantage. Les codes d'essai et d'accès VIP activent l'abonnement et calculent sa fin par jours ou par mois calendaires ; une date de fin échue rend l'espace `expired` sans supprimer les données. Désactiver un code ne modifie jamais ses utilisations précédentes.

## GeniusPay : conclusion d'intégration

La documentation GeniusPay décrit bien le flux à intégrer pour un paiement **initié par QADR OPS** : création serveur d'un paiement (`POST /api/v1/merchant/payments`), passage par le checkout puis webhook, avec Wave, Orange Money et MTN disponibles selon pays/opérateur. Un webhook doit être configuré, son secret ne doit rester que côté serveur, et les événements `payment.success`, `payment.failed` et `payment.refunded` correspondent au modèle de statuts de QADR OPS.

En revanche, la documentation consultée décrit les transactions créées par l'API et n'affirme pas qu'elle remonte tout transfert direct vers le numéro Wave/Orange/MTN habituel d'un commerçant. QADR OPS ne doit donc pas annoncer cette synchronisation. Avant de l'activer, il faut obtenir une confirmation écrite de GeniusPay précisant : comptes marchands pris en charge, périmètre des webhooks, identifiant de rapprochement et délai de disponibilité.

## Contrat d'un futur webhook

1. Retrouver le paiement QADR OPS par la référence fournisseur ou `metadata.order_id`.
2. Recalculer et comparer montant, devise et tenant attendus.
3. Vérifier la signature avec le secret de webhook et conserver l'événement brut de façon chiffrée/à accès restreint.
4. Dédupliquer par l'identifiant d'événement GeniusPay.
5. Dans une transaction base de données, passer le paiement de `pending` à `confirmed`, mettre à jour le solde de la vente et écrire l'audit.
6. En cas d'indisponibilité du fournisseur, reprendre par vérification serveur auprès de son API ; la redirection navigateur n'est jamais une preuve.

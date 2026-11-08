# Registre interne des traitements (projet, mission 13)

> **Projet à valider par un juriste.** Les bases légales, durées et formalités sont des propositions
> fondées sur le fonctionnement réel du code ; elles ne valent pas avis juridique. Voir aussi
> `data-map.md` (prestataires, localisation) et `data-export.md` (droits des personnes).
> Dernière mise à jour : 2026-11-08.

Responsable proposé : **Qadr Agency** (éditrice de Qadr Ops). Coordonnées et référent à compléter.

| # | Traitement | Finalité | Personnes | Données | Base proposée | Destinataires | Durée proposée | Hors Côte d'Ivoire |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Comptes et connexion | Créer et sécuriser l'accès | Commerçants, employés, propriétaire de la plateforme | Nom, e-mail, mot de passe haché, sessions (IP, navigateur), nom d'utilisateur du propriétaire | Exécution du contrat | Équipe Qadr Agency habilitée ; Resend (e-mails) ; Google/Apple si choisis | Durée du compte ; sessions : 7 jours (commerce), 8 h (console) | Oui (Neon, Vercel, Resend) |
| 2 | Gestion commerciale (pour le compte des commerces) | Ventes, stock, clients, dettes, fournisseurs, dépenses | Clients et fournisseurs des commerçants | Noms, téléphones, montants, historique | Qadr Agency sous-traitant : instructions du commerce | Membres du commerce selon leur rôle | Durée de l'abonnement + délai de restitution à définir | Oui (Neon, Vercel) |
| 3 | Équipe d'un commerce | Inviter, attribuer des rôles, désactiver | Employés | Nom, e-mail, rôle, état | Exécution du contrat | Propriétaire et administrateurs du commerce | Durée de l'adhésion ; trace d'audit conservée | Oui |
| 4 | Abonnements et facturation | Facturer, activer, relancer | Commerçants payeurs | Facture, montant, référence GeniusPay, codes promotionnels | Exécution du contrat ; obligations comptables | GeniusPay ; équipe Qadr Agency | Durée légale comptable à confirmer | Selon hébergement GeniusPay |
| 5 | Notifications | Prévenir d'une vente, d'une échéance, d'un incident | Membres | Titre, texte, lien interne ; adresse push du navigateur | Exécution du contrat ; push sur action de la personne | Services push des navigateurs (contenu chiffré) | Boîte : à définir ; appareil coupé à la déconnexion ou à l'expiration de session | Oui |
| 6 | Imports de documents | Transformer un fichier en catalogue | Commerçants (et données de tiers dans les fichiers) | Fichier source, lignes extraites | Exécution du contrat | Aucun tiers : traitement local, sans IA externe (D-03) | `QADR_STORAGE_IMPORT_RETENTION_DAYS` | Oui (R2 si configuré) |
| 7 | Exports et portabilité | Restituer les données | Commerçants | Toutes les données du commerce | Exécution du contrat ; droit d'accès | Propriétaire du commerce | Aucune copie conservée | — |
| 8 | Journal d'audit | Traçabilité des opérations sensibles | Membres, propriétaire de la plateforme | Acteur, type d'événement, entité, métadonnées sans secret | Intérêt légitime (sécurité, preuve) | Équipe habilitée | À définir (ajout seul, non modifiable) | Oui |
| 9 | Suivi des erreurs | Corriger les pannes | Utilisateurs touchés par une erreur | Pile d'appels, URL, identifiant technique | Intérêt légitime | Sentry | Selon réglage Sentry (à fixer) | UE (Allemagne) |
| 10 | Mesure d'audience | Améliorer le produit | Utilisateurs **ayant consenti** | Événements d'un catalogue fermé | Consentement | PostHog | Selon réglage PostHog | Selon hôte configuré |
| 11 | Protection anti-robots | Bloquer les inscriptions automatisées | Visiteurs des formulaires | Jeton Turnstile, IP | Intérêt légitime | Cloudflare | Non conservé par Qadr Ops | Oui |

## Mesures de sécurité en place (constatées dans le code)

- Isolation par commerce sur chaque requête, clés étrangères composées, tests d'attaque A→B.
- Mots de passe hachés (scrypt) ; cookies de session `HttpOnly`, `Secure` en production.
- Console Super Admin : compte unique, connexion dédiée, session de 8 h, tentatives limitées, audit.
- Journal d'audit en ajout seul (déclencheur base de données).
- Fichiers privés : clés aléatoires, URL signées de 5 minutes après contrôle du commerce.
- Exports : propriétaire seul, colonnes secrètes retirées, protection contre l'injection de formules.

## Points ouverts

1. Durées de conservation à arrêter (boîte de notifications, audit, journaux, données après résiliation).
2. Formalités auprès de l'Autorité de protection, dont les transferts hors CEDEAO.
3. Procédure de suppression d'un commerce à la demande : aujourd'hui l'historique est archivé, jamais
   supprimé (règle métier) ; une suppression conforme doit être conçue (anonymisation des clients,
   conservation comptable) et validée.
4. Notification des violations de données : procédure interne à écrire.

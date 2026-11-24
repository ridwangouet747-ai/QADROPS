# Carte des données et des prestataires (mission 13)

> **Statut : document de travail, à valider par un juriste et par le propriétaire.** Il décrit ce que le
> code fait aujourd'hui et ce qui a été vérifié. Il ne constitue pas une déclaration de conformité.
> Dernière mise à jour : 2026-11-10 (localisation de la base relue, mission 16).

Légende de la colonne « Vérifié » :
- **Oui** : constaté directement (code, console du prestataire en lecture seule).
- **Code** : constaté dans le code ; le compte du prestataire n'a pas été inspecté.
- **À vérifier** : dépend d'un réglage du compte qui n'a pas été consulté.

## 1. Prestataires et localisation

| Prestataire | Rôle | Données concernées | Localisation | Vérifié |
| --- | --- | --- | --- | --- |
| **Neon** (PostgreSQL) | Base de données, source de vérité | Toutes les données des commerces, comptes, sessions, journaux d'audit | Projet `qadr-data-base` : région **AWS us-east-1 (Virginie du Nord, États-Unis)**, choisie à la création par l'intégration Vercel et **non modifiable** pour ce projet. Un second projet (`eu-west-2`, Londres) existe, vide et non utilisé. Aucune région Neon en Afrique. | Oui (lecture seule, 2026-11-10) : seule la base de staging est migrée et ne contient que des données de test ; la branche de production est vide. Choix de la région de production à décider (`docs/engineering/neon-production-plan.md` § 4) |
| **Vercel** | Exécution de l'application Next.js, crons | Tout ce qui transite par une requête (données en mémoire, non stockées), journaux d'exécution | Aucune région fixée dans `apps/web/vercel.json` : région des fonctions **par défaut du projet** (souvent `iad1`, États-Unis) | À vérifier dans le projet Vercel |
| **Cloudflare** | DNS, pare-feu (WAF), Turnstile, stockage R2 | Adresses IP et en-têtes des visiteurs ; fichiers privés (imports, exports) dans R2 | Réseau mondial ; R2 : juridiction `eu` possible (`R2_JURISDICTION`), sinon emplacement automatique | Code ; compte à vérifier |
| **Resend** | E-mails transactionnels (vérification, mot de passe, invitations) | Adresse e-mail, nom, nom du commerce, liens à usage unique | À vérifier (compte non créé) | Code ; non configuré |
| **GeniusPay** | Paiement des abonnements Qadr Ops (pas des ventes des commerces) | Référence de facture, montant, nom et e-mail du payeur transmis au prestataire | Côte d'Ivoire (prestataire local) ; hébergement de son API à vérifier | Code ; bac à sable seulement |
| **Sentry** | Erreurs techniques | Pile d'appels, URL, identifiant technique ; pas de corps de requête par défaut | Organisation `qard-ops` hébergée sur **de.sentry.io (Union européenne, Allemagne)** | Oui (2026-11-08) |
| ~~PostHog~~ | **Retiré le 2026-11-24** (mission performance) : plus aucun envoi, ni bibliothèque, ni bandeau. | — | — | — | — |
| **Google / Apple** (facultatif) | Connexion « Continuer avec Google / Apple » | Identifiant de compte, e-mail, nom renvoyés par le fournisseur | Fournisseurs mondiaux | Code ; aucun identifiant configuré |
| **Services push des navigateurs** (FCM, Mozilla, Apple) | Acheminement des notifications | Message chiffré pour l'appareil : titre court, texte générique, lien interne | Fournisseurs mondiaux | Code |

**Conséquence :** dans la configuration actuelle, les données des commerçants seraient hébergées hors de
Côte d'Ivoire et hors CEDEAO (base aux **États-Unis**, Virginie du Nord). Les copies de sauvegarde suivent la
base : historique et instantanés Neon dans la même région ; copies `pg_dump` chiffrées là où l'opérateur les
range (`docs/engineering/backup-restore.md` § 4.3). Aucune promesse de « données en Afrique » ou de
« souveraineté » ne doit être faite. Une base en Union européenne est possible chez Neon, mais n'est pas
en soi une garantie d'adéquation au sens du droit ivoirien : à faire confirmer par le juriste.

## 2. Ce qui ne quitte jamais le serveur

- Secrets (`BETTER_AUTH_SECRET`, clés Resend, GeniusPay, R2, VAPID privée, Google, Apple) : variables
  d'environnement serveur, jamais préfixées `NEXT_PUBLIC_`, jamais journalisées.
- Mots de passe : hachés (scrypt, Better Auth) ; jamais stockés ni journalisés en clair.
- Les exports sont produits en mémoire et envoyés directement : aucune copie n'est conservée.

## 3. Transferts et formalités à instruire (juriste)

1. Formalités auprès de l'Autorité de protection (ARTCI, `autoritedeprotection.ci`) pour les traitements
   de Qadr Agency, y compris les transferts hors de Côte d'Ivoire (hébergement Neon/Vercel, Resend,
   Sentry). Selon une notice de l'Autorité, un transfert hors CEDEAO suppose un niveau de protection au
   moins équivalent : le régime exact (déclaration, autorisation, pièces) reste à confirmer.
2. Répartition des rôles : Qadr Agency est a priori **sous-traitant** pour les données que chaque commerce
   saisit (ses clients, ses ventes) et **responsable** pour les comptes, la facturation des abonnements,
   la sécurité et la mesure d'audience. À confirmer, avec le contrat à signer par les commerçants.
3. Contrats de sous-traitance (DPA) à obtenir de chaque prestataire du tableau.

## 4. Sources consultées (2026-11-08)

- ARTCI, page « Data Protection » : https://artci.ci/en/data-protection/
- Autorité de protection, notice sur la demande de transfert de données à l'étranger :
  https://www.autoritedeprotection.ci/docs/Notice%20explicative%20Comment%20remplir%20la%20demande%20de%20transfert%20de%20donnees%20V.1.2.pdf
  (non lue en entier : son texte n'a pas pu être extrait)
- Références de la loi n° 2013-450 du 19 juin 2013 (NATLEX/OIT) : https://natlex.ilo.org/dyn/natlex2/r/natlex/fe/details?p3_isn=104182

Le texte officiel de la loi n'a pas été lu en entier : aucun numéro d'article n'est cité ici à dessein.

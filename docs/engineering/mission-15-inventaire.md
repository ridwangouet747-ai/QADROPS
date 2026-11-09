# Mission 15 : inventaire des fonctionnalités et preuves (2026-11-09)

Statuts demandés par la mission :
1. Fonctionne en test automatisé.
2. Fonctionne avec une base réelle.
3. Fonctionne avec un fournisseur externe.
4. Fonctionne dans un navigateur.
5. Fonctionne sur téléphone.
6. Non testé.
7. Bloqué.

Une fonctionnalité peut cumuler plusieurs statuts. Chaque statut renvoie à une preuve datée du 2026-11-09 :
- **1** : Vitest dans `apps/web`, 81 fichiers et 640 tests réussis. S'y ajoutent les tests de la passerelle (9), du service d'impression (14) et du MVP (8).
- **2** : branche Neon `mission-14-staging` (base `qadr_staging`), 13 fichiers et 135 tests HTTP réussis, lancés un fichier à la fois. Les sessions Better Auth sont réelles et aucun simulacre métier n'intervient.
- **3** : le seul fournisseur appelé est GeniusPay sandbox. Voir `geniuspay-sandbox-tunnel.md`, section 0 bis.
- **4** : aperçu local (PGlite) dans le navigateur intégré, sur ordinateur et en émulation 375×812.
- **5** : **aucun essai sur un vrai téléphone.** L'émulation de taille d'écran ne vaut pas un essai sur téléphone.

| Fonctionnalité | Statuts | Preuve, ou ce qui manque |
| --- | --- | --- |
| Inscription et création du commerce | 1, 2, 4 | `merchant-journey` étape 1 sur Neon. Écran `/register` affiché. Turnstile de production : **7** (aucune clé). |
| Connexion | 1, 2, 4 | Sessions réelles sur Neon. Message 429 vérifié dans le navigateur. Limites par compte comptées après Turnstile (`rate-limit` sur Neon). |
| Récupération du mot de passe | 1, 2 ; envoi **7** | La limite des demandes est testée sur Neon. Aucun e-mail ne peut partir : Resend n'a aucun domaine. |
| Gestion des utilisateurs et des employés, permissions | 1, 2, 4 | `roles-and-status` (caissier, gérant, membre désactivé) et `tenant-isolation` (équipe) sur Neon. Écran Équipe affiché. Invitation par e-mail : **7** (Resend). |
| Super Admin | 1, 2 | `platform-owner-login` (16 tests : 2FA, sessions) et `platform-and-system` sur Neon. Console non ouverte dans le navigateur pendant cette mission. |
| Gestion des commerces (suspension, expiration) | 1, 2 | `roles-and-status` sur Neon. |
| Produits | 1, 2, 4 | `merchant-journey` étape 2 et isolation sur Neon. Écran affiché. |
| Stock et stock de départ | 1, 2, 4 | `merchant-journey` étape 2 (mouvement d'ouverture). Écrans Stock et Démarrage affichés. |
| Ventes et caisse | 1, 2, 4 | Étapes 3, 4 et 9 (idempotence rejouée deux fois, clôture). Écrans Caisse, Ventes et Clôture affichés. |
| Achats et fournisseurs | 1, 2, 4 | Étape 6 (achat reçu, payé en partie). Écrans affichés. |
| Clients et crédits | 1, 2, 4 | Étape 5 (crédit, paiement partiel, solde). Écran affiché. |
| Dépenses | 1, 2, 4 | Étape 7. Écran affiché. |
| Inventaire physique | 1, 2, 4 | Étape 8 (écart justifié, validation par une autre personne). Écran affiché. |
| Rapports | 1, 2, 4 | Étape 10 (chaque total recalculé à partir des étapes). Écran affiché. |
| Exports CSV, XLSX, PDF et export complet | 1, 2 | Étape 11 ; isolation des exports ; `business-data-export` (9 tests) sur Neon. Aucune limite d'octets sur le XLSX (R8). |
| Impression thermique | 1, 4 (écran) ; papier **6** | Ticket, profils et service local testés. Écran Imprimante affiché. **Aucune imprimante réelle** (B-2). |
| Notifications push | 1, 2 ; envoi **6** | `push-device-isolation` sur Neon. Les clés VAPID sont posées dans `.env.local`, mais aucun envoi réel n'a été fait. Sujet `@example.com` à remplacer. |
| Abonnements | 1, 2, 3, 4 | `subscription-billing` (24 tests) sur Neon, et paiement sandbox de bout en bout dans le navigateur. |
| Codes promotionnels et campagnes | 1, 2 | `public-campaigns` (11 tests) et `campaign-invoice-discount` (6 tests) sur Neon. |
| GeniusPay | 1, 3, 4 | Sandbox réel : succès, échec, attente, double clic, webhook perdu. Live : **6**. Renvoi d'un webhook perdu par GeniusPay : non observé. |
| Resend | 1 ; réel **7** | Clé valide, **aucun domaine**, expéditeur `@gmail.com` non vérifiable. |
| Importation de documents | 1, 2 (isolation, original), 4 (écran) | CSV et XLSX testés. PDF et photos désactivés (D-03). Pas de parcours d'import complet sur Neon. |
| Stockage R2 | 1 ; réel **6** | Contrat et adaptateur SigV4 testés contre un faux. `stored-files` sur Neon utilise le stockage en mémoire. Variables R2 présentes en local, jamais appelées. |
| Paramètres du commerce | 1, 4 | Correctif O-1 (impression bloquée pour un commerce suspendu). Écran affiché. |
| Traductions fr, en, ar | 1 | Parité des clés (`messages.test.ts`). RTL non revérifié pendant cette mission. |
| Fuseaux horaires | 1 | Fuseau fixe `Africa/Abidjan` : limite connue. |
| Fonctionnement hors ligne | **7** | Non implémenté. Le bandeau réseau le dit. |

## Interface sur petit écran (375×812, émulation Android, 2026-11-09)

Écrans mesurés : vue d'ensemble, caisse, produits, ventes, stock, inventaires, rapports, clôture, clients, fournisseurs, achats, dépenses, démarrage, import, équipe, imprimante, paramètres, abonnement, inscription et connexion.

Mesures relevées :
- débordement horizontal : 0 sur chaque écran ;
- cibles tactiles de moins de 32 px dans le contenu des écrans du commerce : 0 ;
- message d'erreur affiché : aucun.

**Petit défaut :** sur `/login` et `/register`, les liens de texte font 16 à 20 px de haut (« Mot de passe oublié ? », « Créer un compte », « Se connecter », « Confidentialité », « Espace Qadr Agency »). C'est utilisable, mais en dessous des 44 px recommandés au doigt.

**Défaut relevé :** 13 écrans gardent le titre d'onglet de la page de présentation (« QADR OPS — Suivez vos ventes… ») au lieu de leur titre traduit : vue d'ensemble, caisse, produits, ventes, stock, inventaires, clients, fournisseurs, achats, dépenses, démarrage, équipe et paramètres. Rapports, clôture, import, imprimante et abonnement ont le bon titre.

Non vérifié : vrai téléphone Android, clavier virtuel, arabe RTL sur ces écrans, lecteurs d'écran.

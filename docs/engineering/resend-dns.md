# Resend : vérifier un domaine d'envoi (mission 16)

Ce document dit comment rendre les e-mails transactionnels de Qadr Ops (réinitialisation du mot de passe,
invitations, vérification d'adresse) réellement envoyables. Le code est prêt (`src/lib/auth/email.ts`) ; **aucun
e-mail réel n'a été envoyé** et rien n'a été modifié chez Resend, Cloudflare ou Vercel pendant la mission 16.

## 1. État constaté le 2026-11-10 (lecture seule)

- Lecture de `GET https://api.resend.com/domains` avec la clé de `apps/web/.env.local` (valeur non affichée) :
  réponse 200, **aucun domaine** dans le compte.
- `RESEND_API_KEY` et `RESEND_FROM_EMAIL` sont présents dans `.env.local`, mais l'adresse d'expédition est sur un
  **domaine de messagerie grand public** : Resend ne permet de vérifier que des domaines dont on contrôle le DNS.
  En l'état, un envoi vers un tiers sera refusé par Resend (erreur de validation, non réessayée par
  `deliverEmail`, signalée dans Sentry par `EmailDeliveryFailedError`) alors que l'interface considère l'e-mail
  « configuré ».
- Conséquence : ne pas recopier ces deux valeurs dans Vercel. Tant que le domaine n'est pas vérifié, laisser
  `RESEND_API_KEY` / `RESEND_FROM_EMAIL` **absents** en production : l'écran « Mot de passe oublié » dit alors
  honnêtement que la réinitialisation par e-mail est indisponible.

## 2. Choix du domaine d'envoi

- Utiliser un **sous-domaine dédié**, par exemple `mail.<domaine-de-l-application>` : la réputation d'envoi et
  les enregistrements SPF/MX de retour restent séparés du domaine principal (site, autres messageries).
- Adresse d'expédition attendue : `RESEND_FROM_EMAIL="QADR OPS <no-reply@mail.<domaine>>"` (le nom affiché est
  libre ; la partie après `@` doit être exactement le domaine vérifié). `RESEND_REPLY_TO` facultatif : une boîte
  réellement lue par l'équipe (par exemple `support@<domaine>`), sinon ne pas la renseigner.
- Région Resend : à choisir à la création du domaine (elle fixe où les e-mails sont traités). Pour la Côte
  d'Ivoire, l'Europe est la plus proche ; noter le choix dans `docs/privacy/` (carte des prestataires).

## 3. Étapes (propriétaire du compte Resend et de la zone DNS Cloudflare)

1. **Resend → Domains → Add domain** : saisir `mail.<domaine>` et la région. Resend affiche alors la liste des
   enregistrements à créer. **Copier les noms et valeurs depuis ce tableau** : la clé DKIM est propre au compte
   et les cibles MX/SPF dépendent de la région ; ce document ne les reproduit volontairement pas.
2. **Cloudflare → DNS → Records** de la zone `<domaine>` : créer chaque enregistrement exactement comme affiché.
   Ce sont en principe :

   | Rôle | Type | Nom (relatif à la zone) | Valeur |
   | --- | --- | --- | --- |
   | DKIM (signature) | TXT | celui affiché par Resend (de la forme `resend._domainkey.mail`) | la clé publique `p=…` affichée par Resend |
   | Retour des rebonds (MAIL FROM) | MX | celui affiché par Resend (un sous-domaine de `mail`, par exemple `send.mail`) | l'hôte et la priorité affichés par Resend |
   | SPF du domaine de retour | TXT | même nom que le MX ci-dessus | la valeur `v=spf1 …` affichée par Resend |
   | DMARC (recommandé) | TXT | `_dmarc.mail` | à définir par nous, en commençant par `v=DMARC1; p=none; rua=mailto:<boîte de rapports>` puis, après quelques semaines sans échec, `p=quarantine` |

   - Ces enregistrements ne sont pas proxifiables : laisser le nuage **gris** (DNS seul).
   - Cloudflare ajoute la zone au nom saisi : saisir `resend._domainkey.mail`, pas le nom complet suivi de la zone.
   - Ne pas créer de second enregistrement SPF sur un nom qui en a déjà un : fusionner les `include:`.
3. **Resend → Verify DNS Records** ; attendre l'état **Verified** pour chaque ligne (de quelques minutes à
   quelques heures selon la propagation).
4. **Clé API** : Resend → API Keys → créer une clé à droits **Sending access**, limitée au domaine `mail.<domaine>`.
   La copier directement dans Vercel (jamais dans le dépôt, un ticket ou une conversation).
5. **Suivi des clics et des ouvertures : désactivés** sur ce domaine (réglage par défaut à conserver). Le suivi
   des clics réécrirait les liens de réinitialisation via un domaine de suivi : le jeton passerait par un tiers.
6. **Vercel** (environnement Production seulement, voir `docs/engineering/vercel-environments.md`) :
   `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (`QADR OPS <no-reply@mail.<domaine>>`), éventuellement
   `RESEND_REPLY_TO`, puis redéployer. La préproduction utilise un autre sous-domaine ou aucune clé.

## 4. Vérification (à faire par une personne, avec un vrai navigateur)

1. `GET /domains` (ou le tableau de bord) : le domaine est `verified`.
2. `/forgot-password` vers une adresse de l'équipe : e-mail reçu, lien valable une heure, une seule utilisation,
   les autres sessions fermées après le changement.
3. Une invitation depuis `/business/team` : e-mail reçu, bonne langue.
4. En-têtes du message reçu : `dkim=pass`, `spf=pass` (domaine de retour), `dmarc=pass`.
5. Journal Vercel : ligne `{"event":"email.delivery","status":"sent"}`, sans destinataire ni lien.
6. Rendu dans Gmail, Outlook et sur téléphone, y compris en arabe.

## 5. Coûts et quotas

L'offre gratuite de Resend limite le nombre d'envois par jour et par mois et le nombre de domaines ; vérifier la
page tarifaire officielle à la date de la décision. Un quota épuisé n'est pas réessayé (`daily_quota_exceeded`,
`monthly_quota_exceeded`) et part dans Sentry ; l'utilisateur voit que l'e-mail n'a pas pu partir pour une
invitation, et le message neutre habituel pour une réinitialisation (rien n'est révélé).

## 6. Comportement du code en cas d'erreur (audit mission 16)

| Situation | Réessai | Raison |
| --- | --- | --- |
| Réseau, délai de 10 s dépassé | oui, 3 essais au plus, attente 0,8 s puis 2,4 s (plafond 5 s) | panne passagère |
| 429 `rate_limit_exceeded`, 5xx, `internal_server_error`, `application_error` | oui, même borne ; `retry-after` respecté (plafond 5 s) | limitation ou panne passagère du fournisseur |
| 429 `daily_quota_exceeded` / `monthly_quota_exceeded` | non | réessayer ne sert à rien avant le lendemain ou le mois suivant |
| Autres 4xx (domaine non vérifié, clé invalide, adresse refusée) | non | erreur de configuration : réessayer enverrait la même requête refusée |

Tous les essais d'un même envoi portent la même clé d'idempotence (pas de doublon). Le journal ne contient que le
type d'e-mail, l'issue, le nombre d'essais et le code d'erreur : ni destinataire, ni lien, ni jeton, ni clé.

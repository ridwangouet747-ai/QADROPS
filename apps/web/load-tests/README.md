# Tests de charge k6 (mission 11, phase 7)

**État : préparés, jamais exécutés.** Aucune préproduction n'existe encore (blocage B-1 de
`docs/engineering/mission-11-plan.md`). Ces scripts ne doivent **jamais** viser la production ni
une base Neon de production.

| Script | Rôle | Charge |
| --- | --- | --- |
| `smoke.js` | Vérifier que la cible répond et que les seuils sont atteignables | 2 utilisateurs virtuels, 1 min, lectures seules |
| `pos-peak.js` | Pic de caisse : recherche d'article, vente en espèces, rejeu, relecture | 0 → 100 → 250 → 500 → 1 000 utilisateurs virtuels sur ~21 min |
| `lib/target.js` | Garde-fou de la cible (testé par `src/test/load-test-guard.test.ts`) | — |
| `lib/session.js` | Connexion Better Auth et sélection du commerce de test | — |

## Garde-fou de la cible

`lib/target.js` est évalué au chargement de chaque script : si `QADR_LOAD_BASE_URL` n'est pas une
préproduction, k6 s'arrête avant la première requête. **Aucune option ne permet de passer outre.**

Cibles acceptées :

- un poste local : `localhost`, `127.0.0.1`, `[::1]`, `*.localhost`, `*.test` ;
- un nom d'hôte dont un segment (séparé par `.` ou `-`) vaut `staging`, `preview`, `preprod`,
  `qa`, `sandbox`, `test` ou `dev`. Exemples : `staging.qadr-ops.example`,
  `qadr-ops-git-main-preview.vercel.app`.

Cibles refusées :

- tout autre nom d'hôte ;
- un marqueur placé dans le chemin ou les paramètres (`/staging`, `?env=preview`) ;
- une cible distante en `http` ;
- une URL qui contient un identifiant ou un mot de passe.

## Variables d'environnement

Passez-les avec `-e NOM=valeur`. Elles ne sont jamais écrites dans le dépôt.

| Variable | Obligatoire | Rôle |
| --- | --- | --- |
| `QADR_LOAD_BASE_URL` | oui | Origine de la préproduction (voir le garde-fou) |
| `QADR_LOAD_EMAIL`, `QADR_LOAD_PASSWORD` | oui | Compte **de test** propriétaire ou caissier du commerce de test |
| `QADR_LOAD_BUSINESS_ID` | oui | Identifiant du commerce de test |
| `QADR_LOAD_TURNSTILE_TOKEN` | si Turnstile est actif | Jeton factice accepté par les clés de test Cloudflare (`XXXX.DUMMY.TOKEN.XXXX`) |
| `QADR_LOAD_WRITE` | non | `true` pour que `pos-peak.js` crée des ventes ; sinon lectures seules |
| `QADR_LOAD_MAX_VUS` | non | Pic de `pos-peak.js` (1 000 par défaut ; les paliers sont proportionnels) |
| `QADR_LOAD_MIN_STOCK` | non | Stock minimal d'un article pour être vendu (1 000 par défaut) |
| `QADR_LOAD_SMOKE_VUS`, `QADR_LOAD_SMOKE_DURATION` | non | Réglages de `smoke.js` (2 et `1m`) |

## Seuils

| Mesure | Seuil |
| --- | --- |
| Taux d'erreur HTTP | `< 1 %` (et arrêt automatique au-delà de 5 % après 1 min) |
| Recherche d'article et relecture de vente, p95 | `< 800 ms` |
| Création de vente | p95 `< 1 500 ms` et p99 `< 3 000 ms` |
| Contrôles (`check`) réussis | `> 99 %` |

Ce sont des objectifs de départ. Ils seront ajustés après la première mesure réelle, sans être
présentés comme des engagements de service.

## Lancer (plus tard, en préproduction seulement)

k6 n'est pas installé dans le projet et n'est pas une dépendance npm. Il s'installe à part
(binaire officiel, voir https://grafana.com/docs/k6/latest/set-up/install-k6/). Depuis `apps/web` :

```powershell
k6 run -e QADR_LOAD_BASE_URL=https://staging.exemple.ci -e QADR_LOAD_EMAIL=charge@exemple.test `
  -e QADR_LOAD_PASSWORD=... -e QADR_LOAD_BUSINESS_ID=... load-tests/smoke.js

# Seulement si le smoke passe, et avec l'accord du propriétaire :
k6 run -e QADR_LOAD_BASE_URL=... -e QADR_LOAD_WRITE=true ... load-tests/pos-peak.js
```

Pour essayer un script sans réseau, lancez l'application en local (`npm run preview`) et visez
`http://localhost:3000` avec un compte d'aperçu.

## Préparer la préproduction

1. Une base **dédiée** (branche Neon de préproduction, jamais la production), migrée par la
   procédure normale et avec l'accord du propriétaire.
2. Un commerce de test avec un abonnement actif, un compte caissier et une caisse ouverte pour ce
   compte. Une vente en espèces exige une caisse ouverte.
3. Des articles avec au moins `QADR_LOAD_MIN_STOCK` en stock de départ, pour qu'aucune vente ne
   soit refusée faute de stock pendant la campagne.
4. Turnstile en clés de test, et la limitation de débit de Better Auth en tête : les scripts ne
   se connectent **qu'une fois**, dans `setup()`, puis partagent le cookie entre les utilisateurs
   virtuels.

## Ce que ces tests mesurent, et ce qu'ils ne mesurent pas

- **Mesuré :** latence et erreurs de la caisse sous charge, respect de l'idempotence quand un
  envoi est rejoué (environ 2 % des ventes), tenue du pool de connexions.
- **Pas mesuré :**
  - plusieurs commerces en parallèle, car un seul commerce de test est chargé ;
  - le rendu des pages ;
  - le service worker ;
  - les imports, les exports lourds et l'impression.
- **Effet sur le stock :** le stock baisse d'une unité par vente. Les ventes créées restent dans
  la base de préproduction ; aucune suppression n'est prévue, car l'historique est archivé et
  jamais supprimé.
- **Coût :** une campagne de 1 000 utilisateurs virtuels consomme du temps de calcul Vercel et
  Neon. Vérifiez les quotas du forfait de préproduction avant de lancer.

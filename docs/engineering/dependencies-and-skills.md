# Skills d'agent et dépendances spécialisées

Avant d'ajouter une dépendance ou un skill, vérifier : maintenance récente, licence compatible avec un usage commercial, absence de faille connue (`npm audit`), et ce qu'il exécute. Noter ici la source, la version et la date de vérification.

## Skills d'agent installés dans le projet

| Skill | Emplacement | Source | Version | Licence | Vérifié le |
| --- | --- | --- | --- | --- | --- |
| `karpathy-guidelines` | `.claude/skills/karpathy-guidelines/SKILL.md` | https://github.com/multica-ai/andrej-karpathy-skills, `skills/karpathy-guidelines/SKILL.md` | commit `2c606141936f1eeef17fa3043a72095b4765b9c2` (2026-04-20), plugin 1.0.0 | MIT déclarée (pas de fichier `LICENSE` dans le dépôt) | 2026-11-01 |

Empreinte SHA-256 de `SKILL.md` : `e2553e9b66299fbca399804d6c44dfa44b2384b979ca5bf8b933b4916bb3141b`. Contenu : Markdown uniquement, aucun script. Copié sans modification. Le skill a été vu dans la liste des skills disponibles de Claude Code après installation.

Pour vérifier qu'il n'a pas changé :

```bash
sha256sum .claude/skills/karpathy-guidelines/SKILL.md
```

## Dépendances spécialisées

| Dépendance | Rôle | Version | État |
| --- | --- | --- | --- |
| `@opennextjs/cloudflare` | Adaptateur Workers | 1.20.15 | Inutilisée depuis D-01 ; 4 alertes élevées via `glob` (build seulement). Retrait soumis à D-06 |
| `wrangler` | CLI Cloudflare | 4.156.0 | Inutilisée depuis D-01 |
| `sharp` | Génère les icônes PNG de l'application installable (`scripts/generate-pwa-icons.mjs`, lancé à la main) | 0.35.5 (transitive) | Déjà installé comme dépendance facultative de Next.js : rien d'ajouté au `package.json`. Les PNG produits sont versionnés, le build n'en dépend pas |
| `read-excel-file` | Lecture des classeurs `.xlsx` pour l'import de catalogue (`src/lib/imports/spreadsheet.ts`) | 9.3.12 (exacte) | MIT. Dépend de `fflate`, `saxen`, `unzipper-esm` et `worker-f`. Ne lit ni `.xls` ni macros. Archive inspectée avant lecture : taille décompressée, nombre d'entrées, `vbaProject.bin`. Vérifié le 2026-11-01 |
| `@vercel/functions` | `attachDatabasePool` : libère les connexions Neon inactives avant la mise en veille d'une instance Vercel (Fluid Compute) | 3.10.1 (exacte) | Paquet officiel Vercel, Apache-2.0, dépend de `@vercel/oidc` 4.0.5. Vérifié le 2026-11-01. Sans effet hors de Vercel |

Les dépendances de Qadr Capture (lecture CSV/XLSX/PDF) et des exports seront ajoutées ici au moment de leur choix, avec version et date de vérification.

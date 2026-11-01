<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## ENGINEERING STANDARDS & KARPATHY GUIDELINES

Section permanente, ajoutée par la mission 11 (2026-11-01). Elle s'applique à toutes les missions suivantes et complète `CLAUDE.md`, qui reste prioritaire.

**Skills installés** (détail, version et empreinte dans `docs/engineering/dependencies-and-skills.md`) :
- `karpathy-guidelines`, dans `.claude/skills/karpathy-guidelines/`. Source : https://github.com/multica-ai/andrej-karpathy-skills, commit `2c606141936f1eeef17fa3043a72095b4765b9c2`, licence MIT déclarée.

**Règles obligatoires :**
1. **Réfléchir avant de coder** : énoncer ses hypothèses, présenter les interprétations possibles, et demander quand une ambiguïté peut coûter une opération irréversible, une dépense ou une faille.
2. **La simplicité d'abord** : le minimum de code qui répond au besoin, sans abstraction pour un usage unique ni configuration non demandée.
3. **Changements chirurgicaux** : ne toucher que ce que la tâche exige, suivre le style existant, signaler le code mort sans le supprimer.
4. **Piloter par les objectifs** : fixer des critères d'acceptation vérifiables, écrire le test qui reproduit le problème, et boucler jusqu'à la preuve (tests, typecheck, lint, build).

**Suivi :**
- Décisions techniques : `docs/engineering/decisions.md`.
- Plan et état de la mission en cours : `docs/engineering/mission-11-plan.md`.
- Tout nouveau skill ou dépendance spécialisée est vérifié (provenance, licence, maintenance, failles, ce qu'il exécute), puis inscrit dans `docs/engineering/dependencies-and-skills.md` avant usage.

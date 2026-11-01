# Journal des décisions techniques

Une ligne par décision, la plus récente en bas. Chaque entrée donne la date, la décision, sa raison et ce qu'elle remplace. Les décisions en attente sont listées dans `docs/engineering/mission-11-plan.md` § 5.

| Date | Code | Décision | Raison | Remplace |
| --- | --- | --- | --- | --- |
| 2026-10-30 | — | L'application Next.js est rassemblée dans `apps/web`, le MVP reste à la racine | Mission 02 | — |
| 2026-11-01 | — | Hébergement sur Cloudflare Workers via OpenNext | Choix du propriétaire, matin | Vercel |
| 2026-11-01 | D-01 | **Hébergement sur Vercel, Cloudflare devant (DNS, WAF, Turnstile, R2)** | Choix du propriétaire, mission 11 : Vercel exécute Next.js sans adaptateur ; Cloudflare apporte la protection et le stockage | Cloudflare Workers (préparation conservée, inutilisée) |
| 2026-11-01 | D-02 | Commits locaux autorisés sur une branche dédiée, jamais de push | Choix du propriétaire | Aucun commit sans accord |
| 2026-11-01 | D-03 | Lecture locale pour CSV, XLSX et PDF texte. Photos et manuscrit via un fournisseur externe, derrière un adaptateur, désactivé tant que le fournisseur, le budget et la clé ne sont pas validés | Choix du propriétaire ; les OCR locaux lisent mal le manuscrit | — |
| 2026-11-01 | — | Traitements asynchrones : table de tâches dans Neon avant toute file d'attente gérée | Simplicité ; aucune mesure ne justifie encore une file | — |
| 2026-11-01 | — | Skill `karpathy-guidelines` installé au niveau du projet (`.claude/skills/`) | Demandé par la mission 11 ; Markdown seul, licence MIT déclarée | — |

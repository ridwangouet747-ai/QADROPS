# Caisse : règlements, monnaie rendue et Mobile Money déclaratif

Mise à jour du 2026-11-17 (migration `0027_manual_payments_cash_change`).

## 1. Règle

Qadr Ops **enregistre** ce que le caissier constate ; il ne déclenche, n'initie ni ne vérifie aucun transfert.
Le client paie hors de Qadr Ops (billets, transfert Wave, Orange Money, MTN MoMo, Moov Money…) et le caissier
saisit le montant reçu. Aucune passerelle n'est appelée : GeniusPay reste en pause et ne concerne que les
abonnements de la plateforme, jamais les ventes des commerces.

Moyens acceptés (`src/lib/payment-methods.ts`, `manualPaymentMethods`) : `cash`, `wave`, `orange_money`,
`mtn_momo`, `moov_money`, `other`. Toute nouvelle valeur doit aussi entrer dans les contraintes
`payment_method_check`, `opening_payment_method_check` et `expense_payment_method_check`.

## 2. Les notions à ne jamais mélanger

| Notion | Où | Exemple : vente de 2 000 F, Wave 1 200 F, 1 000 F remis en espèces |
| --- | --- | --- |
| Total de la vente (chiffre d'affaires) | `sale.total_xof` | 2 000 |
| Part affectée à chaque moyen | `payment.amount_xof` | Wave 1 200, espèces 800 |
| Espèces remises par le client | `payment.tendered_xof` (espèces seulement) | 1 000 |
| Monnaie rendue | `payment.change_xof` = remis − affecté | 200 |
| Payé / reste dû | somme des `amount_xof` confirmés / total − payé | 2 000 / 0 |
| Espèces nettes dans le tiroir | `amount_xof` des paiements espèces | + 800 |

La contrainte `payment_cash_tender_check` garantit en base : pas de somme remise hors espèces, remis ≥ affecté,
monnaie = remis − affecté. La monnaie ne compte jamais dans le payé, le chiffre d'affaires ni les rapports.

## 3. Écran de caisse (`components/business/pos-workspace.tsx`, calcul `lib/pos/settlement.ts`)

- La ligne espèces est préremplie avec le reste dû et le suit tant que le caissier n'y touche pas : un paiement
  exact s'encaisse sans ressaisie.
- Si le montant remis dépasse le reste dû, l'écran affiche la monnaie à rendre ; la vente n'enregistre que la
  part affectée et transmet la somme remise (`tenderedXof`).
- Un montant inférieur laisse un reste dû : il faut alors choisir un client (vente à crédit, règles inchangées).
- Plusieurs lignes possibles (paiement mixte), chacune modifiable ou supprimable avant validation. Un montant
  Mobile Money ou « autre » supérieur au total est refusé (aucune monnaie n'est rendue sur un transfert).
- **Confirmer la réception** (2026-11-19) : chaque ligne Mobile Money ou « autre » porte une case que le caissier
  coche après avoir vu le transfert arrivé sur le téléphone du commerce ; tant qu'une ligne n'est pas confirmée, la
  vente ne part pas. Modifier le montant ou le moyen décoche la case. Le serveur enregistre le caissier
  (`recorded_by_user_id`) et l'heure (`confirmed_at`).
- **Référence de transaction** facultative (Mobile Money et « autre », jamais espèces), conservée dans
  `payment.provider_reference`. Elle n'est vérifiée auprès d'aucun opérateur. Unique par commerce : une référence
  déjà enregistrée est refusée (409 `payment_reference_used`), signe d'un transfert déclaré deux fois.
- Formules : R = max(0, T − M) ; A = min(C, R) ; D = max(0, C − R) ; P = M + A ; S = max(0, T − P) ; reste dans le
  tiroir = C − D (affiché sous la monnaie à rendre).
- Le serveur (`createSale`) refait tous les contrôles ; le calcul du navigateur sert seulement à l'affichage.
  La clé d'idempotence couvre la somme remise : un rejeu identique renvoie la même vente, un rejeu différent 409.

## 4. Statut des paiements

Depuis 0027, tout règlement saisi à la vente est `confirmed` à la saisie (c'est le constat du caissier).
Les paiements Mobile Money **antérieurs** restés `pending` gardent ce statut : l'historique n'est pas réécrit,
ils restent exclus des encaissements et se confirment toujours depuis le détail de la vente.

## 5. Tiroir-caisse et reçu

- Session de caisse : les espèces attendues comptent la part nette (800 F) ; le détail affiche en plus
  « dont billets reçus » (1 000 F) et « dont monnaie rendue » (200 F), hors calcul.
- Reçu (`lib/printing/receipt-document.ts`, `receipt-ticket.ts`) : une ligne par moyen avec sa part affectée,
  puis « Espèces remises », « Monnaie rendue », le reste dû éventuel et le statut (Payé, Partiellement payé,
  À crédit), en fr/en/ar. Chaque ligne Mobile Money est suivie de « enregistré manuellement » et, si elle existe,
  de sa référence. Le détail de la vente montre aussi la référence, la somme remise et la monnaie.

## 6. Tests

`lib/pos/settlement.test.ts` (exemples chiffrés du mandat), `lib/domain/commercial.integration.test.ts`
(colonnes en base, rejeu, refus, contrainte), `lib/domain/cash-session.integration.test.ts` (tiroir),
`lib/printing/receipt-document.test.ts` (reçu), `lib/db/pglite-migrations.integration.test.ts` (0027).

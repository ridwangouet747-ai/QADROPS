/**
 * Moyens de règlement d'une vente, d'une dette de départ ou d'une dépense. Tous sont **déclaratifs** :
 * le client paie hors de Qadr Ops (espèces, transfert Wave, Orange Money, MTN MoMo, Moov Money…) et le
 * caissier enregistre ce qu'il a constaté. Qadr Ops ne déclenche, n'initie ni ne vérifie aucun transfert.
 * Toute nouvelle valeur doit aussi entrer dans les contraintes `*_method_check` (migration 0027).
 */
export const manualPaymentMethods = ["cash", "wave", "orange_money", "mtn_momo", "moov_money", "other"] as const;
export type ManualPaymentMethod = (typeof manualPaymentMethods)[number];

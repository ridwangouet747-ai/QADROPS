/*
 * Neutralisation des cellules exportées (mission 11, phase 4, constat X-1), partagée par les CSV
 * (rapports, inventaire) et le classeur XLSX. Module sans dépendance Node : il sert aussi dans le navigateur.
 *
 * Un tableur interprète comme une formule une cellule qui commence par = + - @ (ou une tabulation,
 * un retour chariot, un saut de ligne, éventuellement précédés d'espaces). Les variantes pleine chasse
 * (＝ ＋ － ＠) sont traitées de la même façon par prudence. Un nombre décimal simple (« -1250 », « 3.5 »)
 * n'est pas une formule : il doit rester un nombre, sinon un écart négatif devient du texte (X-1).
 */

const formulaStart = /^[\s\u3000]*[=+\-@\t\r\n\uFF1D\uFF0B\uFF0D\uFF20]/u;
const plainNumber = /^-?\d+(?:\.\d+)?$/;

/** Vrai pour un nombre décimal simple, sans exposant, sans espace ni séparateur de milliers. */
export function isPlainNumber(value: string) {
  return plainNumber.test(value);
}

/** Vrai si un tableur risque d'interpréter ce texte comme une formule. Un nombre simple n'en est pas une. */
export function looksLikeFormula(value: string) {
  return !isPlainNumber(value) && formulaStart.test(value);
}

/**
 * Cellule CSV entre guillemets. Un texte qui ressemble à une formule est préfixé d'une apostrophe
 * (convention des tableurs pour « texte littéral ») ; un nombre simple, même négatif, est laissé tel quel.
 */
export function csvCell(value: string | number | bigint | null | undefined) {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = looksLikeFormula(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** Fichier CSV complet : BOM UTF-8 (accents et arabe lisibles dans Excel), séparateur virgule, fins de ligne CRLF. */
export function csvDocument(rows: readonly (readonly (string | number | bigint | null | undefined)[])[]) {
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}

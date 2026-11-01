import { cellText, type Cell, type SourceRow } from "./spreadsheet";

/*
 * Qadr Adapt (mission 11, phase 3) : interprète un tableau imparfait sans rien inventer.
 * - Colonnes reconnues par un dictionnaire fr/en/ar, puis par les valeurs. Un nombre sans titre n'est jamais
 *   deviné comme prix de vente, coût ou quantité : c'est au commerçant de le dire.
 * - Montants XOF et quantités lus avec prudence : « 1,250 » est ambigu, « 12,5O0 » illisible, rien n'est corrigé.
 * - Rapprochement avec le catalogue du seul commerce concerné : certain (référence, nom exact, alias confirmé),
 *   probable ou ambigu (noms proches). Seul le « certain » est proposé par défaut ; rien n'est fusionné sans
 *   décision humaine.
 */

export const IMPORT_FIELDS = ["name", "salePrice", "cost", "quantity", "unit", "sku", "category"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type Confidence = "certain" | "probable" | "ambiguous";
export type ColumnMapping = { column: number; header: string; field: ImportField | null; confidence: Confidence | null };

/* ------------------------------------------------------------------ Normalisation */

const arabicDigits = /[٠-٩۰-۹]/g;
export function westernDigits(value: string) {
  return value.replace(arabicDigits, (digit) => String((digit.charCodeAt(0) & 0xf) % 10));
}

/** Forme de comparaison : la valeur d'origine est toujours conservée à part. */
export function normalizeText(value: string) {
  return westernDigits(value)
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    // Arabe : voyelles et tatweel retirés, alef, ya et ta marbuta unifiés.
    .replace(/[ً-ٰٟـ]/g, "").replace(/[آأإٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .toLowerCase()
    .replace(/(\d)([^\d\s.,])/g, "$1 $2").replace(/([^\d\s.,])(\d)/g, "$1 $2")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/* ------------------------------------------------------------------ Colonnes */

// Titres « certains » : sans ambiguïté sur le champ. Titres « probables » : usuels mais à confirmer (« prix » seul).
const headerDictionary: Record<ImportField, { certain: string[]; probable: string[] }> = {
  name: {
    certain: ["designation", "désignation", "nom du produit", "nom produit", "produit", "article", "libelle", "libellé", "product", "product name", "item", "item name", "اسم المنتج", "المنتج", "السلعة", "البضاعة"],
    probable: ["nom", "name", "description", "اسم", "الاسم"],
  },
  salePrice: {
    certain: ["prix de vente", "prix vente", "pv", "p v", "prix de vente unitaire", "sale price", "selling price", "سعر البيع"],
    probable: ["prix", "prix unitaire", "pu", "p u", "tarif", "price", "unit price", "سعر", "السعر", "ثمن", "الثمن"],
  },
  cost: {
    certain: ["prix d achat", "prix achat", "pa", "p a", "cout d achat", "cout achat", "prix de revient", "cost", "cost price", "purchase price", "buying price", "سعر الشراء", "التكلفه", "الكلفه"],
    probable: ["cout", "coût", "achat"],
  },
  quantity: {
    certain: ["quantite", "quantité", "qte", "qté", "quantite en stock", "stock initial", "stock de depart", "quantity", "qty", "الكميه", "الكمية"],
    probable: ["stock", "nombre", "nbre", "nb", "on hand", "العدد", "المخزون"],
  },
  unit: {
    certain: ["unite", "unité", "unite de vente", "unit", "uom", "الوحده", "الوحدة"],
    probable: ["conditionnement", "packaging", "mesure"],
  },
  sku: {
    certain: ["reference", "référence", "ref", "code article", "sku", "المرجع"],
    probable: ["code", "الرمز", "الكود"],
  },
  category: {
    certain: ["categorie", "catégorie", "famille", "category", "الفئه", "الفئة"],
    probable: ["rayon", "type", "groupe", "family", "group"],
  },
};

const dictionary = new Map<string, { field: ImportField; confidence: Confidence }>();
for (const field of IMPORT_FIELDS) {
  for (const level of ["certain", "probable"] as const) {
    for (const phrase of headerDictionary[field][level]) {
      const key = normalizeText(phrase);
      if (!dictionary.has(key)) dictionary.set(key, { field, confidence: level });
    }
  }
}

export function matchHeader(header: string) {
  const key = normalizeText(header);
  if (!key) return null;
  return dictionary.get(key) ?? null;
}

const unitWords = new Set(["piece", "pieces", "pcs", "pce", "pc", "kg", "g", "l", "litre", "litres", "m", "metre", "metres", "ml", "cm", "sac", "sacs", "carton", "cartons", "boite", "boites", "paquet", "paquets", "rouleau", "rouleaux", "barre", "barres", "tonne", "unite", "unit", "box", "pack", "bag", "dozen", "douzaine", "حبه", "كيس", "كرتون", "علبه", "كيلو"]);
const isNumberLike = (value: string) => /^[\s\d.,\u00a0\u202f٬٫-]*\d[\s\d.,\u00a0\u202f٬٫]*(?:f|fcfa|cfa|xof|frs?)?$/i.test(westernDigits(value).trim());

function columnValues(rows: SourceRow[], column: number) {
  return rows.map((row) => row.cells[column]).filter((cell): cell is Cell => cell !== undefined && cellText(cell) !== "");
}

/**
 * Ligne de titres : parmi les cinq premières lignes remplies, la première où au moins deux cellules sont des
 * titres connus, ou une seule si la ligne ne contient que du texte et que la suivante contient un nombre.
 */
export function detectHeaderRow(rows: SourceRow[]) {
  for (const [index, row] of rows.slice(0, 5).entries()) {
    const texts = row.cells.map(cellText).filter(Boolean);
    const known = texts.filter((text) => matchHeader(text)).length;
    const allText = row.cells.every((cell) => typeof cell === "string" && !isNumberLike(cell));
    const nextHasNumber = (rows[index + 1]?.cells ?? []).some((cell) => typeof cell !== "string" || isNumberLike(cell));
    if (known >= 2 || (known === 1 && allText && nextHasNumber)) return index;
  }
  return null;
}

/** Correspondance proposée pour chaque colonne. Un champ n'est attribué qu'une fois ; un doublon reste à trancher. */
export function inferMapping(rows: SourceRow[], columnCount: number): { headerIndex: number | null; mapping: ColumnMapping[] } {
  const headerIndex = detectHeaderRow(rows);
  const header = headerIndex === null ? null : rows[headerIndex]!;
  const data = rows.slice(headerIndex === null ? 0 : headerIndex + 1);
  const mapping: ColumnMapping[] = Array.from({ length: columnCount }, (_, column) => {
    const title = header ? cellText(header.cells[column]) : "";
    const known = title ? matchHeader(title) : null;
    return { column, header: title, field: known?.field ?? null, confidence: known?.confidence ?? null };
  });
  // Deux colonnes pour un même champ : on garde la plus sûre, la première à égalité, et l'autre reste à choisir.
  for (const field of IMPORT_FIELDS) {
    const same = mapping.filter((entry) => entry.field === field);
    if (same.length < 2) continue;
    const keep = same.find((entry) => entry.confidence === "certain") ?? same[0]!;
    for (const entry of same) if (entry !== keep) { entry.field = null; entry.confidence = null; }
  }
  // Colonnes sans titre reconnu : déduction par les valeurs, seulement pour du texte (jamais pour un nombre).
  const taken = new Set(mapping.map((entry) => entry.field).filter(Boolean));
  const guess = (field: ImportField, column: ColumnMapping, confidence: Confidence) => {
    if (taken.has(field) || column.field) return;
    column.field = field; column.confidence = confidence; taken.add(field);
  };
  const profiles = mapping.map((entry) => {
    const values = columnValues(data, entry.column);
    const texts = values.filter((cell) => typeof cell === "string" && !isNumberLike(cell)).map((cell) => cellText(cell));
    const units = texts.filter((text) => unitWords.has(normalizeText(text))).length;
    const codes = texts.filter((text) => /^[A-Za-z0-9][A-Za-z0-9._/-]{1,30}$/.test(text) && /\d/.test(text) && !/\s/.test(text)).length;
    const averageLength = texts.reduce((sum, text) => sum + text.length, 0) / Math.max(texts.length, 1);
    return { entry, total: values.length, texts: texts.length, units, codes, averageLength, distinct: new Set(texts.map(normalizeText)).size };
  }).filter((profile) => profile.total > 0 && !profile.entry.field);
  for (const profile of profiles) if (profile.units / profile.total >= 0.7) guess("unit", profile.entry, "probable");
  for (const profile of profiles) if (profile.codes / profile.total >= 0.7 && profile.distinct / profile.total >= 0.9) guess("sku", profile.entry, "probable");
  const textColumns = profiles.filter((profile) => !profile.entry.field && profile.texts / profile.total >= 0.7 && profile.distinct / profile.total >= 0.6)
    .sort((a, b) => b.averageLength - a.averageLength);
  // Une seule colonne de texte : c'est très probablement la désignation. Plusieurs : la plus longue, à confirmer.
  if (textColumns[0]) guess("name", textColumns[0].entry, textColumns.length === 1 ? "probable" : "ambiguous");
  return { headerIndex, mapping };
}

/* ------------------------------------------------------------------ Valeurs */

export type ParsedValue = { value: string | null; issue: "unreadable" | "ambiguous" | "negative" | null };

function stripAmount(raw: string) {
  return westernDigits(raw).replace(/٬/g, ",").replace(/٫/g, ".")
    .replace(/(f\s*cfa|fcfa|cfa|xof|francs?|frs?|f|ف\.?\s*ج|فرنك)\.?$/i, "")
    .replace(/[\s\u00a0\u202f]+/g, "").trim();
}

/** Montant XOF entier. Les décimales non nulles et les séparateurs ambigus ne sont jamais arrondis en silence. */
export function parseXof(cell: Cell | undefined): ParsedValue {
  if (cell === undefined || cellText(cell) === "") return { value: null, issue: null };
  if (typeof cell !== "string") {
    // Nombre d'un classeur : point décimal, pas de séparateur de milliers.
    if (/^\d+$/.test(cell.n)) return { value: BigInt(cell.n).toString(), issue: null };
    if (/^\d+\.0+$/.test(cell.n)) return { value: BigInt(cell.n.split(".")[0]!).toString(), issue: null };
    if (/^-/.test(cell.n)) return { value: null, issue: "negative" };
    return { value: null, issue: /^\d+\.\d+$/.test(cell.n) ? "ambiguous" : "unreadable" };
  }
  const text = stripAmount(cell);
  if (/^-/.test(text)) return { value: null, issue: "negative" };
  if (/^\d+$/.test(text)) return { value: BigInt(text).toString(), issue: null };
  // Milliers groupés par trois, avec un seul type de séparateur : 12.500 / 12,500 / 1.250.000.
  const grouped = /^(\d{1,3})((?:([.,])\d{3})(?:\3\d{3})*)$/.exec(text);
  if (grouped) return { value: BigInt(text.replace(/[.,]/g, "")).toString(), issue: null };
  // Décimales nulles : 12500,00 / 12 500.00 / 12.500,00.
  const zeroDecimals = /^(\d{1,3}(?:([.,])\d{3})*|\d+)([.,])0{1,2}$/.exec(text);
  if (zeroDecimals && zeroDecimals[2] !== zeroDecimals[3]) return { value: BigInt(zeroDecimals[1]!.replace(/[.,]/g, "")).toString(), issue: null };
  if (/^\d+[.,]\d+$/.test(text)) return { value: null, issue: "ambiguous" };
  return { value: null, issue: "unreadable" };
}

/** Quantité (jusqu'à 6 décimales). « 1,250 » peut valoir 1,25 ou 1 250 : signalé, jamais tranché. */
export function parseQuantity(cell: Cell | undefined): ParsedValue {
  if (cell === undefined || cellText(cell) === "") return { value: null, issue: null };
  if (typeof cell !== "string") {
    if (/^-/.test(cell.n)) return { value: null, issue: "negative" };
    const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(cell.n);
    return match ? { value: canonicalQuantity(match[1]!, match[2] ?? ""), issue: null } : { value: null, issue: "unreadable" };
  }
  // Une unité écrite après le nombre (« 12 sacs ») est tolérée et ignorée : l'unité a sa propre colonne.
  const text = westernDigits(cell).replace(/٫/g, ".").replace(/٬/g, " ").replace(/[\s\u00a0\u202f]*[\p{L}.]+$/u, "").trim();
  if (/^-/.test(text)) return { value: null, issue: "negative" };
  const spaced = text.replace(/(\d)[\s\u00a0\u202f]+(?=\d{3}\b)/g, "$1");
  if (/^\d+$/.test(spaced)) return { value: canonicalQuantity(spaced, ""), issue: null };
  const decimal = /^(\d+)[.,](\d{1,6})$/.exec(spaced);
  if (decimal) {
    if (decimal[2]!.length === 3 && !/[\s\u00a0\u202f]/.test(text)) return { value: null, issue: "ambiguous" };
    return { value: canonicalQuantity(decimal[1]!, decimal[2]!), issue: null };
  }
  return { value: null, issue: "unreadable" };
}

function canonicalQuantity(integer: string, fraction: string) {
  const whole = BigInt(integer).toString();
  const decimals = fraction.replace(/0+$/, "");
  return decimals ? `${whole}.${decimals}` : whole;
}

/* ------------------------------------------------------------------ Rapprochement */

export type CatalogEntry = { variantId: string; name: string; sku: string | null; aliases: string[] };
export type Candidate = { variantId: string; name: string; score: number; reason: "sku" | "name" | "alias" | "similar" };
export type MatchResult = { level: "certain" | "probable" | "ambiguous" | "none"; candidates: Candidate[] };

function bigrams(value: string) {
  const compact = ` ${value} `;
  const grams = new Map<string, number>();
  for (let i = 0; i < compact.length - 1; i += 1) { const gram = compact.slice(i, i + 2); grams.set(gram, (grams.get(gram) ?? 0) + 1); }
  return grams;
}

/** Similarité de Dice sur les bigrammes de caractères (0 à 1). */
export function similarity(a: string, b: string) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const left = bigrams(a), right = bigrams(b);
  let shared = 0, total = 0;
  for (const [gram, count] of left) { shared += Math.min(count, right.get(gram) ?? 0); total += count; }
  for (const count of right.values()) total += count;
  return (2 * shared) / total;
}

const numbersIn = (value: string) => (value.match(/\d+(?:[.,]\d+)?/g) ?? []).join("|");

export type PreparedCatalog = { entries: (CatalogEntry & { key: string; numbers: string; skuKey: string | null; aliasKeys: string[] })[] };
export function prepareCatalog(entries: CatalogEntry[]): PreparedCatalog {
  return { entries: entries.map((entry) => {
    const key = normalizeText(entry.name);
    return { ...entry, key, numbers: numbersIn(key), skuKey: entry.sku ? normalizeText(entry.sku) : null, aliasKeys: entry.aliases.map(normalizeText) };
  }) };
}

export const PROBABLE_THRESHOLD = 0.78;

/**
 * Certain : même référence, même nom normalisé ou alias confirmé par ce commerce.
 * Probable / ambigu : noms proches (Dice ≥ 0,78) ET mêmes nombres (« Ciment 50 kg » ≠ « Ciment 25 kg »).
 */
export function matchProduct(catalog: PreparedCatalog, name: string, sku: string | null): MatchResult {
  const key = normalizeText(name);
  const skuKey = sku ? normalizeText(sku) : null;
  if (skuKey) {
    const bySku = catalog.entries.filter((entry) => entry.skuKey === skuKey);
    if (bySku.length === 1) return { level: "certain", candidates: [{ variantId: bySku[0]!.variantId, name: bySku[0]!.name, score: 1, reason: "sku" }] };
  }
  if (!key) return { level: "none", candidates: [] };
  const exact = catalog.entries.filter((entry) => entry.key === key);
  if (exact.length === 1) return { level: "certain", candidates: [{ variantId: exact[0]!.variantId, name: exact[0]!.name, score: 1, reason: "name" }] };
  if (exact.length > 1) return { level: "ambiguous", candidates: exact.slice(0, 5).map((entry) => ({ variantId: entry.variantId, name: entry.name, score: 1, reason: "name" as const })) };
  const alias = catalog.entries.filter((entry) => entry.aliasKeys.includes(key));
  if (alias.length === 1) return { level: "certain", candidates: [{ variantId: alias[0]!.variantId, name: alias[0]!.name, score: 1, reason: "alias" }] };
  const numbers = numbersIn(key);
  const similar = catalog.entries
    .filter((entry) => entry.numbers === numbers)
    .map((entry) => ({ entry, score: Math.max(similarity(key, entry.key), ...entry.aliasKeys.map((aliasKey) => similarity(key, aliasKey))) }))
    .filter((item) => item.score >= PROBABLE_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ entry, score }) => ({ variantId: entry.variantId, name: entry.name, score: Math.round(score * 100) / 100, reason: "similar" as const }));
  if (!similar.length) return { level: "none", candidates: [] };
  const clear = similar.length === 1 || similar[0]!.score - similar[1]!.score >= 0.08;
  return { level: clear ? "probable" : "ambiguous", candidates: similar };
}

/* ------------------------------------------------------------------ Lignes */

export type RowEdits = Partial<Record<ImportField, string>>;
export type RowDecision = "create" | "match" | "skip";
export type RowIssue =
  | "missing_name" | "name_too_long" | "missing_price" | "price_unreadable" | "price_ambiguous" | "price_negative"
  | "cost_unreadable" | "cost_ambiguous" | "cost_negative" | "quantity_unreadable" | "quantity_ambiguous" | "quantity_negative"
  | "duplicate_in_file" | "match_needed"
  // Ligne plus large que le reste du fichier : colonnes peut-être décalées, la décision revient au commerçant.
  | "extra_cells"
  // Avertissement non bloquant : le produit rattaché a déjà du stock, la quantité ne sera pas appliquée.
  | "stock_existing";
export type RowValues = { name: string; salePriceXof: string | null; costXof: string | null; quantity: string | null; unit: string | null; sku: string | null; category: string | null };
export type RowStatus = "ready" | "needs_review" | "invalid" | "skipped" | "applied";

const BLOCKING_FOR_ALL: RowIssue[] = ["missing_name", "name_too_long", "quantity_unreadable", "quantity_ambiguous", "quantity_negative", "duplicate_in_file"];
const BLOCKING_FOR_CREATE: RowIssue[] = ["missing_price", "price_unreadable", "price_ambiguous", "price_negative", "cost_unreadable", "cost_ambiguous", "cost_negative"];

/** Valeur d'un champ : correction saisie par le commerçant, sinon la cellule de la colonne choisie. */
function fieldCell(cells: Cell[], mapping: ColumnMapping[], edits: RowEdits, field: ImportField): Cell | undefined {
  if (edits[field] !== undefined) return edits[field];
  const column = mapping.find((entry) => entry.field === field)?.column;
  return column === undefined ? undefined : cells[column];
}

export function interpretRow(cells: Cell[], mapping: ColumnMapping[], edits: RowEdits) {
  const issues: RowIssue[] = [];
  const text = (field: ImportField) => cellText(fieldCell(cells, mapping, edits, field)).replace(/\s+/g, " ").trim();
  const name = text("name");
  if (!name) issues.push("missing_name");
  if (name.length > 160) issues.push("name_too_long");
  const price = parseXof(fieldCell(cells, mapping, edits, "salePrice"));
  if (price.issue) issues.push(`price_${price.issue}` as RowIssue); else if (price.value === null) issues.push("missing_price");
  const cost = parseXof(fieldCell(cells, mapping, edits, "cost"));
  if (cost.issue) issues.push(`cost_${cost.issue}` as RowIssue);
  const quantity = parseQuantity(fieldCell(cells, mapping, edits, "quantity"));
  if (quantity.issue) issues.push(`quantity_${quantity.issue}` as RowIssue);
  const values: RowValues = {
    name: name.slice(0, 160), salePriceXof: price.value, costXof: cost.value,
    quantity: quantity.value === "0" ? null : quantity.value,
    unit: text("unit").slice(0, 32) || null, sku: text("sku").slice(0, 100) || null, category: text("category").slice(0, 80) || null,
  };
  return { values, issues };
}

/** Statut d'une ligne selon ses problèmes et la décision prise (créer, relier à un produit existant, ignorer). */
export function rowStatus(issues: RowIssue[], decision: RowDecision | null): RowStatus {
  if (decision === "skip") return "skipped";
  if (issues.some((issue) => BLOCKING_FOR_ALL.includes(issue))) return "invalid";
  if (decision === "create" && issues.some((issue) => BLOCKING_FOR_CREATE.includes(issue))) return "invalid";
  if (decision === null || issues.includes("extra_cells")) return "needs_review";
  return "ready";
}

export type RowDecisionState = { decision: RowDecision | null; decisionSource: "auto" | "user" | null; matchVariantId: string | null };

/**
 * Interprète une ligne et propose une décision. Une décision du commerçant (« user ») est toujours conservée.
 * Sans elle : rattachement automatique seulement si la correspondance est certaine ; probable ou ambigu → question
 * posée (« match_needed ») ; aucun candidat → nouveau produit.
 */
export function evaluateRow(cells: Cell[], mapping: ColumnMapping[], edits: RowEdits, catalog: PreparedCatalog, current: RowDecisionState | null) {
  const { values, issues } = interpretRow(cells, mapping, edits);
  const match = values.name ? matchProduct(catalog, values.name, values.sku) : { level: "none" as const, candidates: [] };
  let state: RowDecisionState;
  if (current?.decisionSource === "user") state = current;
  else if (match.level === "certain") state = { decision: "match", decisionSource: "auto", matchVariantId: match.candidates[0]!.variantId };
  else if (match.level === "none") state = values.name ? { decision: "create", decisionSource: "auto", matchVariantId: null } : { decision: null, decisionSource: null, matchVariantId: null };
  else state = { decision: null, decisionSource: null, matchVariantId: null };
  if (state.decision === null && (match.level === "probable" || match.level === "ambiguous")) issues.push("match_needed");
  return { values, issues, candidates: match.candidates, ...state };
}

/**
 * Lignes plus larges que le reste du fichier (et que la ligne de titres). Cas typique : un séparateur de milliers
 * non protégé dans un CSV, « Savon,1,250,3 », qui décale le prix et la quantité d'une colonne.
 */
export function widerRows(rows: { rowNumber: number; cells: Cell[] }[], headerRowNumber: number | null) {
  const width = (cells: Cell[]) => {
    let end = cells.length;
    while (end > 0 && !cellText(cells[end - 1]).trim()) end -= 1;
    return end;
  };
  const counts = new Map<number, number>();
  for (const row of rows) if (row.rowNumber !== headerRowNumber) counts.set(width(row.cells), (counts.get(width(row.cells)) ?? 0) + 1);
  let common = 0;
  let best = 0;
  for (const [size, count] of counts) if (count > best || (count === best && size > common)) [common, best] = [size, count];
  const header = rows.find((row) => row.rowNumber === headerRowNumber);
  const expected = Math.max(common, header ? width(header.cells) : 0);
  return new Set(rows.filter((row) => row.rowNumber !== headerRowNumber && width(row.cells) > expected).map((row) => row.rowNumber));
}

/**
 * Lignes en double dans le fichier : même nom normalisé, même référence ou même produit rattaché qu'une ligne
 * précédente non ignorée. Seules les suivantes sont signalées ; la première reste utilisable.
 */
export function duplicateRows(rows: { rowNumber: number; values: Pick<RowValues, "name" | "sku">; decision: RowDecision | null; matchVariantId: string | null }[]) {
  const seen = new Set<string>();
  const duplicates = new Set<number>();
  for (const row of [...rows].sort((a, b) => a.rowNumber - b.rowNumber)) {
    if (row.decision === "skip") continue;
    const keys = [normalizeText(row.values.name) && `n:${normalizeText(row.values.name)}`, row.values.sku && `s:${normalizeText(row.values.sku)}`,
      row.decision === "match" && row.matchVariantId && `v:${row.matchVariantId}`].filter((key): key is string => Boolean(key));
    if (keys.some((key) => seen.has(key))) duplicates.add(row.rowNumber);
    for (const key of keys) seen.add(key);
  }
  return duplicates;
}

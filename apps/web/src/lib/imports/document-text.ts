// Lecture des PDF scannés et des photos (Qadr Capture, critère 3.6).
// Décision D-03 : ces documents passent par un fournisseur externe, derrière cet adaptateur,
// désactivé tant que le fournisseur, le budget et la clé ne sont pas validés par le propriétaire.
// Aucune variable d'environnement n'est lue ici : une clé déclarée ne suffit pas à activer un envoi.

export type DocumentKind = "pdf" | "jpeg" | "png" | "webp" | "heic";

export type ExtractedLine = {
  page: number;
  text: string;
  /** Confiance renvoyée par le fournisseur, entre 0 et 1 ; null si elle n'est pas fournie ou pas calibrée. */
  confidence: number | null;
};

export type DocumentExtraction = { provider: string; pages: number; lines: ExtractedLine[] };

export interface DocumentTextExtractor {
  readonly provider: string;
  readonly enabled: boolean;
  /** Le commerce est transmis pour la trace et les quotas ; le fournisseur ne doit rien conserver au-delà de la requête. */
  extract(input: { businessId: string; kind: DocumentKind; bytes: Buffer }): Promise<DocumentExtraction>;
}

export class DocumentReaderUnavailableError extends Error {
  readonly code = "document_reader_disabled";
  constructor() {
    super("La lecture des PDF scannés et des photos n'est pas activée.");
  }
}

export const disabledDocumentTextExtractor: DocumentTextExtractor = {
  provider: "none",
  enabled: false,
  async extract() {
    throw new DocumentReaderUnavailableError();
  },
};

export function getDocumentTextExtractor(): DocumentTextExtractor {
  return disabledDocumentTextExtractor;
}

/** Reconnaît un PDF ou une image par ses premiers octets, jamais par l'extension. */
export function detectDocumentKind(bytes: Buffer): DocumentKind | null {
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  if (bytes.subarray(4, 8).toString("latin1") === "ftyp" && /^(heic|heix|hevc|mif1|msf1)$/.test(bytes.subarray(8, 12).toString("latin1"))) return "heic";
  return null;
}

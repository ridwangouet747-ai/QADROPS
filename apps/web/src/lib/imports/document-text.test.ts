import { describe, expect, it } from "vitest";
import { detectDocumentKind, DocumentReaderUnavailableError, getDocumentTextExtractor } from "./document-text";

describe("Capture : lecture des documents (D-03)", () => {
  it("reconnaît les PDF et les photos par leur contenu, pas par l'extension", () => {
    expect(detectDocumentKind(Buffer.from("%PDF-1.7\n"))).toBe("pdf");
    expect(detectDocumentKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]))).toBe("jpeg");
    expect(detectDocumentKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("png");
    expect(detectDocumentKind(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))).toBe("webp");
    expect(detectDocumentKind(Buffer.from("\0\0\0\x18ftypheic\0\0\0\0", "latin1"))).toBe("heic");
    expect(detectDocumentKind(Buffer.from("Nom;Prix\nCiment;5500\n"))).toBeNull();
  });

  it("reste désactivée sans fournisseur validé : aucun document n'est envoyé", async () => {
    const extractor = getDocumentTextExtractor();
    expect(extractor).toMatchObject({ provider: "none", enabled: false });
    await expect(extractor.extract({ businessId: "b", kind: "jpeg", bytes: Buffer.from([0xff, 0xd8, 0xff]) }))
      .rejects.toBeInstanceOf(DocumentReaderUnavailableError);
  });
});

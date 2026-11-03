import { inspectZip } from "@/lib/imports/spreadsheet";

/*
 * Type réel d'un fichier, déterminé par son contenu (octets magiques), jamais par son nom ni par le
 * type annoncé par le navigateur. Seuls les types de cette liste peuvent être conservés.
 */

export const STORED_FILE_TYPES = ["csv", "xlsx", "pdf", "jpeg", "png"] as const;
export type StoredFileType = (typeof STORED_FILE_TYPES)[number];

export const STORED_FILE_MIME: Record<StoredFileType, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  jpeg: "image/jpeg",
  png: "image/png",
};

export type RefusedReason = "empty" | "executable" | "macros" | "archive" | "binary";
export type FileTypeDetection = { type: StoredFileType } | { type: null; reason: RefusedReason };

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) => signature.every((byte, index) => bytes[offset + index] === byte);
const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0));

/** Exécutables et scripts reconnus quel que soit leur nom (Windows PE, ELF, Mach-O, script `#!`). */
function isExecutable(bytes: Uint8Array) {
  return startsWith(bytes, ascii("MZ")) || startsWith(bytes, [0x7f, ...ascii("ELF")]) || startsWith(bytes, ascii("#!"))
    || [[0xfe, 0xed, 0xfa, 0xce], [0xfe, 0xed, 0xfa, 0xcf], [0xce, 0xfa, 0xed, 0xfe], [0xcf, 0xfa, 0xed, 0xfe], [0xca, 0xfe, 0xba, 0xbe]]
      .some((signature) => startsWith(bytes, signature));
}

/**
 * Texte délimité (CSV) : UTF-16 avec BOM, ou octets sans NUL ni caractère de contrôle autre que
 * tabulation, saut de ligne, retour chariot et saut de page (UTF-8 et Windows-1252 acceptés).
 * Seuls les 64 premiers Kio sont examinés.
 */
function isText(bytes: Uint8Array) {
  if (startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff])) return true;
  const sample = bytes.subarray(startsWith(bytes, [0xef, 0xbb, 0xbf]) ? 3 : 0, 65_536);
  for (const byte of sample) if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && byte !== 0x0c) return false;
  return true;
}

function zipKind(bytes: Uint8Array): FileTypeDetection {
  try {
    const names = inspectZip(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)).map((entry) => entry.name);
    if (names.some((name) => /vbaProject\.bin$/i.test(name))) return { type: null, reason: "macros" };
    if (names.includes("[Content_Types].xml") && names.includes("xl/workbook.xml")) return { type: "xlsx" };
  } catch { /* archive endommagée, piégée ou trop grande : refusée comme une archive quelconque */ }
  return { type: null, reason: "archive" };
}

export function detectFileType(bytes: Uint8Array): FileTypeDetection {
  if (bytes.byteLength === 0) return { type: null, reason: "empty" };
  if (isExecutable(bytes)) return { type: null, reason: "executable" };
  if (startsWith(bytes, ascii("%PDF-"))) return { type: "pdf" };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { type: "jpeg" };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { type: "png" };
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return zipKind(bytes);
  if (isText(bytes)) return { type: "csv" };
  return { type: null, reason: "binary" };
}

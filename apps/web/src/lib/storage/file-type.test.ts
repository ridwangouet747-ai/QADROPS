import { describe, expect, it } from "vitest";
import { createZip } from "@/lib/exports/zip";
import { detectFileType } from "./file-type";

const xlsx = createZip([
  { name: "[Content_Types].xml", content: "<Types/>" },
  { name: "xl/workbook.xml", content: "<workbook/>" },
  { name: "xl/worksheets/sheet1.xml", content: "<worksheet/>" },
]);

describe("détection du type réel par le contenu", () => {
  it("reconnaît CSV (UTF-8, BOM, UTF-16, Windows-1252), XLSX, PDF, JPEG et PNG", () => {
    expect(detectFileType(Buffer.from("Désignation;Prix\nCiment;5500\n", "utf8"))).toEqual({ type: "csv" });
    expect(detectFileType(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("Nom,Prix\r\nSavon,300\r\n")]))).toEqual({ type: "csv" });
    expect(detectFileType(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("Nom;Prix\n", "utf16le")]))).toEqual({ type: "csv" });
    expect(detectFileType(Buffer.from([0x50, 0x72, 0x69, 0x78, 0x3b, 0xe9, 0x0a]))).toEqual({ type: "csv" });
    expect(detectFileType(xlsx)).toEqual({ type: "xlsx" });
    expect(detectFileType(Buffer.from("%PDF-1.7\n%âãÏÓ\n1 0 obj", "latin1"))).toEqual({ type: "pdf" });
    expect(detectFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]))).toEqual({ type: "jpeg" });
    expect(detectFileType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))).toEqual({ type: "png" });
  });

  it("refuse un exécutable renommé, quel que soit son nom (.csv, .xlsx, .pdf)", () => {
    const pe = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(58), Buffer.from("This program cannot be run in DOS mode")]);
    expect(detectFileType(pe)).toEqual({ type: null, reason: "executable" });
    expect(detectFileType(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]))).toEqual({ type: null, reason: "executable" });
    expect(detectFileType(Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x07, 0x00]))).toEqual({ type: null, reason: "executable" });
    expect(detectFileType(Buffer.from("#!/bin/sh\nrm -rf /\n"))).toEqual({ type: null, reason: "executable" });
  });

  it("refuse une archive qui n'est pas un classeur, un classeur à macros, un binaire et un fichier vide", () => {
    expect(detectFileType(createZip([{ name: "photo.jpg", content: "x" }]))).toEqual({ type: null, reason: "archive" });
    expect(detectFileType(createZip([{ name: "[Content_Types].xml", content: "<Types/>" }, { name: "xl/workbook.xml", content: "<w/>" },
      { name: "xl/vbaProject.bin", content: "macro" }]))).toEqual({ type: null, reason: "macros" });
    expect(detectFileType(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]))).toEqual({ type: null, reason: "archive" });
    expect(detectFileType(Buffer.from([0x00, 0x01, 0x02, 0x03]))).toEqual({ type: null, reason: "binary" });
    expect(detectFileType(Buffer.from("Nom;Prix\nSavon\u0000;300"))).toEqual({ type: null, reason: "binary" });
    expect(detectFileType(Buffer.alloc(0))).toEqual({ type: null, reason: "empty" });
  });
});

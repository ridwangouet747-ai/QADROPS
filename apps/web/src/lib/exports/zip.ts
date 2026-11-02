import { crc32, deflateRawSync } from "node:zlib";

/*
 * Archive ZIP minimale (méthode deflate, sans chiffrement ni ZIP64), écrite en mémoire avec `node:zlib`.
 * Sert au classeur XLSX des exports et aux tests de lecture des imports. Limites : 65 535 fichiers et
 * 4 Gio par archive, largement au-delà des bornes des exports (docs/exports.md).
 */

export type ZipEntry = {
  name: string;
  content: string | Buffer;
  /** Tests seulement : taille décompressée annoncée à tort, pour simuler une archive qui ment (bombe zip). */
  declaredSize?: number;
};

// Date DOS fixe (1er janvier 1980, 00:00) : le contenu ne dépend pas de l'heure, et la date reste valide.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

export function createZip(files: readonly ZipEntry[]) {
  if (files.length > 0xffff) throw new Error("Trop de fichiers pour une archive ZIP simple.");
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const data = typeof file.content === "string" ? Buffer.from(file.content, "utf8") : file.content;
    const compressed = deflateRawSync(data);
    const name = Buffer.from(file.name, "utf8");
    const size = file.declaredSize ?? data.length;
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(DOS_TIME, 10); local.writeUInt16LE(DOS_DATE, 12); local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(size, 22); local.writeUInt16LE(name.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x0800, 8); entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(DOS_TIME, 12); entry.writeUInt16LE(DOS_DATE, 14); entry.writeUInt32LE(checksum, 16);
    entry.writeUInt32LE(compressed.length, 20); entry.writeUInt32LE(size, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
    locals.push(local, name, compressed);
    central.push(entry, name);
    offset += local.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

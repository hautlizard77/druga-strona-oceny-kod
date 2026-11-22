import { deflateRawSync, inflateRawSync } from 'node:zlib';

const localSignature = 0x04034b50;
const centralSignature = 0x02014b50;
const endSignature = 0x06054b50;
const maxSize = 64 * 1024 * 1024;
const checksums = Uint32Array.from({ length: 256 }, (_, index) => {
  for (let bit = 0; bit < 8; bit++) index = index & 1 ? 0xedb88320 ^ (index >>> 1) : index >>> 1;
  return index >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = checksums[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function validName(name) {
  return name && !name.startsWith('/') && !/[:\\\x00-\x1f]/.test(name) && !name.split('/').some(part => part === '..' || part === '.');
}

export function encodeZip(entries) {
  if (entries.length >= 65535) throw new Error('Zbyt wiele plików w archiwum.');
  const locals = [];
  const centers = [];
  const names = new Set();
  let localLength = 0;
  let centralLength = 0;
  let size = 0;
  for (const { name, data } of entries) {
    if (typeof name !== 'string' || !validName(name) || names.has(name)) throw new Error('Nieprawidłowa nazwa pliku w archiwum.');
    const filename = Buffer.from(name);
    const original = Buffer.from(data);
    names.add(name);
    size += original.length;
    if (filename.length > 65535 || size > maxSize) throw new Error('Archiwum jest zbyt duże.');
    const compressed = deflateRawSync(original);
    const deflated = compressed.length < original.length;
    const payload = deflated ? compressed : original;
    const method = deflated ? 8 : 0;
    const checksum = crc32(original);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(localSignature);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(33, 12);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(payload.length, 18);
    header.writeUInt32LE(original.length, 22);
    header.writeUInt16LE(filename.length, 26);
    locals.push(header, filename, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(centralSignature);
    central.writeUInt16LE(20, 4);
    header.copy(central, 6, 4, 28);
    central.writeUInt32LE(localLength, 42);
    centers.push(central, filename);
    localLength += header.length + filename.length + payload.length;
    centralLength += central.length + filename.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(endSignature);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralLength, 12);
  end.writeUInt32LE(localLength, 16);
  return Buffer.concat([...locals, ...centers, end]);
}

function directoryEnd(buffer) {
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset--) {
    if (buffer.readUInt32LE(offset) === endSignature && offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length) return offset;
  }
  throw new Error('Brak katalogu ZIP.');
}

export function decodeZip(buffer) {
  const end = directoryEnd(buffer);
  const entries = new Map();
  const total = buffer.readUInt16LE(end + 10);
  const centralSize = buffer.readUInt32LE(end + 12);
  let cursor = buffer.readUInt32LE(end + 16);
  const start = cursor;
  let totalSize = 0;
  if (total === 65535 || start + centralSize !== end || buffer.readUInt32LE(end + 4) || buffer.readUInt16LE(end + 8) !== total) throw new Error('Nieobsługiwany katalog ZIP.');
  for (let index = 0; index < total; index++) {
    if (cursor + 46 > end || buffer.readUInt32LE(cursor) !== centralSignature) throw new Error('Nieprawidłowy wpis katalogu ZIP.');
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const checksum = buffer.readUInt32LE(cursor + 16);
    const length = buffer.readUInt32LE(cursor + 20);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const next = cursor + 46 + nameLength + buffer.readUInt16LE(cursor + 30) + buffer.readUInt16LE(cursor + 32);
    const local = buffer.readUInt32LE(cursor + 42);
    if ((flags & 1) || ![0, 8].includes(method) || next > end || local + 30 > start || buffer.readUInt32LE(local) !== localSignature) throw new Error('Nieobsługiwany plik w archiwum ZIP.');
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    const firstByte = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    totalSize += size;
    if (!validName(name) || entries.has(name) || firstByte + length > start || totalSize > maxSize) throw new Error('Nieprawidłowe dane w archiwum ZIP.');
    const payload = buffer.subarray(firstByte, firstByte + length);
    const original = method === 8 ? inflateRawSync(payload, { maxOutputLength: Math.max(size, 1) }) : Buffer.from(payload);
    if (original.length !== size || crc32(original) !== checksum) throw new Error('Suma kontrolna archiwum ZIP jest niezgodna.');
    entries.set(name, original);
    cursor = next;
  }
  if (cursor !== end) throw new Error('Nieprawidłowa długość katalogu ZIP.');
  return entries;
}

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { problem } from './cases.mjs';

const maxPdfBytes = 4 * 1024 * 1024;
const maxBase64Length = Math.ceil(maxPdfBytes / 3) * 4;
export const maxUploadJson = maxBase64Length + 4096;

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function readUpload(body, user) {
  const name = typeof body.name === 'string' ? body.name.normalize('NFC').trim() : '';
  if (name.length > 180 || !name.isWellFormed() || /[/\\\p{Cc}\p{Cf}]/u.test(name) || !/^.+\.pdf$/iu.test(name)) {
    throw problem(400, 'Podaj nazwę pliku zakończoną rozszerzeniem PDF.');
  }
  if (typeof body.content !== 'string' || !body.content.length) throw problem(400, 'Dodaj plik PDF.');
  if (body.content.length > maxBase64Length) throw problem(413, 'Plik PDF może mieć najwyżej 4 MiB.');
  const buffer = Buffer.from(body.content, 'base64');
  if (buffer.length > maxPdfBytes) throw problem(413, 'Plik PDF może mieć najwyżej 4 MiB.');
  const prefix = buffer.subarray(0, 8).toString('ascii');
  const tail = buffer.subarray(Math.max(buffer.length - 1024, 0)).toString('ascii');
  if (buffer.toString('base64') !== body.content || !/^%PDF-[12]\.\d$/.test(prefix) || !/%%EOF[\x00\x09\x0a\x0c\x0d\x20]*$/.test(tail)) {
    throw problem(400, 'Przekazany plik nie ma rozpoznawalnej struktury PDF.');
  }
  return {
    key: randomUUID(),
    buffer,
    metadata: { name, hash: sha256(buffer), bytes: buffer.length, uploadedAt: new Date().toISOString(), uploadedBy: user.name },
  };
}

export function signedFilePath(directory, key) {
  if (typeof key !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(key)) {
    throw new Error('Nieprawidłowy identyfikator zapisanego arkusza.');
  }
  return join(directory, `${key}.pdf`);
}

export async function writeSignedFile(directory, upload) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const filename = signedFilePath(directory, upload.key);
  const file = await open(filename, 'wx', 0o600);
  try {
    try {
      await file.writeFile(upload.buffer);
      await file.sync();
    } finally {
      await file.close();
    }
  } catch (error) {
    await unlink(filename).catch(() => {});
    throw error;
  }
}

export async function readSignedFile(directory, key, metadata) {
  const buffer = await readFile(signedFilePath(directory, key));
  if (buffer.length !== metadata.bytes || sha256(buffer) !== metadata.hash) {
    throw new Error('Zapisany podpisany arkusz nie zgadza się z sumą kontrolną.');
  }
  return buffer;
}

export function attachmentDisposition(metadata, id) {
  const filename = encodeURIComponent(metadata.name).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="ocena-${id}.pdf"; filename*=UTF-8''${filename}`;
}

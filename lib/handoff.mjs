import { randomUUID } from 'node:crypto';
import { encodeZip } from './zip.mjs';

const attachmentName = 'podpisany-arkusz-oceny.pdf';
export const docxType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function archiveHandoff(record, signedPdf, generatedAt = new Date()) {
  const manifest = {
    format: 'druga-strona-oceny/przekazanie/1',
    applicationCaseId: record.id,
    documentTitle: 'Arkusz oceny okresowej',
    form: record.formType,
    ruleVersion: record.ruleSnapshot?.version ?? null,
    generatedAt: generatedAt.toISOString(),
    document: { filename: attachmentName, mediaType: 'application/pdf', sha256: record.signedFile.hash, bytes: signedPdf.length },
    deadlineNotices:(record.events ?? []).filter(item => item.noticeReference && item.noticeDate)
      .map(item => ({reference:item.noticeReference,date:item.noticeDate,dueDate:item.newDueDate || null})),
  };
  return encodeZip([
    { name: attachmentName, data: signedPdf },
    { name: 'manifest.json', data: `${JSON.stringify(manifest, null, 2)}\n` },
    { name: 'SHA256SUMS.txt', data: `${manifest.document.sha256}  ${attachmentName}\n` },
  ]);
}

function base64Lines(value) {
  return Buffer.from(value).toString('base64').match(/.{1,76}/g)?.join('\r\n') ?? '';
}

export function mailDraft(signedPdf) {
  const boundary = `dso-${randomUUID()}`;
  const message = 'Dzień dobry,\r\n\r\nprzekazuję podpisany arkusz oceny okresowej do włączenia do właściwej dokumentacji pracowniczej. Proszę o potwierdzenie przyjęcia dokumentu.\r\n\r\nZ poważaniem\r\n';
  return Buffer.from([
    'X-Unsent: 1',
    'Subject: Arkusz oceny okresowej do akt',
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(message),
    `--${boundary}`,
    `Content-Type: application/pdf; name="${attachmentName}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${attachmentName}"`,
    '',
    base64Lines(signedPdf),
    `--${boundary}--`,
    '',
  ].join('\r\n'));
}

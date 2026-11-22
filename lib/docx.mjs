import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { evaluateRules, formsFor, openingSection, SCORE_OPTIONS } from '../public/domain.mjs';
import { decodeZip, encodeZip } from './zip.mjs';

const documentPart = 'word/document.xml';
const templatePacks = {
  '2016.470': {
    directory:'../assets/formularze/',
    hashes:{
      A:'aec1922ee2717f578ca4ca2ce8c1c96ffab83719ac67185c183ab7721e684e17',
      B:'47c2b62b81c49c62f03218dc7a1b5bacc0e21ab7d0c9c1437f56f4e52e1245c3',
      C:'4845015f886a56c8715006a5b803e77c6d628eab9aa4989763214c170ba662f0',
    },
  },
};
const tablesPattern = /<w:tbl(?=[\s>])[\s\S]*?<\/w:tbl>/g;
const rowsPattern = /<w:tr(?=[\s>])[\s\S]*?<\/w:tr>/g;
const cellsPattern = /<w:tc(?=[\s>])[\s\S]*?<\/w:tc>/g;
const textPattern = /(<w:t(?=[\s>])[^>]*>)([\s\S]*?)(<\/w:t>)/g;

// The published A/B/C templates each have these seventeen unnested tables.
// Individual row indexes differ only with the six mandatory criteria in A.
const table = Object.freeze({
  office: 0, employee: 1, openingManager: 2, openingCriteria: 3,
  openingAttestations: 4, reviewDates: 5, scores: 6, result: 7,
  justification: 8, development: 9, previousReview: 10, degreeSelection: 11,
  finalManager: 12, finalEmployee: 13, appeal: 14, degreeEmployee: 15, degreeRequest: 16,
});

const scoreColumns = new Map(SCORE_OPTIONS.map(({ value }, index) => [value, index + 1]));
const warsawDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' });
const averageFormat = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 4 });

function xmlText(value) {
  return String(value ?? '')
    .replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character]));
}

function dateText(value) {
  const short = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(String(value ?? ''));
  if (short) return `${short[3]}.${short[2]}.${short[1]}`;
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(+date) ? '' : dateText(warsawDate.format(date));
}

function attestationDate(attestation) {
  return dateText(attestation?.date || attestation?.at || attestation?.signedAt);
}

function splitName(full) {
  const [first = '', ...last] = String(full ?? '').trim().split(/\s+/);
  return { first, last: last.join(' ') };
}

function party(fields, prefix, full) {
  const fallback = splitName(full);
  const first = fields[`${prefix}FirstName`] || fallback.first;
  const last = fields[`${prefix}LastName`] || fallback.last;
  return { first, last, name: [first, last].filter(Boolean).join(' '), unit: fields[`${prefix}Unit`] };
}

function replaceCellText(cell, value) {
  const lines = String(value).split(/\r\n|[\r\n]/);
  let used = 0;
  // Reuse the form's empty paragraphs for multiline text. Extend the last
  // written run with real line breaks only when the supplied text is longer.
  const slots = Math.max(1, [...cell.matchAll(/<w:p(?=[\s>])/g)].length);
  return cell.replace(/<w:p(?=[\s>])[^>]*>[\s\S]*?<\/w:p>/g, paragraph => {
    if (used >= lines.length) return paragraph;
    const remaining = used === slots - 1 ? lines.slice(used) : [lines[used]];
    used += remaining.length;
    if (!remaining.some(Boolean)) return paragraph;
    const content = remaining.map(line => `<w:t xml:space="preserve">${xmlText(line)}</w:t>`).join('<w:br/>');
    let changed = false;
    const updated = paragraph.replace(textPattern, () => {
      if (changed) return '';
      changed = true;
      return content;
    });
    const paragraphStyle = paragraph.match(/<w:pPr(?=[\s>])[\s\S]*?<\/w:pPr>/)?.[0] ?? '';
    const runStyle = paragraphStyle.match(/<w:rPr(?=[\s>])[\s\S]*?<\/w:rPr>/)?.[0] ?? '';
    return changed ? updated : paragraph.replace('</w:p>', `<w:r>${runStyle}${content}</w:r></w:p>`);
  });
}

function editTables(xml, edits, attachDegree) {
  const template = [...xml.matchAll(tablesPattern)];
  if (template.length !== Object.keys(table).length) throw new Error('Zmieniono układ urzędowego wzoru DOCX.');
  const appeal = template[table.appeal];
  const appealEnd = appeal.index + appeal[0].length;
  const section = xml.indexOf('<w:sectPr', appealEnd);
  if (section < 0) throw new Error('Brakuje sekcji końcowej urzędowego wzoru DOCX.');
  const document = attachDegree ? xml : xml.slice(0, appealEnd) + xml.slice(section);
  let index = 0;
  return document.replace(tablesPattern, markup => {
    const rows = edits.get(index++);
    if (!rows) return markup;
    let row = 0;
    const updated = markup.replace(rowsPattern, original => {
      const cells = rows.get(row++);
      if (!cells) return original;
      let cell = 0;
      const updatedRow = original.replace(cellsPattern, originalCell => {
        const edit = cells.get(cell++);
        if (edit === undefined) return originalCell;
        return typeof edit === 'function' ? edit(originalCell) : replaceCellText(originalCell, edit);
      });
      if ([...cells.keys()].some(key => key >= cell)) throw new Error('Zmieniono układ komórek urzędowego wzoru DOCX.');
      return updatedRow;
    });
    if ([...rows.keys()].some(key => key >= row)) throw new Error('Zmieniono układ wierszy urzędowego wzoru DOCX.');
    return updated;
  });
}

function buildEdits(record, rules) {
  const form = formsFor(record)[rules.formType];
  const details = record.formDetails ?? {};
  const section = openingSection(record);
  const opening = section?.startMeeting ?? {};
  const openingDetails = section?.formDetails ?? {};
  const review = record.reviewMeeting ?? {};
  const final = record.signatures ?? {};
  const outcome = record.outcome ?? {};
  const historicManager = section?.openingManagerSnapshot ?? openingDetails;
  const employee = party(details, 'employee', record.employeeName);
  const openingManager = party(historicManager, 'manager', historicManager.managerName || record.managerName);
  const finalManager = party(details, 'manager', record.managerName);
  const edits = new Map();
  const set = (tableIndex, row, col, value) => {
    if (value == null || value === '') return;
    if (!edits.has(tableIndex)) edits.set(tableIndex, new Map());
    const rows = edits.get(tableIndex);
    if (!rows.has(row)) rows.set(row, new Map());
    rows.get(row).set(col, value);
  };
  const identity = (index, person, position) => {
    set(index, 0, 1, person.first);
    set(index, 1, 1, person.last);
    if (form.id !== 'A') set(index, 2, 1, person.unit);
    set(index, form.id === 'A' ? 2 : 3, 1, position);
  };
  const attestation = (index, row, place, date, name) => {
    set(index, row, 0, place);
    set(index, row, 1, date);
    set(index, row, 2, name);
  };

  if (section) {
    set(table.office, 0, 1, section.office);
    identity(table.employee, party(openingDetails,'employee',section.employeeName), section.position);
    identity(table.openingManager, openingManager, historicManager.managerPosition);
  }
  identity(table.finalManager, finalManager, details.managerPosition);
  set(table.openingCriteria, 4, 2, dateText(section?.dueDate));
  attestation(table.openingAttestations, 1, openingDetails.openingManagerPlace || opening.location, attestationDate(opening.signedManager));
  attestation(table.openingAttestations, 4, openingDetails.openingEmployeePlace || opening.location, attestationDate(opening.signedEmployee));
  set(table.reviewDates, 0, 1, dateText(review.date));
  set(table.reviewDates, 1, 2, dateText(record.startDate));
  set(table.reviewDates, 1, 4, dateText(details.periodEnd || review.date));
  attestation(table.finalManager, form.id === 'A' ? 3 : 4, details.finalManagerPlace || review.location, dateText(details.assessmentDate) || attestationDate(final.manager));
  attestation(table.finalEmployee, 1, details.finalEmployeePlace || review.location, attestationDate(final.employee), employee.name);

  const criteria = record.criteria ?? [];
  const additional = criteria.filter(item => !item.required && form.optionalCriteria.includes(item.name)).slice(0, 3);
  const mark = (row, criterion) => {
    const col = scoreColumns.get(Number(criterion?.score));
    if (col) set(table.scores, row, col, 'X');
  };
  form.requiredCriteria.forEach((name, index) => mark(3 + index, criteria.find(item => item.required && item.name === name)));
  const openingAdditional = section?.criteria.filter(item => !item.required) ?? [];
  openingAdditional.slice(0,3).forEach((item,index) => set(table.openingCriteria,1+index,1,item.name));
  const additionalStart = 4 + form.requiredCriteria.length;
  additional.forEach((item, index) => {
    set(table.scores, additionalStart + index, 0, item.name);
    mark(additionalStart + index, item);
  });
  if (rules.score != null) {
    set(table.scores, additionalStart + 3, 1, averageFormat.format(rules.score));
    const band = SCORE_OPTIONS.findIndex(option => rules.score <= option.value + 1);
    if (band >= 0) set(table.result, band + 1, 0, 'X');
    set(table.result, 6, rules.outcome === 'pozytywna' ? 2 : 4, 'X');
  }
  const detailedReasons = criteria.filter(item => item.justification?.trim()).map(item => `${item.name}: ${item.justification}`);
  set(table.justification, 0, 0, [outcome.summary, ...detailedReasons].filter(Boolean).join('\n'));
  set(table.development, 0, 0, outcome.development);
  set(table.previousReview, 0, 1, details.previousAssessmentResult);
  set(table.previousReview, 0, 3, details.previousAssessmentLevel);
  set(table.previousReview, 0, 5, dateText(details.previousAssessmentDate));
  const degreeColumn = { yes: 1, no: 3, 'not-applicable': 5 }[details.serviceDegreeAttachment];
  if (degreeColumn) set(table.degreeSelection, 0, degreeColumn, 'X');
  if (form.id === 'A' && details.appealAuthority) {
    set(table.appeal, 1, 0, cell => cell.replace(/…{8,}/, () => ` ${xmlText(details.appealAuthority)}`));
  }

  if (details.serviceDegreeAttachment === 'yes') {
    [employee.first, employee.last, details.appointmentYear, details.currentDegree, dateText(details.currentDegreeDate)].forEach((value, row) => set(table.degreeEmployee, row, 1, value));
    set(table.degreeRequest, 1, 0, cell => {
      let filledName = false;
      return cell.replace(textPattern, (element, open, value, close) => {
        if (/^…{8,}$/.test(value) && employee.name) {
          if (filledName) return `${open}${close}`;
          filledName = true;
          return `<w:t xml:space="preserve"> ${xmlText(employee.name)} ${close}`;
        }
        if (value.includes('wnioskuję o przyznanie') && details.requestedDegree) {
          return `${open}${value.replace(/[…\.]{3,}/, () => xmlText(details.requestedDegree))}${close}`;
        }
        return element;
      });
    });
    set(table.degreeRequest, 3, 0, outcome.serviceDegree);
    attestation(table.degreeRequest, 4, details.degreePlace || review.location, dateText(details.degreeDate), finalManager.name);
  }
  return edits;
}

export async function buildOfficialDocx(record) {
  const rules = evaluateRules(record);
  if (!rules.formType) throw new TypeError('Wybierz urzędowy arkusz A, B lub C.');
  const templateVersion = record.ruleSnapshot?.templateVersion ?? '2016.470';
  if (!Object.hasOwn(templatePacks,templateVersion)) throw new Error('Brak pakietu wzorów przypisanego do sprawy.');
  const pack = templatePacks[templateVersion];
  const template = await readFile(new URL(`${pack.directory}arkusz-${rules.formType}.docx`, import.meta.url));
  if (createHash('sha256').update(template).digest('hex') !== pack.hashes[rules.formType]) {
    throw new Error('Wzór arkusza różni się od przypisanej wersji.');
  }
  const files = decodeZip(template);
  const body = files.get(documentPart);
  if (!body) throw new Error('Brakuje głównej części dokumentu w urzędowym wzorze DOCX.');
  const filled = editTables(body.toString('utf8'), buildEdits(record, rules), record.formDetails?.serviceDegreeAttachment === 'yes');
  files.set(documentPart, Buffer.from(filled));
  return encodeZip([...files].map(([name, data]) => ({ name, data })));
}

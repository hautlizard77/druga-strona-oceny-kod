import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildOfficialDocx } from '../lib/docx.mjs';
import { decodeZip } from '../lib/zip.mjs';
import { FORM_META, newCase } from '../public/domain.mjs';

const part = 'word/document.xml';

function sample(formType, degree = false) {
  const record = newCase({
    positionType: formType, startDate: '2024-10-29', office: 'Urząd Łąki & Rzeki',
    employeeName: 'Łucja Żbik', managerName: 'Joanna Dąb', position: 'Starsza specjalistka',
  });
  record.formDetails = { ...record.formDetails, employeeUnit: 'Wydział Zgłoszeń', managerUnit: 'Wydział Spraw', managerPosition: 'Naczelniczka', previousAssessmentResult: 'pozytywna',
    previousAssessmentDate: '2024-10-28', previousAssessmentLevel: 'powyżej oczekiwań', openingManagerPlace: 'Żory', finalEmployeePlace: 'Płock',
    appealAuthority: 'Dyrektor komórki A & B', serviceDegreeAttachment: degree ? 'yes' : 'not-applicable', ...(degree ? {
      appointmentYear: 2019, currentDegree: 'II', currentDegreeDate: '2022-03-14', requestedDegree: 'III', degreeDate: '2026-10-28',
    } : {}),
  };
  record.openingManagerSnapshot = { managerName: 'Markus Stary', managerPosition: 'Poprzedni kierownik', managerUnit: 'Poprzedni wydział' };
  record.startMeeting.signedManager = { date: '2024-11-01' };
  record.startMeeting.signedEmployee = { at: '2024-11-01T23:59:00Z' };
  record.reviewMeeting.date = '2026-10-27';
  record.signatures.manager = { date: '2026-10-28' };
  record.signatures.employee = { date: '2026-10-29' };
  record.outcome = { summary: 'Sprawy < pilne > po zmianie.\nWniosek „obserwacja” przedstawiono.', development: 'Omówienie obciążeń każdego tygodnia.', serviceDegree: degree ? 'Uzasadnienie wniosku o stopień.' : '' };
  for (const criterion of record.criteria) criterion.score = 7;
  record.criteria[0].justification = 'Szczegółowy argument dla kryterium.';
  record.criteria.push({ name: FORM_META[formType].optionalCriteria[0], required: false, score: 3 });
  record.openingSnapshot = structuredClone(record);
  return record;
}

async function packageFor(record) {
  return decodeZip(await buildOfficialDocx(record));
}

const tables = xml => [...xml.matchAll(/<w:tbl(?=[\s>])[\s\S]*?<\/w:tbl>/g)].map(([markup]) => markup);
const rows = markup => [...markup.matchAll(/<w:tr(?=[\s>])[\s\S]*?<\/w:tr>/g)].map(([markup]) => markup);
const cells = markup => [...markup.matchAll(/<w:tc(?=[\s>])[\s\S]*?<\/w:tc>/g)].map(([markup]) => markup);

for (const type of ['A', 'B', 'C']) {
  test(`wypełnia urzędowy arkusz ${type} w jego układzie bez zmiany pozostałych części pakietu`, async () => {
    const record = sample(type);
    const reference = decodeZip(await readFile(new URL(`../assets/formularze/arkusz-${type}.docx`, import.meta.url)));
    const filled = await packageFor(record);
    assert.deepEqual([...filled.keys()], [...reference.keys()]);
    for (const [name, bytes] of reference) {
      if (name !== part) assert.deepEqual(filled.get(name), bytes, name);
    }
    const xml = filled.get(part).toString('utf8');
    assert.match(xml, /Urząd Łąki &amp; Rzeki/);
    assert.match(xml, /Sprawy &lt; pilne &gt; po zmianie/);
    assert.match(xml, /Szczegółowy argument dla kryterium/);
    assert.match(xml, /Omówienie obciążeń każdego tygodnia/);
    assert.doesNotMatch(xml, /CZĘŚĆ III/);
    const renderedTables = tables(xml);
    assert.equal(renderedTables.length, 15);
    const [, , openingManager, openingCriteria, opening, dates, scores, results, , , , degree, manager, employee, appeal] = renderedTables;
    assert.match(openingManager, /Markus|Stary/);
    assert.match(manager, /Joanna|Dąb/);
    assert.match(openingCriteria, new RegExp(FORM_META[type].optionalCriteria[0]));
    assert.match(opening, /02\.11\.2024/);
    assert.match(cells(rows(opening)[1])[2], /…/);
    assert.match(dates, /27\.10\.2026/);
    assert.match(cells(rows(scores)[3])[4], />X<\/w:t>/);
    const additionalRow = 4 + FORM_META[type].requiredCriteria.length;
    assert.match(cells(rows(scores)[additionalRow])[2], />X<\/w:t>/);
    assert.match(cells(rows(results)[6])[2], />X<\/w:t>/);
    assert.match(cells(rows(degree)[0])[5], />X<\/w:t>/);
    assert.match(employee, /Łucja Żbik/);
    assert.match(cells(rows(employee)[1])[3], /…/);
    if (type === 'A') assert.match(appeal, /Dyrektor komórki A &amp; B/);
  });
}

test('wypełnia załącznik o przyznanie stopnia, gdy został wybrany', async () => {
  const xml = (await packageFor(sample('B', true))).get(part).toString('utf8');
  assert.match(xml, /CZĘŚĆ III/);
  const renderedTables = tables(xml);
  assert.equal(renderedTables.length, 17);
  assert.match(cells(rows(renderedTables[11])[0])[1], />X<\/w:t>/);
  assert.match(renderedTables[15], /2019/);
  assert.match(renderedTables[15], /14\.03\.2022/);
  assert.match(renderedTables[16], /Łucja Żbik/);
  assert.match(renderedTables[16], /III stopnia służbowego/);
  assert.match(renderedTables[16], /Uzasadnienie wniosku o stopień/);
  assert.match(cells(rows(renderedTables[16])[4])[3], /…/);
});

test('pozostawia pola wyników puste przed wpisaniem wszystkich ocen', async () => {
  const record = sample('C');
  record.criteria[0].score = null;
  const xml = (await packageFor(record)).get(part).toString('utf8');
  const [, , , , , , scores, results] = tables(xml);
  assert.doesNotMatch(cells(rows(scores)[rows(scores).length - 1])[1], />\d/);
  assert.doesNotMatch(results, />X<\/w:t>/);
});

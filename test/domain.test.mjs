import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FORM_META,
  addMonths,
  analyzeEvidence,
  buildAction,
  evaluateRules,
  formFor,
  makeDemoState,
  newCase,
  workingDeadline,
} from '../public/domain.mjs';

test('archiwalne powiązanie ze stycznia 2023 nie pokrywa luki w ocenie rozpoczętej w listopadzie 2024', () => {
  const [record] = makeDemoState().cases;
  const criterion = record.criteria[0];
  const prior = {id:'historical',date:'2023-01-15',criterion:criterion.name,text:'Kontekst historyczny',shared:true};
  record.evidence = [prior];
  record.contexts = [{evidenceId:prior.id,text:'Kontekst odpowiedzi'}];
  criterion.evidenceIds = [prior.id];
  criterion.justification = 'Istniejąca treść bez źródła z okresu.';
  const analysis = analyzeEvidence(record);
  const item = analysis.items.find(item => item.name === criterion.name);
  assert.equal(item.gap,true);
  assert.equal(item.evidence.length,0);
  assert.equal(item.contexts.length,0);
  assert.deepEqual(analysis.historical,[prior]);
  assert.ok(analysis.notices.some(notice => notice.code === 'unlinked-reason' && notice.criterion === criterion.name));
});

test('dobiera katalog kryteriów obowiązkowych i rozłącznych dodatkowych dla każdego arkusza', () => {
  assert.equal(FORM_META.A.requiredCriteria.length, 6);
  assert.equal(FORM_META.B.requiredCriteria.length, 5);
  assert.equal(FORM_META.C.requiredCriteria.length, 5);
  assert.ok(FORM_META.A.requiredCriteria.includes('Zarządzanie strategiczne'));
  assert.ok(FORM_META.C.requiredCriteria.includes('Rzetelność'));
  assert.ok(FORM_META.B.fields.some(({ key }) => key === 'employeeUnit'));
  assert.ok(!FORM_META.A.fields.some(({ key }) => key === 'employeeUnit'));
  for (const [type, { requiredCriteria, optionalCriteria }] of Object.entries(FORM_META)) {
    assert.deepEqual(newCase({ positionType: type }).criteria.map(({ name }) => name), requiredCriteria);
    assert.equal(new Set([...requiredCriteria, ...optionalCriteria]).size, 14);
  }
  assert.equal(formFor('invalid'), null);
});

test('blokuje czwarte kryterium dodatkowe przed rozpoczęciem okresu', () => {
  const record = makeDemoState().cases[0];
  for (const name of FORM_META.C.optionalCriteria.slice(0, 4)) {
    record.criteria.push({ name, required: false, score: null });
  }
  const issue = evaluateRules(record).issues.find(item => item.code === 'additional-limit');
  assert.equal(issue.stage, 'start');
});

test('wylicza wynik z ocen człowieka i wymaga uzasadnienia wyniku negatywnego', () => {
  const record = makeDemoState().cases[0];
  assert.equal(evaluateRules(record).outcome, null);
  for (const criterion of record.criteria) criterion.score = 7;
  assert.equal(evaluateRules(record).outcome, 'pozytywna');
  assert.equal(evaluateRules(record).level, 'Powyżej oczekiwań');

  record.criteria[0].score = 1;
  const result = evaluateRules(record);
  assert.equal(result.score, 5.8);
  assert.equal(result.level, 'Na poziomie oczekiwań');
  assert.equal(result.outcome, 'negatywna');
  assert.ok(result.issues.some(issue => issue.code === 'negative-reason'));
});

test('wyznacza terminy kalendarzowo, przesuwa soboty i święta', () => {
  assert.equal(addMonths('2024-02-29', 12), '2025-02-28');
  assert.equal(workingDeadline('2026-11-21'), '2026-11-23');
  assert.equal(workingDeadline('2026-04-06'), '2026-04-07');
  assert.equal(workingDeadline('2026-06-04'), '2026-06-05');
  assert.equal(workingDeadline('2026-12-24'), '2026-12-28');
  assert.equal(workingDeadline('2026-02-31'), '');
});

test('przedłuża termin za dłuższą usprawiedliwioną nieobecność, zachowuje kryteria przy zmianie kierownika', () => {
  const record = newCase({ startDate: '2024-09-23' });
  record.events = [
    { type: 'absence', date: '2026-02-01', endDate: '2026-03-15' },
    { type: 'manager-change', date: '2026-05-05' },
  ];
  const result = evaluateRules(record);
  assert.equal(result.dueDate, '2026-11-05');
  assert.ok(result.notices.some(item => item.code === 'absence-extension'));
  assert.ok(result.notices.some(item => item.code === 'manager-continuity'));
  assert.deepEqual(result.criteria, record.criteria);
});

test('oddziela ciągłość sześciomiesięcznej ponownej oceny od przedłużenia nieobecności', () => {
  const record = newCase({ startDate: '2025-02-03' });
  record.formDetails.previousAssessmentDate = '2025-02-03';
  record.formDetails.previousAssessmentResult = 'negatywna';
  record.formDetails.previousAcknowledgmentDate = '2025-02-04';
  record.events = [{ type: 'absence', date: '2025-04-01', endDate: '2025-05-16' }];
  assert.equal(evaluateRules(record).dueDate, '2025-08-05');
});

test('pokazuje starszy przykład i kontekst pracownika oraz różne warianty próby', () => {
  const record = makeDemoState().cases[0];
  record.contexts.push({ id: 'context', evidenceId: 'ev-1', text: 'W tym tygodniu dostałam nową kolejkę spraw.' });
  const analysis = analyzeEvidence(record);
  const recent = analysis.items.find(item => item.recentOnly);
  assert.equal(recent.evidence.length, 3);
  assert.equal(recent.counterexamples[0].id, 'ev-4');
  assert.equal(recent.contexts[0].id, 'context');

  const priorities = buildAction('priorities', record);
  const workload = buildAction('workload', record);
  assert.notEqual(priorities.owner, workload.owner);
  assert.notEqual(priorities.metric, workload.metric);
  assert.equal(priorities.reviewDate, '2026-12-21');
  assert.equal(buildAction('invalid', record), null);
});

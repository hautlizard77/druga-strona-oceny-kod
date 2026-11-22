import assert from 'node:assert/strict';
import test from 'node:test';
import { changeRecord, forViewer, officeDate } from '../lib/cases.mjs';
import { addDays, makeDemoState } from '../public/domain.mjs';
import { baselineWindow, compareTrial } from '../public/trials.mjs';

function reviewCase() {
  const { cases, users } = makeDemoState();
  return { record: { ...cases[0], stage: 'review', version: 1 }, manager: users[0], employee: users[1], hr: users[2] };
}

test('trial comparison notices lower counts with higher rates and does not invent missing rates', () => {
  assert.deepEqual(compareTrial({ baseline: 8, baselineTotal: 20, followUp: 4, followUpTotal: 8, targetRate: 30 }), {
    beforeRate: 40,
    afterRate: 50,
    deltaPoints: 10,
    smallSample: true,
    countDroppedButRateRose: true,
    targetReached: false,
  });
  assert.deepEqual(compareTrial({ baseline: 8, followUp: 4 }), {
    beforeRate: null, afterRate: null, deltaPoints: null, smallSample: false, countDroppedButRateRose: false, targetReached: null,
  });
  const clear = compareTrial({ baseline: 10, baselineTotal: 50, followUp: 0, followUpTotal: 40, targetRate: 10 });
  assert.equal(clear.afterRate, 0);
  assert.equal(clear.targetReached, true);
});

test('trial setup validates denominators, goal and dates and completion preserves the chosen baseline', () => {
  const { record, manager } = reviewCase();
  const startDate = addDays(officeDate(), -35);
  const standard = { optionId: 'workload', startDate, baseline: 8, baselineTotal: 20, targetRate: 30 };
  assert.throws(() => changeRecord(record, { action: { ...standard, baselineTotal: 5 } }, manager), { status: 400 });
  assert.throws(() => changeRecord(record, { action: { ...standard, targetRate: 101 } }, manager), { status: 400 });
  assert.throws(() => changeRecord(record, { action: { ...standard, baselineTo: startDate } }, manager), { status: 400 });
  const started = changeRecord(record, { action: standard }, manager);
  assert.equal(started.action.obstacle, 'workload');
  const expected = baselineWindow(startDate);
  assert.equal(started.action.baselineFrom, expected.baselineFrom);
  assert.equal(started.action.baselineTo, expected.baselineTo);
  const results = { optionId: 'workload', status: 'completed', followUp: 4, followUpTotal: 8, note: 'Mniej spraw w okresie zmiany.', decision: 'Zmienić' };
  assert.throws(() => changeRecord(started, { action: { ...results, baseline: 4 } }, manager), { status: 409 });
  assert.throws(() => changeRecord(started, { action: { ...results, followUpTotal: null } }, manager), { status: 400 });
  const completed = changeRecord(started, { action: results }, manager);
  assert.equal(compareTrial(completed.action).deltaPoints, 10);
  assert.match(completed.action.completedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.throws(() => changeRecord(completed, { action: { ...results, followUp: 1 } }, manager), { status: 409 });
  assert.throws(() => changeRecord(completed, { action: null }, manager), { status: 409 });
});

test('changing the action archives its result, keeps metric and obstacle, and limits personal history to parties', () => {
  const { record, manager, employee, hr } = reviewCase();
  const started = changeRecord(record, { action: { optionId: 'priorities', startDate: addDays(officeDate(), -35), baseline: 8, baselineTotal: 20 } }, manager);
  const completed = changeRecord(started, { action: { optionId: 'priorities', status: 'completed', followUp: 4, followUpTotal: 8, decision: 'Zmienić' } }, manager);
  const signed = { ...completed, signatures: { ...completed.signatures, manager: { by: manager.id } }, stage: 'complete', dueDate: '2026-11-28' };
  const commented = changeRecord(signed, { action: { employeeComment: 'Nowy dyżur pokrywał się ze szkoleniem.' } }, employee);
  const input = {
    repeat: true, optionId: 'custom', label: 'Rotacyjna odpowiedzialność', description: 'Zmienić grafik dyżurów po rozmowie z zespołem.',
    owner: 'Koordynator dyżurów', development: 'Ustalać i komunikować zmianę dyżuru.', startDate: commented.action.reviewDate,
    baseline: 4, baselineTotal: 8, obstacle: 'skills', metric: 'Nieprawidłowa zmiana miernika',
  };
  assert.throws(() => changeRecord(commented, { action: { ...input, startDate: addDays(input.startDate, -1) } }, manager), { status: 400 });
  assert.equal(forViewer(commented, employee).action.employeeComment, 'Nowy dyżur pokrywał się ze szkoleniem.');
  const next = changeRecord(commented, { action: input }, manager);
  assert.deepEqual(next.actionHistory, [commented.action]);
  assert.notEqual(next.action.id, next.actionHistory[0].id);
  assert.equal(next.action.obstacle, 'priorities');
  assert.equal(next.action.metric, started.action.metric);
  assert.equal(next.action.employeeComment, '');
  assert.equal(next.action.followUp, null);
  assert.deepEqual(next.outcome, commented.outcome);
  assert.equal(next.dueDate, signed.dueDate);
  assert.deepEqual(next.criteria, signed.criteria);
  assert.equal(forViewer(next, hr).actionHistory, undefined);
  assert.equal(forViewer({ ...next, signatures: {} }, employee).actionHistory, undefined);
  assert.deepEqual(forViewer(next, employee).actionHistory, [commented.action]);
});

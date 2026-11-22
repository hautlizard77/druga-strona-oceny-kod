import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDemoTrialInsights, buildTrialInsights } from '../lib/trial-insights.mjs';
import { trialInsightsView } from '../public/trial-insights-view.mjs';
import { buildAction } from '../public/domain.mjs';

const completed = (overrides = {}) => ({
  metricDefinition:buildAction('priorities',{}).metricDefinition,
  optionId: 'priorities', status: 'completed', baseline: 8, baselineTotal: 20, followUp: 4, followUpTotal: 8,
  baselineFrom: '2026-09-01', baselineTo: '2026-09-30', startDate: '2026-10-01', reviewDate: '2026-10-31',
  ...overrides,
});
const describedRecord = (employeeId, action, actionHistory = []) => ({employeeId, employeeName: 'Nazwisko do pominięcia', action, actionHistory});

test('small categories stay hidden even with repeated cases and a lower requested threshold', () => {
  const records = [1,2,3,4].map(index => describedRecord(`staff-${index}`, completed(), [completed(), completed()]));
  records.push(describedRecord('staff-4', completed()));
  assert.deepEqual(buildTrialInsights(records, {minimumCases:2}), {minimumCases:5, groups:[], suppressed:true});
});

test('displays the median per-person rate change, not raw counts or individual records', () => {
  const records = Array.from({length:5}, (_, index) => describedRecord(`staff-${index}`, completed({note:'Prywatna notatka'})));
  records.push(describedRecord('unique-small', completed({obstacle:'handoff'})));
  const insights = buildTrialInsights(records);
  assert.equal(insights.groups.length,1);
  assert.deepEqual(insights.groups[0], {
    key:insights.groups[0].key, label: insights.groups[0].label, metricLabel:'Liczba spraw przesuniętych bez uzgodnienia', caseRange:'5–9', medianDeltaPoints:10, direction:'increased',
  });
  const payload = JSON.stringify(insights);
  assert.doesNotMatch(payload, /unique-small|handoff|staff-|Nazwisko|Prywatna|baseline|followUp/i);
});

test('five separate definitions in one obstacle do not publish a median', () => {
  const records = Array.from({length:5},(_, index) => describedRecord(`staff-${index}`,completed({
    metric:'Sprawy po terminie',metricDefinition:{event:'Sprawa po terminie',population:index < 3 ? 'Sprawy przydzielone' : 'Sprawy zamknięte',source:'Rejestr pracy'},
  })));
  assert.deepEqual(buildTrialInsights(records),{minimumCases:5,groups:[],suppressed:true});
  assert.deepEqual(buildTrialInsights(records.map(item => ({...item,action:{...item.action,metricDefinition:undefined}}))).groups,[]);
});

test('takes the latest comparable completion, skips incomplete and legacy counts, and keeps old results during a new trial', () => {
  const better = completed({baseline:10, baselineTotal:20, followUp:5, followUpTotal:20});
  const newerWorse = completed({baseline:5, baselineTotal:20, followUp:9, followUpTotal:20, reviewDate:'2026-11-30'});
  const records = [
    ...[0,1,2].map(index => describedRecord(`staff-${index}`, {...newerWorse,status:'active'}, [better, newerWorse])),
    ...[3,4].map(index => describedRecord(`staff-${index}`, better)),
    describedRecord('staff-3', completed({reviewDate:'2026-09-30'})),
    describedRecord('legacy', completed({baselineTotal:null, followUpTotal:null})),
    describedRecord('invalid', completed({followUp:12, followUpTotal:8})),
  ];
  const [group] = buildTrialInsights(records).groups;
  assert.equal(group.caseRange,'5–9');
  assert.equal(group.medianDeltaPoints,20);
});

test('fictional dashboard is an independent example and labels demo rendering', () => {
  const demo = buildDemoTrialInsights();
  const real = buildTrialInsights([]);
  assert.deepEqual(real.groups, []);
  assert(demo.groups.length >= 2);
  assert.match(trialInsightsView(demo, {demo:true}), /Dane demonstracyjne/);
  assert.doesNotMatch(trialInsightsView(real), /Dane demonstracyjne/);
  assert.doesNotMatch(trialInsightsView({minimumCases:5, groups:[{label:'<a data-test="n">',caseRange:'5–9',medianDeltaPoints:5,direction:'increased'}]}), /<a data-test/);
});

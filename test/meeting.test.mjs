import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDemoState } from '../public/domain.mjs';
import { sharedMeeting } from '../lib/meeting.mjs';
import { answerMeeting, localPlanner } from '../lib/meeting-agent.mjs';

test('agent runs the selected tool against shared sources and keeps model input limited to the question', async () => {
  const [record] = makeDemoState().cases;
  const criterion = record.evidence[0].criterion;
  record.contexts.push({evidenceId:'ev-1',text:'Ustaliliśmy kolejność w poniedziałek.'});
  const meeting = sharedMeeting(record,'2026-11-21');
  const input = [];
  const answer = await answerMeeting(meeting,{criterion,question:'Co było wcześniej?'}, async (...args) => {
    input.push(...args); return 'porownaj_okresy';
  });
  assert.deepEqual(input,['Co było wcześniej?']);
  assert.match(answer.summary,/dniach: 3\./);
  assert.match(answer.sources[0].text,/12 spraw/);
  assert.ok(!JSON.stringify(answer).includes('Robocza notatka'));
  const voice = await answerMeeting(meeting,{criterion,tool:'glos_pracownika'},null);
  assert.deepEqual(voice.sources[0].replies,['Ustaliliśmy kolejność w poniedziałek.']);
  const agenda = await answerMeeting(meeting,{criterion,tool:'przygotuj_rozmowe'},null);
  assert.equal(agenda.questions.length,3);
  const unsupported = await answerMeeting(meeting,{criterion,question:'Ocena?'},async () => 'poza_zakresem');
  assert.deepEqual(unsupported.sources,[]);
  await assert.rejects(answerMeeting(meeting,{criterion,question:'Co wcześniej?'},null),{status:503});
  await assert.rejects(answerMeeting(meeting,{criterion,tool:'__proto__'},null),{status:400});
  assert.throws(() => localPlanner('https://example.org/v1/chat/completions'));
});

test('the same criterion reveals three recent entries and one earlier example from the assessment period', () => {
  const [record] = makeDemoState().cases;
  record.contexts.push({evidenceId:'ev-4',text:'Wtedy uzgadnialiśmy priorytet rano.'});
  record.contexts.push({evidenceId:'ev-6',text:'Prywatny dopisek'});
  const meeting = sharedMeeting(record, '2026-12-01');
  const rows = meeting.observations.filter(entry => entry.criterion === record.evidence[0].criterion);
  assert.equal(meeting.recentStart, '2026-10-23');
  assert.equal(rows.length, 4);
  assert.equal(rows.filter(entry => entry.date >= meeting.recentStart).length, 3);
  assert.deepEqual(rows[0].replies,['Wtedy uzgadnialiśmy priorytet rano.']);
  assert.ok(!JSON.stringify(meeting).includes('Prywatny dopisek'));
  const limited = sharedMeeting(record, '2026-09-30');
  assert.equal(limited.end,'2026-09-30');
  assert.equal(limited.observations.length,2);
  record.formDetails.periodEnd = '2026-09-01';
  assert.equal(sharedMeeting(record,'2026-12-01').observations.length,1);
});

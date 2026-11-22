import assert from 'node:assert/strict';
import test from 'node:test';
import { newCase } from '../public/domain.mjs';
import { buildWorkQueue } from '../public/work-queue.mjs';
import { reminderCalendar, taskReminderCalendar } from '../public/calendar.mjs';

const today = '2026-11-21';
const signed = { date: '2026-11-20' };
const base = overrides => ({
  ...newCase({ id: 'case', employeeName: 'Anna Testowa', positionType: 'C', startDate: '2026-10-21', dueDate: '2026-11-23' }),
  ...overrides,
});
const complete = overrides => base({ stage: 'complete', signatures: { manager: signed, employee: signed }, signedFile: {name: 'arkusz.pdf'}, ...overrides });
const kinds = entries => entries.map(item => item.kind);

test('kolejka kierownika rozróżnia zaległy arkusz, dzisiejszą rozmowę i przyszłe sprawy', () => {
  const queue = buildWorkQueue([
    base({id:'upcoming', stage:'review', dueDate:'2027-01-14'}),
    base({id:'today', stage:'observations', dueDate:'2026-11-28', reviewMeeting:{date:today}}),
    base({id:'late', stage:'sign', dueDate:'2026-11-19'}),
    base({id:'soon', stage:'review', dueDate:'2026-11-27'}),
  ], 'manager', today);

  assert.deepEqual(queue.tasks.map(item => [item.recordId,item.dueState,item.panel]), [
    ['late','overdue','process'], ['today','today','partner'], ['soon','soon','process'], ['upcoming','upcoming','process'],
  ]);
  assert.equal(queue.tasks[0].step,'sign');
});

test('obie strony otrzymują własne potwierdzenia we właściwej kolejności', () => {
  const opening = base({stage:'start', openingDeadline:'2026-11-24', startMeeting:{date:today}});
  assert.deepEqual(kinds(buildWorkQueue([opening], 'manager', today).tasks), ['sign-opening']);
  assert.deepEqual(kinds(buildWorkQueue([opening], 'employee', today).waiting), ['await-opening']);

  opening.startMeeting.signedManager = signed;
  assert.deepEqual(kinds(buildWorkQueue([opening], 'manager', today).waiting), ['await-opening']);
  const employee = buildWorkQueue([opening], 'employee', today);
  assert.deepEqual(kinds(employee.tasks), ['acknowledge-opening']);
  assert.equal(employee.tasks[0].dueDate,'2026-11-24');

  opening.startMeeting.signedEmployee = signed;
  assert.deepEqual(kinds(buildWorkQueue([opening], 'manager', today).tasks), ['begin-observations']);
  assert.deepEqual(kinds(buildWorkQueue([opening], 'employee', today).tasks), []);

  const review = base({stage:'sign', signatures:{manager:signed}});
  assert.deepEqual(kinds(buildWorkQueue([review], 'manager', today).waiting), ['await-review']);
  assert.deepEqual(kinds(buildWorkQueue([review], 'employee', today).tasks), ['acknowledge-review']);
  assert.equal(buildWorkQueue([review], 'employee', today).tasks[0].dueDate,null);
});

test('kontekst pracownika dotyczy tylko udostępnionej obserwacji bez odpowiedzi', () => {
  const record = base({stage:'review', evidence:[{id:'public', shared:true, text:'udostępniona notatka'}, {id:'private', shared:false, text:'prywatna notatka'}]});
  const {tasks,waiting} = buildWorkQueue([record], 'employee', today);

  assert.deepEqual(kinds(tasks), ['add-context']);
  assert.equal(tasks[0].panel,'evidence');
  assert.equal(tasks[0].optional,true);
  assert.deepEqual(kinds(waiting), ['await-review']);
  assert.doesNotMatch(JSON.stringify({tasks,waiting}), /prywatna notatka|udostępniona notatka/);

  record.contexts = [{evidenceId:'public', text:'wyjaśnienie'}];
  assert.deepEqual(kinds(buildWorkQueue([record], 'employee', today).tasks), []);
});

test('działanie pozostaje do sprawdzenia także po zamknięciu sprawy', () => {
  const record = complete({action:{status:'active', reviewDate:'2026-11-22'}});
  assert.deepEqual(kinds(buildWorkQueue([record], 'manager', today).waiting), ['verify-trial']);
  assert.deepEqual(kinds(buildWorkQueue([record], 'manager', '2026-11-22').tasks), ['verify-trial']);
  assert.equal(buildWorkQueue([record], 'manager', '2026-11-23').tasks[0].dueState, 'overdue');
  assert.deepEqual(kinds(buildWorkQueue([record], 'employee', today).tasks), ['comment-trial']);

  record.action.status = 'completed';
  assert.deepEqual(kinds(buildWorkQueue([record], 'manager', '2026-11-23').tasks), []);
  assert.deepEqual(kinds(buildWorkQueue([record], 'employee', '2026-11-23').tasks), []);
});

test('kadry widzą bliskie terminy, brak załącznika i brak potwierdzenia obiegu', () => {
  const cases = [
    base({id:'opening', stage:'start', openingDeadline:'2026-11-28', dueDate:'2027-01-05'}),
    base({id:'far', stage:'review', dueDate:'2027-01-05'}),
    base({id:'missing-date', stage:'observations', dueDate:''}),
    complete({id:'no-file', signedFile:null}),
    complete({id:'no-handoff'}),
    complete({id:'filed', handoffs:[{channel:'ezd',reference:'123'}]}),
  ];

  const hr = buildWorkQueue(cases, 'hr', today);
  assert.deepEqual(hr.tasks.map(item => [item.recordId,item.kind]), [
    ['opening','check-deadline'], ['missing-date','check-deadline'], ['no-file','attach-signed'], ['no-handoff','record-handoff'],
  ]);
  assert.equal(hr.tasks[0].dueDate,'2026-11-28');
  assert.deepEqual(kinds(buildWorkQueue(cases, 'manager', today).tasks).includes('record-handoff'), false);
});

test('nieprawidłowe daty sprawy pozostają bez terminu, a dyrekcja nie otrzymuje spraw', () => {
  const record = base({stage:'review', dueDate:'2026-02-30'});
  assert.equal(buildWorkQueue([record], 'manager', today).tasks[0].dueState,'none');
  assert.deepEqual(buildWorkQueue([record], 'director', today), {tasks:[],waiting:[]});
  assert.throws(() => buildWorkQueue([record], 'manager', '2026-02-30'), /bieżącą datę/);
});

test('próba i ocena dają osobne przypomnienia bez nazwiska pracownika', () => {
  const record = complete({action:{status:'active', reviewDate:'2026-12-21'}});
  const [trial] = buildWorkQueue([record], 'manager', today).waiting;
  const now = new Date('2026-11-21T08:00:06.222Z');
  const assessment = reminderCalendar(record, now);
  const reminder = taskReminderCalendar(trial, now);

  assert.match(assessment,/UID:case@druga-strona-oceny.local\r\nDTSTAMP:20261121T080006Z\r\nDTSTART;VALUE=DATE:20261123/);
  assert.match(reminder,/UID:case:verify-trial@druga-strona-oceny.local/);
  assert.match(reminder,/DTSTART;VALUE=DATE:20261221/);
  assert.match(reminder,/TRIGGER:-P1D/);
  assert.doesNotMatch(reminder,/Anna|Testowa/);
  assert.throws(() => taskReminderCalendar({...trial,dueDate:'2026-02-30'}, now), /Dobierz termin/);
});

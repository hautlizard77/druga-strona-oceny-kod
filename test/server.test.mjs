import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile, readdir, rmdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createApplication } from '../server.mjs';
import { officeDate } from '../lib/cases.mjs';
import { decodeZip } from '../lib/zip.mjs';
import { addDays } from '../public/domain.mjs';
import { reminderCalendar } from '../public/calendar.mjs';
import { buildWorkQueue } from '../public/work-queue.mjs';

async function start(t, options = {}) {
  const dataFile = join(tmpdir(), `dso-test-${randomUUID()}.json`);
  const { server } = await createApplication({ officeExamples:false, ...options, dataFile });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await unlink(dataFile);
    const dir = `${dataFile}.signed-files`;
    const files = await readdir(dir).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (files) {
      await Promise.all(files.map(file => unlink(join(dir, file))));
      await rmdir(dir);
    }
  });
  function client() {
    let cookie = '';
    return async function request(path, method = 'GET', data, headers = {}) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method,
        headers: { cookie, ...headers, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      const isJson = response.headers.get('content-type')?.startsWith('application/json');
      return { status: response.status, headers: response.headers, body: isJson ? await response.json() : Buffer.from(await response.arrayBuffer()) };
    };
  }
  return { client, dataFile };
}

async function demoLogin(client, username) {
  const result = await client('/api/login', 'POST', { username, password: 'demo-2026' });
  assert.equal(result.status, 200, result.body.error);
  assert.match(result.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  return result.body.user;
}

test('each role receives only its authorized records and closed drafts stay private', async t => {
  const { client } = await start(t);
  const manager = client();
  const employee = client();
  const hr = client();
  const director = client();
  assert.equal((await manager('/api/cases')).status, 401);
  assert.equal((await manager('/api/login', 'POST', { username: 'kierownik', password: 'demo-2026' }, { Origin: 'https://outside.invalid' })).status, 403);
  await demoLogin(manager, 'kierownik');
  await demoLogin(employee, 'pracownik');
  await demoLogin(hr, 'kadry');
  await demoLogin(director, 'dyrektor');
  const path = '/api/cases/demo-ocena';
  const managerRecord = (await manager(path)).body.record;
  const employeeRecord = (await employee(path)).body.record;
  const hrRecord = (await hr(path)).body.record;
  assert(managerRecord.evidence.some(item => !item.shared));
  assert(employeeRecord.evidence.length > 0 && employeeRecord.evidence.every(item => item.shared));
  assert(employeeRecord.criteria.every(item => item.justification === ''));
  assert.equal(hrRecord.evidence.length, 0);
  assert.equal((await director(path)).status, 404);
  assert.equal((await director('/api/statistics')).body.statistics.total, 1);
  assert.equal((await employee(path, 'PATCH', { version: employeeRecord.version, changes: { outcome: { summary: 'Zmieniona ocena' } } })).status, 403);
  assert.equal((await employee(path, 'PATCH', {
    version: employeeRecord.version, changes: { contexts: [{ evidenceId: 'ev-6', text: 'Nieuprawniony dostęp' }] },
  })).status, 403);
  assert.equal((await employee('/api/logout', 'POST')).status, 200);
  assert.equal((await employee(path)).status, 401);
});

test('meeting participants see identical shared observations and new replies, with no draft, private notes or HR access', async t => {
  const { client } = await start(t);
  const manager = client(), employee = client(), hr = client();
  const path = '/api/cases/demo-ocena';
  const board = path + '/meeting';
  assert.equal((await manager(board)).status, 401);
  await demoLogin(manager, 'kierownik');
  await demoLogin(employee, 'pracownik');
  await demoLogin(hr, 'kadry');
  assert.equal((await hr(board)).status, 403);
  const command = {tool:'glos_pracownika',criterion:''};
  assert.equal((await client()(board + '/agent','POST',command)).status,401);
  assert.equal((await hr(board + '/agent','POST',command)).status,403);
  assert.equal((await employee(board + '/agent','POST',command)).status,200);
  assert.equal((await employee('/api/cases/missing/meeting')).status, 404);
  const first = (await manager(board)).body.meeting;
  assert.deepEqual(first, (await employee(board)).body.meeting);
  assert.deepEqual(Object.keys(first).sort(), ['employee','end','observations','recentDays','recentStart','start']);
  for (const entry of first.observations) assert.deepEqual(Object.keys(entry).sort(), ['criterion','date','replies','text']);
  const record = (await manager(path)).body.record;
  assert.ok(!JSON.stringify(first).includes(record.evidence.find(entry => !entry.shared).text));
  const evidence = {id:'wspolna', shared:true, text:'Wspólna obserwacja z rozmowy.', date:first.end};
  const added = await manager(path, 'PATCH', {version:record.version, changes:{evidence:[...record.evidence, evidence]}});
  assert.equal(added.status, 200);
  const result = await employee(path, 'PATCH', { version:added.body.record.version, changes:{contexts:[{evidenceId:evidence.id,text:'Dopisek z konta pracownika'}]} });
  assert.equal(result.status, 200);
  assert.deepEqual((await manager(board)).body.meeting.observations.find(entry => entry.text === evidence.text).replies, ['Dopisek z konta pracownika']);
});

test('agent drops stale evidence if a shared entry changes while the model selects a tool', async t => {
  const waiting = Promise.withResolvers();
  const release = Promise.withResolvers();
  const {client} = await start(t,{planner:async () => {
    waiting.resolve();
    await release.promise;
    return 'porownaj_okresy';
  }});
  const manager = client(), employee = client();
  await demoLogin(manager,'kierownik');
  await demoLogin(employee,'pracownik');
  const path = '/api/cases/demo-ocena';
  const {record} = (await manager(path)).body;
  const answer = employee(path + '/meeting/agent','POST',{criterion:record.evidence[0].criterion,question:'Co było wcześniej?'});
  await waiting.promise;
  try {
    const evidence = record.evidence.map(row => ({...row,shared:false}));
    const updated = await manager(path,'PATCH',{version:record.version,changes:{evidence}});
    assert.equal(updated.status,200);
  } finally { release.resolve(); }
  const result = await answer;
  assert.equal(result.status,409);
  assert.equal(result.body.answer,undefined);
});

test('review progression, optimistic concurrency, separate role attestations and follow-up survive storage', async t => {
  const { client, dataFile } = await start(t);
  const manager = client();
  const employee = client();
  await demoLogin(manager, 'kierownik');
  await demoLogin(employee, 'pracownik');
  const path = '/api/cases/demo-ocena';
  let record = (await manager(path)).body.record;
  const staleVersion = record.version;
  async function update(client, changes) {
    const result = await client(path, 'PATCH', { version: record.version, changes });
    assert.equal(result.status, 200, result.body.error);
    record = result.body.record;
  }
  const future = addDays(officeDate(), 1);
  await update(manager, { stage: 'review', action: { optionId: 'priorities', baseline: 3, startDate: future, owner: 'Nadpisany' } });
  assert.equal(record.action.baseline, 3);
  assert.equal(record.action.owner, record.managerName);
  assert.equal((await manager(path, 'PATCH', {
    version: record.version, changes: { action: { optionId: 'priorities', followUp: 1, status: 'completed' } },
  })).status, 409);
  assert.equal((await manager(path, 'PATCH', {
    version: record.version, changes: { action: { optionId: 'priorities', baseline: 'NaN' } },
  })).status, 400);
  assert.equal((await manager(path, 'PATCH', { version: record.version, changes: { stage: 'start' } })).status, 409);
  const past = addDays(officeDate(), -35);
  await update(manager, { action: { optionId: 'priorities', startDate: past } });
  assert.equal((await manager(path, 'PATCH', { version: staleVersion, changes: { position: 'Przestarzała zmiana' } })).status, 409);
  await update(manager, {
    stage: 'sign',
    criteria: record.criteria.map(criterion => ({ ...criterion, score: 5 })),
    outcome: { development: 'Wcześniej zgłaszać przekroczenie terminu.' },
  });
  assert.equal((await employee(path, 'PATCH', { version: record.version, changes: { signatures: { employee: true } } })).status, 409);
  await update(manager, { signatures: { manager: true } });
  const managerDate = record.signatures.manager.date;
  assert.match(managerDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal((await manager(path, 'PATCH', { version: record.version, changes: { outcome: { summary: 'Późniejsza zmiana' } } })).status, 409);
  await update(employee, { signatures: { employee: true } });
  assert.equal(record.stage, 'complete');
  await update(employee, { action: { employeeComment: 'Priorytety są teraz jasne.' } });
  await update(manager, { action: { optionId: 'priorities', followUp: 1, status: 'completed', decision: 'Utrzymamy zmianę.' } });
  const persisted = JSON.parse(await readFile(dataFile, 'utf8')).cases[0];
  assert.equal(persisted.action.followUp, 1);
  assert.equal(persisted.action.employeeComment, 'Priorytety są teraz jasne.');
  assert.equal(persisted.signatures.employee.by, 'demo-employee');
  assert.equal(persisted.signatures.manager.by, 'demo-manager');
});

test('position window, chronology and C worksheet completeness hold across a rules update', async t => {
  const {client} = await start(t);
  const manager = client(), hr = client();
  await demoLogin(manager,'kierownik');
  await demoLogin(hr,'kadry');
  const path = '/api/cases/demo-ocena';
  let {record} = (await manager(path)).body;
  const patch = changes => manager(path,'PATCH',{version:record.version,changes});
  const priorMonths = record.ruleSnapshot.months;
  assert.equal((await hr('/api/config','PATCH',{config:{months:18}})).status,200);
  const created = await manager('/api/cases','POST',{employeeId:'demo-employee',startDate:'2025-01-03',position:'Specjalista'});
  assert.equal(created.status,201);
  assert.equal(created.body.record.ruleSnapshot.months,18);
  assert.equal(created.body.record.ruleSnapshot.templateVersion,'2016.470');
  const changed = await patch({events:[{type:'position-change',date:'2026-09-01'}],stage:'review'});
  assert.equal(changed.status,200,changed.body.error);
  record = changed.body.record;
  assert.equal(record.ruleSnapshot.months,priorMonths);
  assert.deepEqual(record.positionWindow,{from:'2026-08-25',to:'2026-10-01'});
  assert.equal(record.dueDate,'2026-10-01');
  assert.equal(buildWorkQueue([record],'manager','2026-09-20').tasks[0].dueDate,'2026-10-01');
  assert.match(reminderCalendar(record),/DTSTART;VALUE=DATE:20261001/);
  for (const date of ['2024-11-20',addDays(officeDate(),1)]) {
    const result = await patch({reviewMeeting:{date}});
    assert.equal(result.status,422);
    assert.equal(result.body.details[0].field,'date');
  }
  const badSequence = await patch({reviewMeeting:{date:'2026-09-16'},formDetails:{assessmentDate:'2026-09-15'}});
  assert.equal(badSequence.status,422);
  assert.equal(badSequence.body.details[0].field,'date');
  const scored = record.criteria.map(item => ({...item,score:5,evidenceIds:[]}));
  const locked = await patch({stage:'sign',reviewMeeting:{date:'2026-09-15'},criteria:scored,
    outcome:{development:'Plan rozwoju'},formDetails:{managerPosition:'',employeeUnit:'',managerUnit:''}});
  assert.equal(locked.status,422);
  assert.deepEqual(locked.body.details.map(item => item.field),['managerPosition','employeeUnit','managerUnit']);
  const done = await patch({stage:'sign',reviewMeeting:{date:'2026-09-15'},criteria:scored,
    outcome:{development:'Plan rozwoju'},formDetails:{assessmentDate:'2026-09-16',managerPosition:'Naczelnik Zespołu',employeeUnit:'Biuro Obsługi Zgłoszeń',managerUnit:'Departament Koordynacji'}});
  assert.equal(done.status,200,done.body.error);
  record = done.body.record;
  const confirmed = await patch({signatures:{manager:true}});
  assert.equal(confirmed.status,200,confirmed.body.error);
  const exported = await manager(path+'/official-docx');
  assert.equal(exported.status,200);
  const xml = decodeZip(exported.body).get('word/document.xml').toString();
  for (const value of ['Naczelnik Zespołu','Departament Koordynacji','16.09.2026']) assert.ok(xml.includes(value),value);
  assert.ok(!xml.includes('01.10.2026'),'legacy confirmed opening cannot be reconstructed from the current deadline');
});

test('opening confirmation freezes part I while a later notice updates the operational deadline', async t => {
  const {client} = await start(t);
  const manager = client(), employee = client();
  await demoLogin(manager,'kierownik');
  await demoLogin(employee,'pracownik');
  const created = await manager('/api/cases','POST',{employeeId:'demo-employee',startDate:'2024-11-20',position:'Specjalistka'});
  let {record} = created.body;
  const path = '/api/cases/'+record.id;
  async function update(client,changes) {
    const result = await client(path,'PATCH',{version:record.version,changes});
    assert.equal(result.status,200,result.body.error);
    record = result.body.record;
  }
  await update(manager,{stage:'start'});
  await update(manager,{startMeeting:{date:'2024-12-01',location:'Brzeziny',signedManager:true}});
  await update(employee,{startMeeting:{signedEmployee:true}});
  const original = structuredClone(record.openingSnapshot);
  assert.equal(original.dueDate,'2026-11-20');
  await update(manager,{stage:'observations'});
  const historical = {id:'history-2023',date:'2023-01-10',criterion:record.criteria[0].name,text:'Wpis przed okresem',shared:true};
  await update(manager,{evidence:[historical]});
  const rejected = await manager(path,'PATCH',{version:record.version,changes:{
    criteria:record.criteria.map((item,index) => index === 0 ? {...item,evidenceIds:[historical.id]} : item),
  }});
  assert.equal(rejected.status,422);
  assert.equal((await manager(path+'/meeting')).body.meeting.observations.length,0);
  const changed = {id:'notice-test',type:'earlier-request',date:'2026-08-01',newDueDate:'2026-10-01',noticeDate:'2026-08-05',noticeReference:'KAD.1/2026'};
  await update(manager,{events:[changed]});
  assert.deepEqual(record.openingSnapshot,original);
  assert.equal(record.dueDate,'2026-10-01');
  assert.equal(record.history.find(item => item.type === 'due-date-changed').details.current,'2026-10-01');
  const worker = (await employee(path)).body.record;
  assert.equal(worker.events[0].noticeReference,'KAD.1/2026');
  assert.equal(worker.openingSnapshot.dueDate,'2026-11-20');
  const exported = await manager(path+'/official-docx');
  const xml = decodeZip(exported.body).get('word/document.xml').toString();
  assert.ok(xml.includes('20.11.2026'));
  assert.ok(!xml.includes('01.10.2026'));
});

test('HR can transfer a case between managers in its office', async t => {
  const password = 'only-for-isolated-backend-test';
  const accounts = [
    { id: 'manager', role: 'manager', officeId: 'brzeziny' },
    { id: 'replacement', role: 'manager', officeId: 'brzeziny' },
    { id: 'employee', role: 'employee', officeId: 'brzeziny', directManagerId:'manager' },
    { id: 'hr', role: 'hr', officeId: 'brzeziny' },
    { id: 'elsewhere', role: 'manager', officeId: 'inne' },
  ].map(account => ({ ...account, username: account.id, name: `Konto ${account.id}`, officeName: account.officeId, password }));
  const { client } = await start(t, { demoMode: false, accounts });
  const manager = client();
  const hr = client();
  const replacement = client();
  await manager('/api/login', 'POST', { username: 'manager', password });
  await hr('/api/login', 'POST', { username: 'hr', password });
  await replacement('/api/login', 'POST', { username: 'replacement', password });
  assert.equal((await replacement('/api/cases','POST',{
    employeeId:'employee',startDate:'2024-01-02',positionType:'C',position:'Specjalista',
  })).status,403);
  const create = await manager('/api/cases', 'POST', {
    employeeId: 'employee', startDate: '2024-01-01', positionType: 'C', position: 'Specjalista',
  });
  assert.equal(create.status, 201, create.body.error);
  const record = create.body.record;
  const path = `/api/cases/${record.id}`;
  assert.equal((await replacement(path)).status, 404);
  assert.equal((await hr(path, 'PATCH', { version: record.version, changes: { managerId: 'elsewhere' } })).status, 400);
  assert.equal((await hr(path,'PATCH',{version:record.version,changes:{managerId:'replacement'}})).status,400);
  assert.equal((await replacement('/api/people/supervisor','PATCH',{employeeId:'employee',managerId:'replacement'})).status,403);
  assert.equal((await hr('/api/people/supervisor','PATCH',{employeeId:'employee',managerId:'replacement'})).status,200);
  const transfer = await hr(path, 'PATCH', {
    version: record.version, changes: { managerId: 'replacement', managerChangeDate: '2024-10-01' },
  });
  assert.equal(transfer.status, 200, transfer.body.error);
  assert.equal((await manager(path)).status, 404);
  const after = await replacement(path);
  assert.equal(after.status, 200);
  assert.equal(after.body.record.events[0].type, 'manager-change');
  assert.equal(after.body.record.formDetails.managerLastName, 'replacement');
  assert.deepEqual(after.body.record.criteria, record.criteria);
});

test('editing opening notes reopens the start stage and clears both prior attestations', async t => {
  const { client } = await start(t);
  const manager = client();
  await demoLogin(manager, 'kierownik');
  const path = '/api/cases/demo-ocena';
  const before = (await manager(path)).body.record;
  assert(before.startMeeting.signedManager && before.startMeeting.signedEmployee);
  const result = await manager(path, 'PATCH', {
    version: before.version, changes: { startMeeting: { notes: 'Ponowne ustalenie zasad.' } },
  });
  assert.equal(result.status, 200, result.body.error);
  assert.equal(result.body.record.stage, 'start');
  assert.equal(result.body.record.startMeeting.signedManager, null);
  assert.equal(result.body.record.startMeeting.signedEmployee, null);
});

test('handoff packages are authorized, keep the original PDF, and record a receipt once', async t => {
  const { client, dataFile } = await start(t);
  const manager = client();
  const employee = client();
  const hr = client();
  await demoLogin(manager, 'kierownik');
  await demoLogin(employee, 'pracownik');
  await demoLogin(hr, 'kadry');
  const path = '/api/cases/demo-ocena';
  assert.equal((await employee(`${path}/official-docx`)).status, 403);
  assert.equal((await manager(`${path}/handoff.zip`)).status, 409);
  let { record } = (await manager(path)).body;
  async function update(client, changes) {
    const result = await client(path, 'PATCH', { version: record.version, changes });
    assert.equal(result.status, 200, result.body.error);
    ({ record } = result.body);
  }
  await update(manager, { stage: 'review' });
  await update(manager, { stage:'sign',reviewMeeting:{date:'2026-11-12'},formDetails:{assessmentDate:'2026-11-12'},
    criteria:record.criteria.map(item => ({...item,score:5,evidenceIds:[]})),outcome:{development:'Ustalić priorytety.'} });
  await update(manager, { signatures: { manager: true } });
  await update(employee, { signatures: { employee: true } });
  const original = Buffer.from('%PDF-1.7\n% fixture used for transport test\n%%EOF\n');
  const upload = await manager(`${path}/signed-file`, 'POST', { name: 'arkusz.pdf', content: original.toString('base64'), version: record.version });
  assert.equal(upload.status, 201, upload.body.error);
  const version = upload.body.record.version;
  assert.equal((await employee(`${path}/handoff.zip`)).status, 403);
  assert.equal((await employee(`${path}/handoffs`, 'POST', { channel: 'ezd', reference: 'KAD.15.2026', version })).status, 403);
  const zip = await hr(`${path}/handoff.zip`);
  assert.equal(zip.status, 200);
  assert.equal(zip.headers.get('cache-control'), 'private, no-store');
  const files = decodeZip(zip.body);
  assert.deepEqual(files.get('podpisany-arkusz-oceny.pdf'), original);
  const manifest = JSON.parse(files.get('manifest.json'));
  assert.equal(manifest.document.sha256, upload.body.signedFile.hash);
  assert.equal(manifest.document.bytes, original.length);
  assert.equal(manifest.employeeName, undefined);
  const eml = await manager(`${path}/handoff.eml`);
  assert.equal(eml.headers.get('content-type'), 'message/rfc822');
  assert.match(eml.body.toString(), /X-Unsent: 1\r\n/);
  assert(eml.body.toString().includes(original.toString('base64')));
  assert.doesNotMatch(eml.body.toString(), /^To:/m);
  const receipt = { channel: 'ezd', reference: 'KAD.15.2026', version };
  assert.equal((await hr(`${path}/handoffs`, 'POST', receipt)).status, 200);
  assert.equal((await hr(`${path}/handoffs`, 'POST', receipt)).status, 200);
  const viewer = (await employee(path)).body.record;
  assert.equal(viewer.handoffs.length,1);
  assert.equal(viewer.handoffs[0].reference,undefined);
  assert.equal(viewer.appealDeadline,'');
  const invalid = {version:viewer.version,deliveredOn:'2026-11-13',acknowledgedOn:'2026-09-10'};
  assert.equal((await hr(path+'/delivery','POST',invalid)).status,422);
  const delivery = {...invalid,acknowledgedOn:'2026-11-12'};
  assert.equal((await employee(path+'/delivery','POST',delivery)).status,403);
  assert.equal((await hr(path+'/delivery','POST',delivery)).status,200);
  const first = (await employee(path)).body.record;
  assert.equal(first.appealDeadline,'2026-11-19');
  const correction = {...delivery,version:first.version,acknowledgedOn:'2026-11-13'};
  assert.equal((await hr(path+'/delivery','POST',correction)).status,422);
  assert.equal((await hr(path+'/delivery','POST',{...correction,reason:'Zweryfikowano potwierdzenie w EZD'})).status,200);
  assert.equal((await employee(path)).body.record.appealDeadline,'2026-11-20');
  const stored = JSON.parse(await readFile(dataFile, 'utf8')).cases[0];
  assert.equal(stored.handoffs.length, 1);
  assert.equal(stored.history.filter(entry => entry.type === 'handoff-recorded').length, 1);
  const audit = stored.history.find(entry => entry.type === 'delivery-corrected');
  assert.equal(audit.by,'demo-hr');
  assert.equal(audit.details.reason,'Zweryfikowano potwierdzenie w EZD');
  assert.equal(audit.details.previous.acknowledgedOn,'2026-11-12');
  assert.equal(audit.details.current.acknowledgedOn,'2026-11-13');
});

test('jury mode provides a repeatable fictional case and keeps the HR example separate', async t => {
  const { client } = await start(t, { juryDemo: true });
  const manager = client();
  const hr = client();
  await demoLogin(manager, 'kierownik');
  await demoLogin(hr, 'kadry');
  const path = '/api/cases/demo-ocena';
  const before = (await manager(path)).body.record;
  assert.equal((await manager('/api/cases')).body.cases.length,1);
  assert.equal(before.contexts.length,1);
  assert.equal((await hr(path+'/jury-trial','POST',{version:before.version,step:'start'})).status,403);
  let response = {body:{record:before}};
  for (const step of ['start','result','repeat']) {
    response = await manager(path+'/jury-trial','POST',{version:response.body.record.version,step});
    assert.equal(response.status,200,response.body.error);
  }
  assert.deepEqual(response.body.record.signatures, before.signatures);
  assert.deepEqual(response.body.record.outcome, before.outcome);
  assert.equal(response.body.record.juryTrial.followUpTotal,8);
  assert.equal(response.body.record.juryTrial.nextTrial.baseline,4);
  assert.equal(response.body.record.action,null);
  const { statistics } = (await hr('/api/statistics')).body;
  assert.deepEqual(statistics.trialInsights.groups, []);
  assert(statistics.demoTrialInsights.groups.length > 0);
  assert.equal((await manager('/api/statistics')).status, 403);
});

test('office demo populates the workflow, aggregates comparable trials and respects team assignments', async t => {
  const {client,dataFile} = await start(t,{officeExamples:true});
  const hr = client(), manager = client(), control = client(), employee = client();
  await demoLogin(hr,'kadry');
  await demoLogin(manager,'kierownik');
  await demoLogin(control,'kierownik-kontrola');
  await demoLogin(employee,'demo-hubert');
  const {cases} = (await hr('/api/cases')).body;
  assert.equal(cases.length,13);
  assert.equal(new Set(cases.map(record => record.stage)).size,6);
  assert.deepEqual([...new Set(cases.map(record => record.formType))].sort(),['A','B','C']);
  assert.equal((await employee('/api/cases')).body.cases[0].id,'demo-office-hubert');
  assert.equal((await manager('/api/cases/demo-office-hubert')).status,404);
  assert.equal((await control('/api/cases/demo-office-hubert')).status,200);
  assert.equal((await control('/api/cases/demo-ocena')).status,404);
  const {statistics} = (await hr('/api/statistics')).body;
  assert.equal(statistics.trialInsights.groups.length,1);
  assert.equal(statistics.trialInsights.groups[0].caseRange,'5–9');
  assert.equal(statistics.trialInsights.suppressed,true);
  const saved = await readFile(dataFile,'utf8');
  await createApplication({dataFile,officeExamples:true});
  assert.equal(await readFile(dataFile,'utf8'),saved);
});

test('the expanded demo joins an existing demo database without replacing edited cases', async t => {
  const {client,dataFile} = await start(t);
  const manager = client();
  await demoLogin(manager,'kierownik');
  const path = '/api/cases/demo-ocena';
  const {record} = (await manager(path)).body;
  assert.equal((await manager(path,'PATCH',{version:record.version,changes:{title:'Własny tytuł sprawy Anny'}})).status,200);
  const before = JSON.parse(await readFile(dataFile,'utf8')).cases[0];
  await createApplication({dataFile,officeExamples:true});
  const after = JSON.parse(await readFile(dataFile,'utf8'));
  assert.equal(after.cases.length,13);
  assert.deepEqual(after.cases[0],before);
});

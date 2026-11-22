import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { copyFile, cp, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../server.mjs';

const teamCount = 6;
const casesPerTeam = 30;
const changesPerTeam = 20;
const root = await mkdtemp(join(tmpdir(),'dso-pilot-'));
const servers = new Set();
const password = 'fictional-office-check';
const office = {officeId:'pilot',officeName:'Fikcyjny urząd testowy'};
const accounts = Array.from({length:teamCount},(_, index) => [
  {id:`manager-${index}`,role:'manager',name:`Kierownik Testowy ${index}`},
  {id:`employee-${index}`,role:'employee',name:`Pracownik Testowy ${index}`,directManagerId:`manager-${index}`},
]).flat().map(account => ({...office,...account,username:account.id,password}));

async function launch(dataFile, options) {
  const {server} = await createApplication({dataFile,...options});
  servers.add(server);
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  return server;
}
async function close(server) {
  if (!servers.delete(server)) return;
  await new Promise(resolve => server.close(resolve));
}
async function connect(server, username, pass) {
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let cookie = '';
  const request = async (path, method = 'GET', data, expected = 200) => {
    const response = await fetch(base+path,{method,headers:{cookie,...(data ? {'Content-Type':'application/json'} : {})},body:data ? JSON.stringify(data) : undefined});
    const json = response.headers.get('Content-Type')?.startsWith('application/json');
    const result = json ? await response.json() : Buffer.from(await response.arrayBuffer());
    assert.equal(response.status,expected,`${method} ${path} ${JSON.stringify(result)}`);
    if (path === '/login') cookie = response.headers.get('set-cookie').split(';')[0];
    return result;
  };
  await request('/login','POST',{username,password:pass});
  return request;
}

try {
  const dataFile = join(root,'performance.json');
  const server = await launch(dataFile,{demoMode:false,accounts});
  const teams = await Promise.all(Array.from({length:teamCount},(_, index) => connect(server,`manager-${index}`,password)));
  const sets = await Promise.all(teams.map(async (request,index) => {
    const records = [];
    for (let day = 1; day <= casesPerTeam; day++) {
      const result = await request('/cases','POST',{employeeId:`employee-${index}`,position:'Stanowisko testowe',
        startDate:`2025-09-${String(day).padStart(2,'0')}`},201);
      records.push(result.record);
    }
    return records;
  }));
  const timings = [];
  const start = performance.now();
  await Promise.all(teams.map(async (request,index) => {
    for (const record of sets[index].slice(0,changesPerTeam)) {
      const begin = performance.now();
      const {record:updated} = await request('/cases/'+record.id,'PATCH',{version:record.version,changes:{title:'Zapis potwierdzony'}});
      assert.equal(updated.version,record.version+1);
      timings.push(performance.now()-begin);
    }
  }));
  const elapsed = performance.now()-start;
  const counts = await Promise.all(teams.map(async request => (await request('/cases')).cases.filter(item => item.title === 'Zapis potwierdzony').length));
  assert.ok(counts.every(count => count === changesPerTeam));
  const target = sets[0][0];
  await teams[0]('/cases/'+target.id,'PATCH',{version:target.version,changes:{title:'Nieaktualny zapis'}},409);
  await close(server);
  timings.sort((left,right) => left-right);
  console.log(JSON.stringify({teams:teamCount,cases:casesPerTeam*teamCount,writes:timings.length,errors:0,staleWriteRejected:true,
    databaseBytes:(await stat(dataFile)).size,elapsedMs:Math.round(elapsed),p95ms:Math.round(timings[Math.ceil(timings.length*.95)-1])}));

  const source = join(root,'source.json');
  const live = await launch(source,{completedFixture:true,demoMode:true});
  const manager = await connect(live,'kierownik','demo-2026');
  const path = '/cases/demo-proba-zweryfikowana';
  const {record} = await manager(path);
  const pdf = Buffer.from('%PDF-1.7\n% fictional retention fixture\n%%EOF\n');
  await manager(path+'/signed-file','POST',{version:record.version,name:'arkusz.pdf',content:pdf.toString('base64')},201);
  await close(live);
  const backup = join(root,'backup');
  await mkdir(backup);
  const backupFile = join(backup,'office.json');
  await copyFile(source,backupFile);
  await cp(source+'.signed-files',backupFile+'.signed-files',{recursive:true});
  const restored = join(root,'restored.json');
  await copyFile(backupFile,restored);
  await cp(backupFile+'.signed-files',restored+'.signed-files',{recursive:true});
  const restoredServer = await launch(restored,{demoMode:true});
  const employee = await connect(restoredServer,'pracownik','demo-2026');
  const restoredCase = (await employee(path)).record;
  const restoredPdf = await employee(path+'/signed-file');
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha(restoredPdf),sha(pdf));
  assert.equal(restoredCase.signedFile.hash,sha(pdf));
  assert.equal(restoredCase.stage,'complete');
  assert.equal(restoredCase.signatures.employee.by,'demo-employee');
  await close(restoredServer);
  // Expire the disposable backup as one unit. Confirm the restored instance is independent.
  await rm(backup,{recursive:true});
  await assert.rejects(stat(backupFile),{code:'ENOENT'});
  await assert.rejects(stat(backupFile+'.signed-files'),{code:'ENOENT'});
  assert.ok((await stat(restored)).isFile());
  assert.ok((await stat(restored+'.signed-files')).isDirectory());
  console.log(JSON.stringify({restoredCase:restoredCase.id,attachmentHashMatches:true,expiredBackupPairRemoved:true,restoredPairIntact:true}));
} finally {
  await Promise.all([...servers].map(close));
  await rm(root,{recursive:true});
}

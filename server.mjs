import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, realpath, stat, unlink } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { attachSignedFile, changeRecord, createRecord, forViewer, hasAccess, officeDate, problem, recordDelivery, recordHandoff } from './lib/cases.mjs';
import { archiveHandoff, docxType, mailDraft } from './lib/handoff.mjs';
import { advanceJuryTrial, juryTrialCase } from './lib/jury-demo.mjs';
import { officeDemo } from './lib/office-demo.mjs';
import { sharedMeeting } from './lib/meeting.mjs';
import { answerMeeting, localPlanner } from './lib/meeting-agent.mjs';
import { attachmentDisposition, maxUploadJson, readSignedFile, readUpload, signedFilePath, writeSignedFile } from './lib/signed-files.mjs';
import { openStore } from './lib/store.mjs';
import { buildDemoTrialInsights, buildTrialInsights } from './lib/trial-insights.mjs';
import { makeDemoState, RULESET } from './public/domain.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const publicRoot = resolve(root, 'public');
const cookieName = 'dso_session';
const eightHours = 8 * 60 * 60 * 1000;
const loginWindow = 10 * 60 * 1000;
const demoPassword = 'demo-2026';
const demoLogins = { manager: 'kierownik', employee: 'pracownik', hr: 'kadry', director: 'dyrektor' };
const local = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const fileTypes = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.ico': 'image/x-icon', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.json': 'application/json; charset=utf-8',
};

function sendJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(payload));
}

function download(response, bytes, type, filename, disposition = `attachment; filename="${filename}"`) {
  response.writeHead(200, { 'Content-Type': type, 'Content-Length': bytes.length, 'Content-Disposition': disposition, 'Cache-Control': 'private, no-store' });
  return response.end(bytes);
}

async function parseBody(request, maxBytes = 2_000_000) {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] ?? '')) {
    throw problem(415, 'Prześlij dane w formacie JSON.');
  }
  const buffer = [];
  let length = 0;
  if (Number(request.headers['content-length']) > maxBytes) {
    request.resume();
    throw problem(413, 'Przesłane dane są zbyt duże.');
  }
  for await (const chunk of request) {
    length += chunk.length;
    if (length <= maxBytes) buffer.push(chunk);
  }
  if (length > maxBytes) throw problem(413, 'Przesłane dane są zbyt duże.');
  try {
    const body = JSON.parse(Buffer.concat(buffer).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw problem(400, 'Przesłano nieprawidłowy JSON.');
  }
}

function authorizeOrigin(request, host, origin) {
  let receivedHost;
  try {
    receivedHost = new URL(`http://${request.headers.host}`).hostname;
  } catch {
    throw problem(400, 'Nieprawidłowy adres serwera.');
  }
  if (local.has(host) && !local.has(receivedHost)) throw problem(403, 'Niedozwolony adres serwera.');
  if (['GET', 'HEAD'].includes(request.method)) return;
  if (request.headers['sec-fetch-site'] === 'cross-site') throw problem(403, 'Niedozwolone źródło żądania.');
  if (origin && request.headers.origin && request.headers.origin !== origin) throw problem(403, 'Niedozwolone źródło żądania.');
  if (!origin && request.headers.origin) {
    try {
      const source = new URL(request.headers.origin);
      if (source.host === request.headers.host && ['http:', 'https:'].includes(source.protocol)) return;
    } catch {
      // Reject malformed origins together with other unauthorized sources.
    }
    throw problem(403, 'Niedozwolone źródło żądania.');
  }
}

function publicUser({ id, username, name, role, officeId, officeName }) {
  return { id, username, name, role, officeId, officeName };
}

function makeAccounts(demoState) {
  const sampleOffice = demoState.cases[0]?.office || 'Urząd demonstracyjny';
  const sampleUsers = [...demoState.users];
  if (!sampleUsers.some(({ role }) => role === 'director')) {
    sampleUsers.push({ id: 'demo-director', name: 'Piotr Zieliński', role: 'director' });
  }
  return sampleUsers.map(user => ({
    ...user,
    ...(user.role === 'employee' ? { directManagerId:user.directManagerId ?? 'demo-manager' } : {}),
    username: user.username || demoLogins[user.role],
    officeId: user.officeId || 'demo-office',
    officeName: user.officeName || sampleOffice,
    password: demoPassword,
  }));
}

function buildAccountList(config, demoMode) {
  if (!Array.isArray(config) || config.length < 1) throw new Error('Dodaj co najmniej jedno konto.');
  const seenIds = new Set();
  const seenNames = new Set();
  const accounts = config.map(user => {
    const valid = user && ['id', 'username', 'name', 'role', 'officeId', 'officeName'].every(key =>
      typeof user[key] === 'string' && user[key].trim().length > 0 && user[key].length <= 200,
    );
    if (!valid || !Object.hasOwn(demoLogins, user.role)) throw new Error('Sprawdź dane i role kont użytkowników.');
    if (!/^[a-z0-9_.-]{1,100}$/i.test(user.id) || !/^[a-z0-9_.-]{1,100}$/i.test(user.officeId)) {
      throw new Error('Identyfikator użytkownika i urzędu musi mieć do 100 znaków (litery, cyfry, kropka, podkreślenie, myślnik).');
    }
    const username = user.username.trim().toLocaleLowerCase('pl-PL');
    if (seenIds.has(user.id) || seenNames.has(username)) throw new Error('Identyfikatory i nazwy użytkowników muszą być unikalne.');
    seenIds.add(user.id);
    seenNames.add(username);
    const salt = randomBytes(16);
    let hash;
    let digestSalt = salt;
    if (typeof user.passwordHash === 'string' && /^[a-f0-9]{32}:[a-f0-9]{128}$/.test(user.passwordHash)) {
      const [savedSalt, savedHash] = user.passwordHash.split(':');
      digestSalt = Buffer.from(savedSalt, 'hex');
      hash = Buffer.from(savedHash, 'hex');
    } else {
      const minimum = demoMode ? 1 : 12;
      if (typeof user.password !== 'string' || user.password.length < minimum || user.password.length > 200) {
        throw new Error(`Ustaw skrót hasła albo hasło o długości co najmniej ${minimum} znaków.`);
      }
      hash = scryptSync(user.password, salt, 64);
    }
    return { ...publicUser({ ...user, username }), directManagerId:user.directManagerId, salt: digestSalt, hash };
  });
  for (const person of accounts.filter(item => item.role === 'employee' && item.directManagerId !== undefined)) {
    if (!accounts.some(item => item.role === 'manager' && item.id === person.directManagerId && item.officeId === person.officeId)) {
      throw new Error('Powiąż pracownika z bezpośrednim przełożonym z tego samego urzędu.');
    }
  }
  return accounts;
}

function supervisorId(state, employee) {
  return employee && (state.supervisors?.[employee.id]?.managerId ?? employee.directManagerId);
}
function tokenFrom(request) {
  const match = request.headers.cookie?.match(new RegExp(`(?:^|;\\s*)${cookieName}=([a-f0-9]{64})(?:;|$)`));
  return match?.[1];
}

function cookie(token, secure, maxAge = eightHours / 1000) {
  return `${cookieName}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}

function ruleConfig(state, officeId) {
  return Object.hasOwn(state.officeConfigs, officeId) ? state.officeConfigs[officeId] : RULESET;
}

function getRecord(state, id, user) {
  const record = state.cases.find(item => item.id === id);
  if (!record || !hasAccess(record, user)) throw problem(404, 'Nie znaleziono tej oceny.');
  return record;
}

function inDirectory(candidate, directory) {
  if (process.platform === 'win32') {
    candidate = candidate.toLowerCase();
    directory = directory.toLowerCase();
  }
  return candidate === directory || candidate.startsWith(`${directory}${sep}`);
}

async function verifyPrivateStorage(filename, signedDirectory) {
  const publicDirectory = await realpath(publicRoot);
  const appStorage = dirname(filename);
  if (inDirectory(filename, publicRoot)) throw new Error('Katalog danych musi znajdować się poza katalogiem public.');
  await mkdir(appStorage, { recursive: true, mode: 0o700 });
  if (inDirectory(await realpath(appStorage), publicDirectory)) throw new Error('Katalog danych musi znajdować się poza katalogiem public.');
  for (const candidate of [filename, signedDirectory]) {
    try {
      if (inDirectory(await realpath(candidate), publicDirectory)) throw new Error('Baza i pliki PDF muszą znajdować się poza katalogiem public.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

function assertRole(user, ...roles) {
  if (!roles.includes(user.role)) throw problem(403, 'Twoja rola nie ma dostępu do tej funkcji.');
}

function getStatistics(state, user, demoMode) {
  const records = state.cases.filter(item => item.officeId === user.officeId);
  const byStage = {};
  const today = officeDate();
  for (const { stage } of records) byStage[stage] = (byStage[stage] || 0) + 1;
  return {
    total: records.length,
    byStage,
    overdue: records.filter(item => item.stage !== 'complete' && item.dueDate && item.dueDate < today).length,
    completed: byStage.complete || 0,
    activeActions: records.filter(item => item.action && ['planned', 'active', 'in-progress'].includes(item.action.status)).length,
    trialInsights: buildTrialInsights(records),
    ...(demoMode ? { demoTrialInsights: buildDemoTrialInsights() } : {}),
  };
}

function commonHeaders(response) {
  response.setHeader('Content-Security-Policy', [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data:", "object-src 'none'", "base-uri 'none'",
    "frame-ancestors 'none'", "form-action 'self'",
  ].join('; '));
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
}

async function serveStatic(request, response, pathname) {
  if (!['GET', 'HEAD'].includes(request.method)) throw problem(405, 'Niedozwolona metoda.');
  let location;
  try {
    location = decodeURIComponent(pathname);
  } catch {
    throw problem(400, 'Nieprawidłowy adres pliku.');
  }
  const file = resolve(publicRoot, `.${location === '/' ? '/index.html' : location}`);
  if (!file.startsWith(`${publicRoot}${sep}`)) throw problem(404, 'Nie znaleziono pliku.');
  const fileType = fileTypes[extname(file).toLowerCase()];
  if (!fileType) throw problem(404, 'Nie znaleziono pliku.');
  let size;
  let verified;
  try {
    const realRoot = await realpath(publicRoot);
    verified = await realpath(file);
    if (!verified.startsWith(`${realRoot}${sep}`)) throw problem(404, 'Nie znaleziono pliku.');
    const entry = await stat(verified);
    if (entry.isFile()) size = entry.size;
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
  }
  if (size === undefined) throw problem(404, 'Nie znaleziono pliku.');
  response.writeHead(200, { 'Content-Type': fileType, 'Content-Length': size, 'Cache-Control': 'no-cache' });
  if (request.method === 'HEAD') return response.end();
  const stream = createReadStream(verified);
  stream.on('error', () => response.destroy());
  stream.pipe(response);
}

export async function createApplication(options = {}) {
  const planner = options.planner ?? localPlanner(process.env.DSO_AI_URL);
  const host = options.host ?? process.env.DSO_HOST ?? '127.0.0.1';
  const configs = options.accountsFile ?? process.env.DSO_ACCOUNTS_FILE;
  const demoMode = options.demoMode ?? (!configs && !options.accounts);
  const origin = options.origin ?? process.env.DSO_ORIGIN;
  const secure = origin?.startsWith('https:') ?? false;
  if (demoMode && !local.has(host)) throw new Error('Tryb demonstracyjny wymaga adresu localhost.');
  if (!demoMode && !local.has(host) && !secure) throw new Error('Udostępnienie poza localhost wymaga DSO_ORIGIN z HTTPS i zakończenia TLS przez serwer pośredniczący.');
  if (!demoMode && !configs && !options.accounts) throw new Error('Wskaż plik kont przez DSO_ACCOUNTS_FILE.');
  const demoState = demoMode ? makeDemoState() : { cases: [], users: [] };
  const examples = demoMode && (options.officeExamples ?? true) ? officeDemo(demoState.cases[0],officeDate()) : null;
  if (examples) demoState.users.push(...examples.users);
  const juryDemo = demoMode && (options.juryDemo ?? process.env.DSO_JURY_DEMO === '1');
  if (juryDemo) {
    demoState.cases[0].contexts.push({id:'demo-context',evidenceId:'ev-1',authorId:'demo-employee',
      date:'2026-11-20',text:'Przejęłam pilną kolejkę. Nie ustaliliśmy wtedy, które trzy sprawy mogę przesunąć.'});
  }
  if (demoMode && options.completedFixture) demoState.cases.push(juryTrialCase(demoState.cases[0]));
  const demoConfig = demoMode ? makeAccounts(demoState) : [];
  const configured = demoMode ? demoConfig : (options.accounts ?? JSON.parse(await readFile(resolve(configs), 'utf8')));
  const accounts = buildAccountList(configured, demoMode);
  const users = new Map(accounts.map(user => [user.username, user]));
  const demoAccounts = demoMode ? demoConfig.map(user => ({ ...publicUser(user), password: demoPassword })) : [];
  const unknownSalt = randomBytes(16);
  const unknownHash = randomBytes(64);
  const sessions = new Map();
  const attempts = new Map();
  const filename = resolve(options.dataFile ?? process.env.DSO_DATA_FILE ?? resolve(root, 'data', demoMode ? 'demo.json' : 'reviews.json'));
  const signedDirectory = `${filename}.signed-files`;
  await verifyPrivateStorage(filename, signedDirectory);
  const initialCases = demoState.cases.map(record => ({
    ...record,
    officeId: record.officeId || 'demo-office',
    ruleSnapshot: record.ruleSnapshot || structuredClone(RULESET),
    version: record.version || 1,
  }));
  const store = await openStore(filename, { cases: initialCases, officeConfigs: {} });
  if (examples) {
    const state = store.read();
    if (!state.demoOfficeSeeded && state.cases.some(item => item.id === 'demo-ocena' && item.officeId === 'demo-office')) {
      await store.write(draft => {
        const existing = new Set(draft.cases.map(item => item.id));
        draft.cases.push(...examples.cases.filter(item => !existing.has(item.id)).map(item => ({...item,version:1})));
        draft.demoOfficeSeeded = true;
      });
    }
  }

  function signedIn(request) {
    const token = tokenFrom(request);
    const session = sessions.get(token);
    if (!session) return null;
    if (session.until > Date.now()) return session.user;
    sessions.delete(token);
    return null;
  }

  function login(request, response, body) {
    const ip = request.socket.remoteAddress;
    const now = Date.now();
    for (const [token, session] of sessions) {
      if (session.until <= now) sessions.delete(token);
    }
    for (const [address, attempt] of attempts) {
      if (attempt.until <= now) attempts.delete(address);
    }
    const attempt = attempts.get(ip) ?? { count: 0, until: now + loginWindow };
    if (attempt.count >= 12) throw problem(429, 'Spróbuj ponownie za kilka minut.');
    const username = typeof body.username === 'string' ? body.username.slice(0, 200).toLocaleLowerCase('pl-PL').trim() : '';
    const password = typeof body.password === 'string' && body.password.length <= 200 ? body.password : '';
    const user = users.get(username);
    const compared = scryptSync(password, user?.salt || unknownSalt, 64);
    if (!timingSafeEqual(compared, user?.hash || unknownHash) || !user) {
      attempts.set(ip, { ...attempt, count: attempt.count + 1 });
      throw problem(401, 'Nieprawidłowy login lub hasło.');
    }
    attempts.delete(ip);
    sessions.delete(tokenFrom(request));
    const token = randomBytes(32).toString('hex');
    sessions.set(token, { user, until: now + eightHours });
    response.setHeader('Set-Cookie', cookie(token, secure));
    sendJson(response, 200, { user: publicUser(user) });
  }

  async function handleApi(request, response, pathname) {
    const method = request.method;
    const user = signedIn(request);
    if (method === 'GET' && pathname === '/api/session') {
      return sendJson(response, 200, {
        user: user ? publicUser(user) : null, demoMode, demoAccounts, juryDemo,
        config: user ? ruleConfig(store.read(), user.officeId) : null,
      });
    }
    if (method === 'POST' && pathname === '/api/login') return login(request, response, await parseBody(request));
    if (method === 'POST' && pathname === '/api/logout') {
      sessions.delete(tokenFrom(request));
      response.setHeader('Set-Cookie', cookie('', secure, 0));
      return sendJson(response, 200, { ok: true });
    }
    if (!user) throw problem(401, 'Zaloguj się, aby kontynuować.');

    if (juryDemo && method === 'POST' && pathname === '/api/cases/demo-ocena/jury-trial') {
      assertRole(user,'manager');
      const body = await parseBody(request,4096);
      const record = await store.write(state => {
        const previous = getRecord(state,'demo-ocena',user);
        const next = advanceJuryTrial(previous,body);
        state.cases[state.cases.indexOf(previous)] = next;
        return next;
      });
      return sendJson(response,200,{record:forViewer(record,user)});
    }
    if (method === 'GET' && pathname === '/api/people') {
      assertRole(user, 'manager', 'hr');
      const state = store.read();
      const people = accounts.filter(person => person.officeId === user.officeId && person.role === 'employee')
        .filter(person => user.role === 'hr' || supervisorId(state,person) === user.id)
        .map(person => ({...publicUser(person), ...(user.role === 'hr' ? {directManagerId:supervisorId(state,person)} : {})}));
      const managers = user.role === 'hr' ? accounts.filter(person => person.officeId === user.officeId && person.role === 'manager').map(publicUser) : [];
      return sendJson(response, 200, { people, managers });
    }
    if (method === 'PATCH' && pathname === '/api/people/supervisor') {
      assertRole(user, 'hr');
      const {employeeId,managerId} = await parseBody(request);
      const localPeople = accounts.filter(item => item.officeId === user.officeId);
      if (!localPeople.some(item => item.role === 'employee' && item.id === employeeId)
        || !localPeople.some(item => item.role === 'manager' && item.id === managerId)) {
        throw problem(400,'Wybierz pracownika i bezpośredniego przełożonego z tego urzędu.');
      }
      await store.write(state => {
        state.supervisors ??= {};
        Object.defineProperty(state.supervisors,employeeId,{value:{managerId,by:user.id,at:new Date().toISOString()},enumerable:true,configurable:true,writable:true});
      });
      return sendJson(response,200,{employeeId,managerId});
    }
    if (method === 'GET' && pathname === '/api/statistics') {
      assertRole(user, 'hr', 'director');
      return sendJson(response, 200, { statistics: getStatistics(store.read(), user, demoMode) });
    }
    if (method === 'GET' && pathname === '/api/config') {
      return sendJson(response, 200, { config: ruleConfig(store.read(), user.officeId) });
    }
    if (method === 'PATCH' && pathname === '/api/config') {
      assertRole(user, 'hr');
      const { config } = await parseBody(request);
      if (!config || typeof config !== 'object' || Array.isArray(config)) throw problem(400, 'Wprowadź konfigurację reguł.');
      if (!demoMode) throw problem(403, 'Zmiana reguł wymaga aktualizacji zatwierdzonego pakietu przepisów.');
      const result = await store.write(state => {
        const current = ruleConfig(state, user.officeId);
        const months = Number(config.months ?? current.months);
        const maxAdditional = Number(config.maxAdditional ?? current.maxAdditional);
        if (!Number.isInteger(months) || months < 1 || months > 60 || !Number.isInteger(maxAdditional) || maxAdditional < 0 || maxAdditional > 3) {
          throw problem(400, 'Zmień cykl na 1–60 miesięcy i limit od 0 do 3 kryteriów dodatkowych.');
        }
        const next = { ...current, months, maxAdditional, version: `${RULESET.version}/symulacja-${Date.now()}`, simulation: true };
        Object.defineProperty(state.officeConfigs, user.officeId, { value: next, enumerable: true, configurable: true });
        return next;
      });
      return sendJson(response, 200, { config: result });
    }
    if (method === 'GET' && pathname === '/api/cases') {
      const cases = store.read().cases.filter(record => hasAccess(record, user)).map(record => forViewer(record, user));
      return sendJson(response, 200, { cases });
    }
    if (method === 'POST' && pathname === '/api/cases') {
      assertRole(user, 'manager');
      const body = await parseBody(request);
      const employee = accounts.find(account => account.id === body.employeeId && account.officeId === user.officeId && account.role === 'employee');
      if (!employee) throw problem(400, 'Wybierz pracownika z własnego urzędu.');
      const record = await store.write(state => {
        if (supervisorId(state,employee) !== user.id) throw problem(403,'Kadry muszą potwierdzić bezpośrednią podległość pracownika.');
        const next = createRecord(body, user, employee, ruleConfig(state, user.officeId));
        if (state.cases.some(item => item.officeId === user.officeId && item.employeeId === next.employeeId && item.startDate === next.startDate)) {
          throw problem(409, 'Dla tego pracownika i początku okresu istnieje już ocena.');
        }
        state.cases.push(next);
        return next;
      });
      return sendJson(response, 201, { record });
    }
    const agentRoute = pathname.match(/^\/api\/cases\/([A-Za-z0-9_-]+)\/meeting\/agent$/);
    if (agentRoute && method === 'POST') {
      assertRole(user, 'manager', 'employee');
      const record = getRecord(store.read(), agentRoute[1], user);
      const body = await parseBody(request, 4096);
      const answer = await answerMeeting(sharedMeeting(record, officeDate()), body, planner);
      const participant = signedIn(request);
      if (!participant) throw problem(401,'Zaloguj się ponownie.');
      const latest = getRecord(store.read(), agentRoute[1], participant);
      if (latest.version !== record.version) throw problem(409,'W międzyczasie zmieniono sprawę. Zadaj pytanie ponownie.');
      return sendJson(response, 200, {answer});
    }
    const meetingRoute = pathname.match(/^\/api\/cases\/([A-Za-z0-9_-]+)\/meeting$/);
    if (meetingRoute && method === 'GET') {
      assertRole(user, 'manager', 'employee');
      const record = getRecord(store.read(), meetingRoute[1], user);
      return sendJson(response, 200, { meeting:sharedMeeting(record, officeDate()), demoMode, aiConfigured:Boolean(planner) });
    }
    const deliveryRoute = pathname.match(/^\/api\/cases\/([A-Za-z0-9_-]+)\/delivery$/);
    if (deliveryRoute && method === 'POST') {
      assertRole(user,'manager','hr');
      const body = await parseBody(request);
      const record = await store.write(state => {
        const prior = getRecord(state,deliveryRoute[1],user);
        const next = recordDelivery(prior,body,user);
        state.cases[state.cases.indexOf(prior)] = next;
        return next;
      });
      return sendJson(response,200,{record:forViewer(record,user)});
    }
    const documentRoute = pathname.match(/^\/api\/cases\/([A-Za-z0-9_-]+)\/(official-docx|handoff\.zip|handoff\.eml|handoffs)$/);
    if (documentRoute && (method === 'GET' || method === 'POST')) {
      const [, id, format] = documentRoute;
      if (format === 'handoffs' && method === 'POST') {
        assertRole(user, 'manager', 'hr');
        const body = await parseBody(request);
        const record = await store.write(state => {
          const previous = getRecord(state, id, user);
          const next = recordHandoff(previous, body, user);
          state.cases[state.cases.indexOf(previous)] = next;
          return next;
        });
        return sendJson(response, 200, { record: forViewer(record, user) });
      }
      if (method !== 'GET' || format === 'handoffs') throw problem(405, 'Niedozwolona metoda.');
      const state = store.read();
      const record = getRecord(state, id, user);
      if (format === 'official-docx') {
        if (user.role !== 'manager' && !record.signatures.manager) throw problem(403, 'Urzędowy arkusz będzie dostępny po zatwierdzeniu treści przez przełożonego.');
        const { buildOfficialDocx } = await import('./lib/docx.mjs');
        const bytes = await buildOfficialDocx(forViewer(record, user));
        return download(response, bytes, docxType, `arkusz-${record.formType}.docx`);
      }
      assertRole(user, 'manager', 'hr');
      if (record.stage !== 'complete' || !record.signedFile) throw problem(409, 'Najpierw dołącz PDF do zakończonej oceny.');
      const signedPdf = await readSignedFile(signedDirectory, state.signedFileKeys[id], record.signedFile);
      if (format === 'handoff.zip') return download(response, archiveHandoff(record, signedPdf), 'application/zip', 'ocena-do-akt.zip');
      return download(response, mailDraft(signedPdf), 'message/rfc822', 'ocena-do-akt.eml');
    }
    const signedRoute = pathname.match(/^\/api\/cases\/([A-Za-z0-9_-]+)\/signed-file$/);
    if (signedRoute && method === 'POST') {
      assertRole(user, 'manager', 'hr');
      const id = signedRoute[1];
      getRecord(store.read(), id, user);
      const body = await parseBody(request, maxUploadJson);
      const upload = readUpload(body, user);
      let saved = false;
      let record;
      try {
        record = await store.write(async state => {
          const previous = getRecord(state, id, user);
          if (body.version !== undefined && body.version !== previous.version) {
            throw problem(409, 'Ocena zmieniła się od ostatniego odczytu. Odśwież widok.');
          }
          const next = attachSignedFile(previous, upload.metadata, user);
          await writeSignedFile(signedDirectory, upload);
          saved = true;
          state.signedFileKeys[id] = upload.key;
          state.cases[state.cases.indexOf(previous)] = next;
          return next;
        });
      } catch (error) {
        if (saved) await unlink(signedFilePath(signedDirectory, upload.key)).catch(() => {});
        throw error;
      }
      return sendJson(response, 201, { record: forViewer(record, user), signedFile: record.signedFile });
    }
    if (signedRoute && method === 'GET') {
      const state = store.read();
      const record = getRecord(state, signedRoute[1], user);
      if (!record.signedFile || record.stage !== 'complete' || !record.signatures.manager) {
        throw problem(404, 'Nie ma podpisanego arkusza do pobrania.');
      }
      const bytes = await readSignedFile(signedDirectory, state.signedFileKeys[record.id], record.signedFile);
      return download(response, bytes, 'application/pdf', '', attachmentDisposition(record.signedFile, record.id));
    }
    const found = pathname.match(/^\/api\/cases\/([A-Za-z0-9_-]+)$/);
    if (found && method === 'GET') {
      return sendJson(response, 200, { record: forViewer(getRecord(store.read(), found[1], user), user) });
    }
    if (found && method === 'PATCH') {
      const body = await parseBody(request);
      const record = await store.write(state => {
        const previous = getRecord(state, found[1], user);
        if (previous.version !== body.version) throw problem(409, 'Ocena zmieniła się od ostatniego odczytu. Odśwież widok.');
        const employee = accounts.find(account => account.id === previous.employeeId && account.officeId === user.officeId && account.role === 'employee');
        const approved = supervisorId(state, employee);
        const replacementManager = user.role === 'hr' && approved && approved === body.changes?.managerId
          && accounts.find(account => account.id === approved && account.officeId === user.officeId && account.role === 'manager');
        const next = changeRecord(previous, body.changes, user, replacementManager);
        state.cases[state.cases.indexOf(previous)] = next;
        return next;
      });
      return sendJson(response, 200, { record: forViewer(record, user) });
    }
    throw problem(404, 'Nie znaleziono tej funkcji.');
  }

  const server = createServer(async (request, response) => {
    commonHeaders(response);
    try {
      authorizeOrigin(request, host, origin);
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname.startsWith('/api/')) await handleApi(request, response, pathname);
      else await serveStatic(request, response, pathname);
    } catch (error) {
      if (response.headersSent) return response.destroy();
      if (!error.status) console.error(error.message);
      const status = error.status || 500;
      sendJson(response, status, { error: status === 500 ? 'Wystąpił błąd serwera.' : error.message, details: error.details });
    }
  });
  return { server, demoMode, filename, host };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { server, host, demoMode, filename } = await createApplication();
  const port = Number(process.env.DSO_PORT ?? process.env.PORT ?? 4173);
  server.listen(port, host, () => {
    console.log(`Druga Strona Oceny: http://${host.includes(':') ? `[${host}]` : host}:${server.address().port}`);
    console.log(`${demoMode ? 'Baza demonstracyjna' : 'Baza ocen'}: ${filename}`);
  });
}

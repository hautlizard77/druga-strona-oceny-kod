import { randomUUID } from 'node:crypto';
import { addDays, buildAction, CASE_TYPES, evaluateRules, formsFor, newCase, observationInPeriod, observationPeriod, RULESET, STAGES } from '../public/domain.mjs';
import { baselineWindow, OBSTACLES } from '../public/trials.mjs';

const managerFields = new Set([
  'title', 'position', 'positionType', 'startDate', 'stage', 'criteria', 'evidence', 'events',
  'startMeeting', 'reviewMeeting', 'outcome', 'formDetails', 'action', 'signatures',
]);
const employeeFields = new Set(['contexts', 'startMeeting', 'signatures', 'action']);
const hrFields = new Set(['events', 'managerId', 'managerChangeDate']);
const finalFields = new Set(['action', 'signatures']);
const stages = STAGES.map(({ id }) => id);
const eventTypes = new Set(CASE_TYPES.map(({ id }) => id));
const trialOptions = new Set(['priorities', 'workload', 'custom']);
const obstacles = new Set(OBSTACLES.map(({ id }) => id));

export function problem(status, message, details) {
  return Object.assign(new Error(message), { status, details });
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function string(value, max = 2000) {
  if (typeof value !== 'string' || value.length > max) {
    throw problem(400, `Wpisz tekst o długości najwyżej ${max} znaków.`);
  }
  return value.trim();
}

function date(value, { optional = false } = {}) {
  if (optional && (value === '' || value == null)) return '';
  const result = string(value, 10);
  const parsed = new Date(`${result}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== result) {
    throw problem(400, 'Wprowadź poprawną datę w formacie RRRR-MM-DD.');
  }
  return result;
}

function limitedList(value, max) {
  if (!Array.isArray(value) || value.length > max || value.some(item => !isObject(item))) {
    throw problem(400, `Lista może mieć najwyżej ${max} poprawnych elementów.`);
  }
  return value;
}

function coreFields(value, previous = {}, max = 40) {
  if (!isObject(value) || Object.keys(value).length > max) throw problem(400, 'Nieprawidłowy zestaw pól.');
  const result = { ...previous };
  for (const [key, field] of Object.entries(value)) {
    if (!/^[a-z][a-z0-9]{0,39}$/i.test(key) || ['constructor', 'prototype'].includes(key)) {
      throw problem(400, 'Nieprawidłowa nazwa pola.');
    }
    if (field === null || typeof field === 'boolean' || (typeof field === 'number' && Number.isFinite(field))) {
      result[key] = field;
    } else {
      result[key] = string(field);
    }
  }
  return result;
}

function appearance(value, allowed, defaults = {}) {
  if (!isObject(value)) throw problem(400, 'Nieprawidłowy format danych.');
  return coreFields(Object.fromEntries(Object.entries(value).filter(([key]) => allowed.includes(key))), defaults);
}

function stamp(user) {
  const at = new Date().toISOString();
  return { by: user.id, name: user.name, at, signedAt: at, date: officeDate() };
}

function audit(record, user, type, summary, details) {
  record.history.push({ id: randomUUID(), type, summary, actorId: user.id, action: summary, ...stamp(user), details });
}

export function officeDate() {
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' });
  return date.format(new Date());
}

export function hasAccess(record, user) {
  if (record.officeId !== user.officeId) return false;
  if (user.role === 'manager') return record.managerId === user.id;
  if (user.role === 'employee') return record.employeeId === user.id;
  return user.role === 'hr';
}

export function forViewer(record, user) {
  const rules = evaluateRules(record);
  const openingDeadline = ['setup', 'start'].includes(record.stage) ? rules.openingDeadline : null;
  const period = observationPeriod(record);
  const eligible = new Set(record.evidence.filter(entry => observationInPeriod(entry,period)).map(entry => entry.id));
  const criteria = record.criteria.map(item => ({...item,evidenceIds:(item.evidenceIds ?? []).filter(id => eligible.has(id))}));
  record = {...record, criteria, observationEnd:period.end, dueDate:rules.positionWindow?.to || record.dueDate, positionWindow:rules.positionWindow, appealDeadline:rules.appealDeadline};
  if (user.role === 'manager') return { ...record, openingDeadline };
  const signed = Boolean(record.signatures.manager);
  const openingFields = formsFor(record)[record.formType]?.fields.filter(item => item.section === 'I') ?? [];
  const sharedOpening = user.role === 'employee' && record.startMeeting.signedManager
    ? Object.fromEntries(openingFields.map(({key}) => [key,record.formDetails[key]])) : {};
  const allowedEvidence = user.role === 'employee' ? record.evidence.filter(item => item.shared) : [];
  const evidenceIds = new Set(allowedEvidence.map(item => item.id));
  return {
    ...record,
    openingDeadline,
    evidence: allowedEvidence,
    contexts: user.role === 'employee' ? record.contexts.filter(item => evidenceIds.has(item.evidenceId)) : [],
    criteria: record.criteria.map(item => ({
      name: item.name,
      required: item.required,
      score: signed ? item.score : null,
      justification: signed ? item.justification : '',
      evidenceIds: (item.evidenceIds || []).filter(id => evidenceIds.has(id)),
    })),
    events: user.role === 'hr' ? record.events : record.events.map(({ id, type, date, endDate, newDueDate, noticeReference, noticeDate }) => ({ id, type, date, endDate, newDueDate, noticeReference, noticeDate })),
    startMeeting: { ...record.startMeeting, ...(user.role === 'employee' ? {} : { notes: '' }) },
    reviewMeeting: { ...record.reviewMeeting, notes: '' },
    outcome: signed ? record.outcome : { summary: '', development: '', serviceDegree: '' },
    formDetails: signed ? record.formDetails : sharedOpening,
    action: user.role === 'employee' && signed ? record.action : null,
    actionHistory: user.role === 'employee' && signed ? record.actionHistory : undefined,
    handoffs: user.role === 'hr' ? record.handoffs : (record.handoffs ?? []).map(({date}) => ({date})),
    history: user.role === 'hr' ? record.history.map(({ id, type, summary, by, actorId, action, name, at, details }) =>
      ({ id, type, summary, by, actorId, action, name, at, ...(['copy-delivered','delivery-corrected','due-date-changed'].includes(type) ? {details} : {}) })) : [],
  };
}

export function createRecord(body, user, employee, ruleset) {
  const startDate = date(body.startDate || officeDate());
  const positionType = body.positionType || 'C';
  if (!['A', 'B', 'C'].includes(positionType)) throw problem(400, 'Wybierz arkusz A, B lub C.');
  const record = newCase({
    id: randomUUID(),
    employeeId: employee.id,
    employeeName: employee.name,
    managerId: user.id,
    managerName: user.name,
    office: user.officeName,
    officeId: user.officeId,
    position: string(body.position || '', 200),
    positionType,
    startDate,
    ruleSnapshot: ruleset,
  });
  const next = {
    ...record,
    officeId: user.officeId,
    version: 1,
    title: string(body.title || '', 200),
  };
  audit(next, user, 'created', 'Otwarto ocenę okresową');
  return next;
}

export function attachSignedFile(record, metadata, user) {
  if (record.stage !== 'complete' || !record.signatures.manager || !record.signatures.employee) {
    throw problem(409, 'Najpierw zapisz oba potwierdzenia oceny.');
  }
  if (record.signedFile) throw problem(409, 'Podpisany arkusz został już dołączony.');
  const next = { ...record, signedFile: metadata, version: record.version + 1 };
  audit(next, user, 'signed-file', 'Dołączono podpisany arkusz z obiegu urzędu');
  return next;
}

export function recordHandoff(record, body, user) {
  if (record.stage !== 'complete' || !record.signedFile) throw problem(409, 'Najpierw dołącz PDF do zakończonej oceny.');
  if (body.channel !== 'ezd' && body.channel !== 'mail') throw problem(400, 'Wybierz sposób przekazania dokumentu.');
  const reference = string(body.reference, 160);
  if (!reference || /[\p{Cc}\p{Cf}]/u.test(reference)) throw problem(400, 'Wpisz sygnaturę sprawy lub identyfikator potwierdzenia.');
  const existing = record.handoffs ?? [];
  if (existing.some(entry => entry.channel === body.channel && entry.reference === reference)) return record;
  if (body.version !== record.version) throw problem(409, 'Ocena zmieniła się od ostatniego odczytu. Odśwież widok.');
  if (existing.length >= 20) throw problem(409, 'Osiągnięto maksymalną liczbę wpisów przekazania.');
  const entry = { id: randomUUID(), channel: body.channel, reference, ...stamp(user) };
  const next = { ...record, handoffs: [...existing, entry], history: [...record.history], version: record.version + 1 };
  audit(next, user, 'handoff-recorded', 'Zarejestrowano przekazanie dokumentu do akt');
  return next;
}

export function recordDelivery(record, body, user) {
  if (record.stage !== 'complete' || !record.signedFile) throw problem(409,'Najpierw dołącz podpisany arkusz.');
  if (record.version !== body.version) throw problem(409,'Ocena zmieniła się od ostatniego odczytu.');
  const deliveredOn = date(body.deliveredOn);
  const acknowledgedOn = date(body.acknowledgedOn,{optional:true});
  const prepared = record.formDetails?.assessmentDate || record.signatures?.manager?.date || record.signatures?.manager?.at?.slice(0,10)
    || (typeof record.signatures?.manager === 'string' ? record.signatures.manager.slice(0,10) : '');
  if (!addDays(prepared,0)) throw problem(409,'Brakuje daty sporządzenia oceny. Zweryfikuj archiwalny arkusz w obiegu urzędu.');
  for (const [field,value] of Object.entries({deliveredOn,acknowledgedOn})) {
    if (value && (value > officeDate() || value < prepared)) {
      const message = `Wprowadź datę między sporządzeniem oceny (${prepared}) a dniem dzisiejszym.`;
      throw problem(422,message,[{field,message}]);
    }
  }
  const previous = record.delivery && {deliveredOn:record.delivery.deliveredOn,acknowledgedOn:record.delivery.acknowledgedOn};
  if (previous?.deliveredOn === deliveredOn && (previous.acknowledgedOn || '') === acknowledgedOn) return record;
  const reason = string(body.reason ?? '',500);
  if (previous && !reason) throw problem(422,'Podaj powód korekty.',[{field:'reason',message:'Podaj powód korekty.'}]);
  const next = {...record,version:record.version+1,history:[...record.history],
    delivery:{deliveredOn,acknowledgedOn,...stamp(user)}};
  audit(next,user,previous ? 'delivery-corrected' : 'copy-delivered',previous ? 'Skorygowano daty doręczenia lub zapoznania' : 'Zapisano doręczenie kopii',
    {previous,current:{deliveredOn,acknowledgedOn},reason});
  return next;
}

function safeEvidence(value, record, user) {
  const known = new Map(record.evidence.map(item => [item.id, item]));
  const seen = new Set();
  const result = limitedList(value, 500).map(item => {
    const id = item.id ? string(item.id, 100) : randomUUID();
    if (seen.has(id)) throw problem(400, 'Każda obserwacja musi mieć osobny identyfikator.');
    seen.add(id);
    const text = string(item.text);
    if (!text) throw problem(400, 'Wpisz treść obserwacji.');
    return {
      id,
      date: date(item.date),
      text,
      criterion: string(item.criterion || '', 180),
      shared: item.shared === true,
      tone: ['concern', 'positive', 'neutral'].includes(item.tone) ? item.tone : 'neutral',
      authorId: known.get(id)?.authorId || user.id,
    };
  });
  if (record.contexts.some(item => !seen.has(item.evidenceId))) {
    throw problem(409, 'Zachowaj obserwacje, do których pracownik dodał odpowiedź.');
  }
  return result;
}

function safeEvents(value) {
  const seen = new Set();
  return limitedList(value, 100).map(item => {
    const id = item.id ? string(item.id, 100) : randomUUID();
    if (seen.has(id) || !eventTypes.has(item.type)) throw problem(400, 'Wybierz poprawny rodzaj zdarzenia kadrowego.');
    seen.add(id);
    const start = date(item.date);
    const end = date(item.endDate, { optional: true });
    if (end && end < start) throw problem(400, 'Data końcowa musi przypadać po dacie początkowej.');
    const newDueDate = date(item.newDueDate,{optional:true});
    const noticeDate = date(item.noticeDate,{optional:true});
    const noticeReference = string(item.noticeReference ?? '',160);
    if (Boolean(noticeDate) !== Boolean(noticeReference) || (noticeDate && noticeDate > officeDate())) {
      throw problem(422,'Podaj datę i sygnaturę zawiadomienia. Data nie może być przyszła.');
    }
    return { ...coreFields(item), id, type: item.type, date: start, endDate: end, newDueDate, noticeDate, noticeReference, note: string(item.note || '') };
  });
}

function safeCriteria(value) {
  const seen = new Set();
  return limitedList(value, 30).map(item => {
    const name = string(item.name, 180);
    if (!name || seen.has(name)) throw problem(400, 'Kryteria muszą wystąpić pojedynczo.');
    seen.add(name);
    if (item.score != null && item.score !== '' && ![1, 3, 5, 7, 9].includes(Number(item.score))) {
      throw problem(400, 'Wybierz ocenę z obowiązującej skali.');
    }
    const ids = item.evidenceIds || [];
    if (!Array.isArray(ids) || ids.length > 100) throw problem(400, 'Nieprawidłowa lista obserwacji przy kryterium.');
    return {
      name,
      required: item.required === true,
      score: item.score == null || item.score === '' ? null : Number(item.score),
      justification: string(item.justification || ''),
      evidenceIds: [...new Set(ids.map(id => string(id, 100)))],
    };
  });
}

function addContexts(record, items, user) {
  const known = new Set(record.contexts.map(item => item.id));
  const shared = new Set(record.evidence.filter(item => item.shared).map(item => item.id));
  for (const item of limitedList(items, 200)) {
    if (known.has(item.id)) continue;
    if (!shared.has(item.evidenceId)) throw problem(403, 'Można odpowiedzieć na udostępnioną obserwację.');
    const text = string(item.text);
    if (!text) throw problem(400, 'Wpisz odpowiedź do obserwacji.');
    const id = item.id ? string(item.id, 100) : randomUUID();
    known.add(id);
    record.contexts.push({ id, evidenceId: item.evidenceId, text, date: officeDate(), authorId: user.id });
  }
  if (record.contexts.length > 200) throw problem(400, 'Osiągnięto maksymalną liczbę odpowiedzi.');
}

function safeMeeting(record, key, value, user) {
  if (!isObject(value)) throw problem(400, 'Nieprawidłowy przebieg rozmowy.');
  const prior = record[key] || {};
  if (user.role === 'employee') {
    if (key !== 'startMeeting' || record.stage !== 'start' || !value.signedEmployee || !prior.signedManager) {
      throw problem(409, 'Najpierw przełożony potwierdza rozmowę początkową.');
    }
    return { ...prior, signedEmployee: prior.signedEmployee || stamp(user) };
  }
  const next = appearance(value, ['date', 'notes', 'location'], prior);
  if (key === 'startMeeting' && 'goals' in value) next.goals = string(value.goals,2000);
  if (key === 'startMeeting' && 'duties' in value) next.duties = string(value.duties,1000);
  if ('date' in value) next.date = date(value.date, { optional: true });
  if (key === 'startMeeting' && value.signedManager) {
    if (record.stage !== 'start' || !next.date) throw problem(409, 'Otwórz etap rozmowy początkowej i uzupełnij jej datę.');
    next.signedManager ||= stamp(user);
  }
  return next;
}

const customTrialFields = { label: 160, description: 1000, owner: 200, metric: 200, development: 1000 };
const setupTrialFields = ['startDate', 'reviewDate', 'baseline', 'baselineTotal', 'baselineFrom', 'baselineTo', 'targetRate', 'obstacle'];
const resultTrialFields = ['status', 'followUp', 'followUpTotal', 'note', 'decision', 'outcome'];
const completedTrial = action => Boolean(action && (action.status === 'completed' || action.status === 'complete' || action.followUp != null));

function trialMeasure(action, countKey, totalKey) {
  const count = action[countKey];
  const total = action[totalKey];
  if (count != null && (!Number.isSafeInteger(count) || count < 0)) throw problem(400, 'Wpisz nieujemną liczbę całkowitą zdarzeń.');
  if (total == null) return; // Records created before the denominator fields used counts only.
  if (!Number.isSafeInteger(total) || total <= 0 || count == null || count > total) {
    throw problem(400, 'Liczba wszystkich spraw musi być dodatnia i nie mniejsza od liczby zdarzeń.');
  }
}

function trialSetup(record, value, prior, previous, repeating) {
  const custom = value.optionId === 'custom';
  const action = prior ? { ...prior } : buildAction(custom ? 'priorities' : value.optionId, record);
  if (custom) {
    action.optionId = 'custom';
    action.ownerRole = 'custom';
    for (const [key, max] of Object.entries(customTrialFields)) {
      const fallback = previous?.optionId === 'custom' ? previous[key] : '';
      action[key] = string(repeating && key === 'metric' ? (previous.metric ?? '') : (value[key] ?? fallback ?? ''), max);
      if (!action[key] && key !== 'development') throw problem(400, 'Uzupełnij nazwę, opis, osobę odpowiedzialną i miernik własnego działania.');
    }
  } else if (action.ownerRole === 'coordinator') {
    if (value.owner != null) {
      const coordinator = string(value.owner, 200);
      if (coordinator && coordinator !== record.managerName) action.owner = coordinator;
    }
  } else {
    action.owner = record.managerName || action.owner;
  }

  const next = appearance(value, setupTrialFields, action);
  const supplied = value.metricDefinition;
  if (supplied !== undefined && !isObject(supplied)) throw problem(400,'Podaj pełną definicję miernika.');
  const definition = repeating && previous.metricDefinition ? previous.metricDefinition
    : supplied ?? (prior ? prior.metricDefinition : custom ? null : action.metricDefinition);
  if (definition) {
    next.metricDefinition = Object.fromEntries(['event','population','source'].map(key => [key,string(definition[key] ?? '',300)]));
    if (!Object.values(next.metricDefinition).every(Boolean)) throw problem(422,'Uzupełnij zdarzenie, mianownik i źródło danych.');
    if (prior && JSON.stringify(next.metricDefinition) !== JSON.stringify(prior.metricDefinition)
      && (!Object.hasOwn(value,'baseline') || !Object.hasOwn(value,'baselineTotal'))) {
      throw problem(409,'Po zmianie definicji wpisz od nowa licznik i mianownik pomiaru bazowego.');
    }
  } else if (!prior) {
    throw problem(422,'Uzupełnij zdarzenie, mianownik i źródło danych.');
  }
  next.startDate = date(value.startDate ?? (repeating ? officeDate() : action.startDate));
  if (repeating && next.startDate < previous.reviewDate) throw problem(400, 'Kolejna próba może rozpocząć się po okresie poprzedniego pomiaru.');
  const days = record.ruleSnapshot?.trialDays ?? RULESET.trialDays;
  next.reviewDate = addDays(next.startDate, days);
  if ('reviewDate' in value && date(value.reviewDate) !== next.reviewDate) throw problem(400, 'Termin sprawdzenia musi odpowiadać długości próby.');
  const defaultDates = baselineWindow(next.startDate, days);
  const priorDates = prior && prior.startDate === next.startDate ? prior : {};
  next.baselineFrom = date(value.baselineFrom ?? priorDates.baselineFrom ?? defaultDates.baselineFrom);
  next.baselineTo = date(value.baselineTo ?? priorDates.baselineTo ?? defaultDates.baselineTo);
  if (next.baselineFrom > next.baselineTo || next.baselineTo >= next.startDate) throw problem(400, 'Okres bazowy musi się kończyć przed rozpoczęciem próby.');

  if (repeating) {
    next.metric = previous.metric;
    next.obstacle = previous.obstacle ?? (previous.optionId === 'custom' ? 'other' : previous.optionId);
    if (!Object.hasOwn(value, 'targetRate') && previous.targetRate != null) next.targetRate = previous.targetRate;
  } else {
    next.obstacle = value.obstacle ?? prior?.obstacle ?? (custom ? 'other' : value.optionId);
  }
  if (!obstacles.has(next.obstacle)) throw problem(400, 'Wybierz rodzaj przeszkody organizacyjnej.');
  if (next.targetRate != null && (!Number.isFinite(next.targetRate) || next.targetRate < 0 || next.targetRate > 100)) {
    throw problem(400, 'Docelowy odsetek musi mieścić się od 0 do 100 procent.');
  }
  trialMeasure(next, 'baseline', 'baselineTotal');
  return next;
}

function safeAction(value, record) {
  const previous = record.action;
  const isCompleted = completedTrial(previous);
  if (value === null) {
    if (isCompleted || previous?.employeeComment) throw problem(409, 'Zachowaj zakończoną próbę lub próbę z opinią pracownika.');
    return null;
  }
  if (!isObject(value) || !trialOptions.has(value.optionId)) throw problem(400, 'Wybierz dostępne działanie organizacyjne.');
  if (!['review', 'sign', 'complete'].includes(record.stage)) throw problem(409, 'Najpierw otwórz rozmowę oceniającą.');
  const repeating = value.repeat === true;
  if (repeating && !isCompleted) throw problem(409, 'Zakończ bieżącą próbę przed rozpoczęciem kolejnej.');
  if (!repeating && isCompleted) throw problem(409, 'Zakończona próba jest zapisana w historii. Rozpocznij kolejną próbę.');

  const prior = !repeating && previous?.optionId === value.optionId ? previous : null;
  if (!repeating && !prior && previous?.employeeComment) throw problem(409, 'Zachowaj bieżącą próbę z opinią pracownika.');
  const next = trialSetup(record, value, prior, previous, repeating);
  const action = appearance(value, resultTrialFields, next);
  if (!['active', 'completed'].includes(action.status)) throw problem(400, 'Wybierz dostępny stan działania.');
  trialMeasure(action, 'followUp', 'followUpTotal');
  if (action.followUp != null || action.status === 'completed') {
    if (!prior || prior.startDate !== action.startDate) throw problem(409, 'Sprawdź wynik wcześniej rozpoczętego działania.');
    if (officeDate() < action.reviewDate) throw problem(409, 'Wynik zapisz po upływie terminu weryfikacji.');
    if (action.followUp == null || action.status !== 'completed') throw problem(400, 'Zakończ działanie i wpisz wynik razem.');
    const methodFields = [...setupTrialFields, ...Object.keys(customTrialFields)];
    if (Object.hasOwn(value,'metricDefinition') && JSON.stringify(action.metricDefinition) !== JSON.stringify(prior.metricDefinition)) {
      throw problem(409,'Przy zapisie wyniku zachowaj definicję miernika z rozpoczętej próby.');
    }
    if (methodFields.some(key => Object.hasOwn(value, key) && prior[key] != null && action[key] !== prior[key])) {
      throw problem(409, 'Zapisz ewentualną zmianę miernika przed zapisem wyniku lub rozpocznij kolejną próbę.');
    }
    if (prior.baselineTotal != null && action.followUpTotal == null) throw problem(400, 'Podaj liczbę wszystkich spraw po zmianie.');
    action.completedAt = new Date().toISOString();
  }
  if (repeating) record.actionHistory = [...(record.actionHistory ?? []), previous];
  return action;
}

function applyTrialChange(record, value, user) {
  if (user.role !== 'employee') {
    record.action = safeAction(value, record);
    if (value?.repeat) return 'Rozpoczęto kolejną próbę działania';
    if (record.action?.status === 'completed') return 'Zapisano pomiar i decyzję po próbie działania';
    return 'Zaktualizowano próbę działania';
  }
  if (!record.signatures.manager || !record.action || !isObject(value) || Object.keys(value).some(key => key !== 'employeeComment')) {
    throw problem(403, 'Dodaj komentarz do udostępnionego działania.');
  }
  record.action.employeeComment = string(value.employeeComment);
  return 'Zapisano perspektywę pracownika o działaniu';
}

function validateAdvance(record, previousStage, rules) {
  const nextIndex = stages.indexOf(record.stage);
  const before = stages.indexOf(previousStage);
  if (nextIndex < before || nextIndex > before + 1) throw problem(409, 'Przejdź kolejno przez wszystkie etapy oceny.');
  if (nextIndex === before) return;
  const issues = rules.issues.filter(item => item.stage === previousStage);
  if (issues.length) throw problem(422, issues[0].message, issues);
}

function resetOpeningIfItsContentChanged(previous, next, signedAgain, user) {
  const selected = record => record.criteria.map(({ name, required }) => `${required}:${name}`).sort().join('|');
  const openingFields = formsFor(previous)[previous.formType]?.fields.filter(item => item.section === 'I') ?? [];
  const editedOpeningField = previous.managerId === next.managerId && openingFields.some(({key}) => previous.formDetails?.[key] !== next.formDetails?.[key]);
  const changedBeforeConfirmation = !previous.startMeeting.signedEmployee && evaluateRules(previous).dueDate !== evaluateRules(next).dueDate;
  const changed = previous.startDate !== next.startDate || previous.formType !== next.formType || previous.position !== next.position ||
    previous.startMeeting.date !== next.startMeeting.date || previous.startMeeting.location !== next.startMeeting.location ||
    previous.startMeeting.notes !== next.startMeeting.notes || previous.startMeeting.goals !== next.startMeeting.goals ||
    previous.startMeeting.duties !== next.startMeeting.duties || selected(previous) !== selected(next) ||
    (!previous.startMeeting.signedEmployee && editedOpeningField) || changedBeforeConfirmation;
  const known = new Set(previous.events.map(item => item.id));
  const newPositionChanges = next.events.filter(item => item.type === 'position-change' && !known.has(item.id));
  const needsNewMeeting = newPositionChanges.length > 0 && evaluateRules({ ...next, events: newPositionChanges }).notices.some(item => item.code === 'position-reopen');
  if (!needsNewMeeting && !(previous.startMeeting.signedManager && changed)) return false;

  next.startMeeting.signedEmployee = null;
  next.startMeeting.signedManager = signedAgain ? stamp(user) : null;
  const openingStage = stages.indexOf('start');
  if (stages.indexOf(previous.stage) >= openingStage || stages.indexOf(next.stage) >= openingStage) next.stage = 'start';
  return true;
}

function applySignature(record, value, user, rules) {
  if (!isObject(value) || !value[user.role] || !['manager', 'employee'].includes(user.role)) {
    throw problem(400, 'Potwierdź własny etap podpisania.');
  }
  if (record.stage !== 'sign' && record.stage !== 'complete') throw problem(409, 'Otwórz etap podpisania.');
  if (record.signatures[user.role]) return;
  if (user.role === 'manager') {
    const issues = rules.issues.filter(item => ['setup', 'start', 'review'].includes(item.stage));
    if (issues.length) throw problem(422, issues[0].message, issues);
    record.formDetails.assessmentDate ||= officeDate();
  } else if (!record.signatures.manager) {
    throw problem(409, 'Najpierw przełożony zatwierdza treść oceny.');
  }
  record.signatures[user.role] = stamp(user);
  if (record.signatures.manager && record.signatures.employee) record.stage = 'complete';
}

export function captureOpening(record) {
  const {office,position,dueDate,formType,managerName,employeeName,startMeeting,formDetails,criteria} = record;
  const fields = formsFor(record)[formType].fields.filter(field => field.section === 'I');
  return structuredClone({office,position,dueDate,formType,managerName,employeeName,startMeeting,
    formDetails:Object.fromEntries(fields.map(({key}) => [key,formDetails[key]])),
    criteria:criteria.map(({name,required}) => ({name,required}))});
}

export function changeRecord(record, changes, user, replacementManager) {
  if (!isObject(changes) || !Object.keys(changes).length) throw problem(400, 'Przekaż zmiany do zapisania.');
  const permitted = user.role === 'manager' ? managerFields : user.role === 'employee' ? employeeFields : hrFields;
  const keys = Object.keys(changes);
  const forbidden = keys.some(key => !permitted.has(key));
  if (forbidden) throw problem(403, 'Twoja rola nie może zmieniać tych pól.');
  if (record.signatures.manager && keys.some(key => !finalFields.has(key))) {
    throw problem(409, 'Treść potwierdzonej oceny jest zamknięta.');
  }
  const next = structuredClone(record);
  if (keys.length === 1 && keys[0] === 'action') {
    const summary = applyTrialChange(next, changes.action, user);
    next.version += 1;
    audit(next, user, 'updated', summary, keys);
    return next;
  }
  if ('title' in changes) next.title = string(changes.title, 200);
  if ('position' in changes) next.position = string(changes.position, 200);
  if ('positionType' in changes) {
    if (!['A', 'B', 'C'].includes(changes.positionType)) throw problem(400, 'Wybierz arkusz A, B lub C.');
    if (next.positionType !== changes.positionType && !('criteria' in changes)) {
      next.criteria = formsFor(next)[changes.positionType].requiredCriteria.map(name => ({ name, required: true, score: null, justification: '', evidenceIds: [] }));
    }
    next.positionType = changes.positionType;
    next.formType = changes.positionType;
  }
  if ('startDate' in changes) next.startDate = date(changes.startDate);
  if ('stage' in changes) {
    if (!stages.includes(changes.stage)) throw problem(400, 'Wybierz dostępny etap oceny.');
    if (changes.stage === 'complete' && !next.signatures.employee) throw problem(409, 'Zamknięcie wymaga potwierdzenia przez obie strony.');
    next.stage = changes.stage;
  }
  if ('criteria' in changes) next.criteria = safeCriteria(changes.criteria);
  if ('evidence' in changes) next.evidence = safeEvidence(changes.evidence, record, user);
  if ('events' in changes) next.events = safeEvents(changes.events);
  if ('managerId' in changes) {
    if (!replacementManager || replacementManager.id === record.managerId) throw problem(400, 'Wybierz nową osobę oceniającą z tego urzędu.');
    const changeDate = date(changes.managerChangeDate || officeDate());
    if (changeDate > officeDate() || changeDate < next.startDate) throw problem(400, 'Data przejęcia oceny musi przypadać między początkiem okresu a dniem dzisiejszym.');
    next.managerId = replacementManager.id;
    next.managerName = replacementManager.name;
    const [firstName, ...lastNames] = next.managerName.split(/\s+/);
    if (next.startMeeting.signedManager && !next.openingManagerSnapshot) {
      const { managerFirstName, managerLastName, managerPosition, managerUnit } = next.formDetails;
      next.openingManagerSnapshot = { managerFirstName, managerLastName, managerPosition, managerUnit, managerName: record.managerName };
    }
    Object.assign(next.formDetails, { managerFirstName: firstName, managerLastName: lastNames.join(' '), managerPosition: '', managerUnit: '' });
    const event = next.events.findLast(item => item.type === 'manager-change' && item.date === changeDate);
    const transfer = { previousManagerId: record.managerId, newManagerId: next.managerId };
    if (event) Object.assign(event, transfer);
    else next.events.push({ id: randomUUID(), type: 'manager-change', date: changeDate, endDate: '', note: `${replacementManager.name} przejmuje ocenę.`, ...transfer });
  }
  if ('contexts' in changes) addContexts(next, changes.contexts, user);
  if ('startMeeting' in changes) next.startMeeting = safeMeeting(next, 'startMeeting', changes.startMeeting, user);
  if ('reviewMeeting' in changes) next.reviewMeeting = safeMeeting(next, 'reviewMeeting', changes.reviewMeeting, user);
  if ('outcome' in changes) next.outcome = coreFields(changes.outcome, next.outcome);
  if ('formDetails' in changes) next.formDetails = coreFields(changes.formDetails, next.formDetails);
  const trialSummary = 'action' in changes ? applyTrialChange(next, changes.action, user) : undefined;

  const resetOpening = resetOpeningIfItsContentChanged(record, next, changes.startMeeting?.signedManager && user.role === 'manager', user);
  if (resetOpening) {
    if (record.openingSnapshot) next.openingHistory = [...(record.openingHistory ?? []),record.openingSnapshot];
    else if (record.startMeeting.signedEmployee) {
      next.openingHistoryIncomplete = true;
      audit(next,user,'opening-unavailable','Brak archiwalnej wersji części I potwierdzonej przed ponowieniem rozmowy');
    }
    delete next.openingSnapshot;
    delete next.openingManagerSnapshot;
  }
  const rules = evaluateRules(next, next.ruleSnapshot);
  if ('reviewMeeting' in changes || 'formDetails' in changes) {
    const invalid = rules.issues.filter(item => item.code.endsWith('-chronology'));
    if (invalid.length) throw problem(422,invalid[0].message,invalid);
  }
  next.formType = rules.formType;
  next.dueDate = rules.dueDate;
  if (rules.criteria) next.criteria = rules.criteria;
  const period = observationPeriod(next);
  const eligible = new Set(next.evidence.filter(entry => observationInPeriod(entry,period)).map(entry => entry.id));
  if ('criteria' in changes && next.criteria.some(criterion => criterion.evidenceIds?.some(id => !eligible.has(id)))) {
    throw problem(422,'Do uzasadnienia można powiązać wyłącznie obserwacje z ocenianego okresu.');
  }
  next.criteria = next.criteria.map(criterion => ({...criterion,evidenceIds:(criterion.evidenceIds ?? []).filter(id => eligible.has(id))}));
  if (!record.startMeeting.signedEmployee && next.startMeeting.signedEmployee) next.openingSnapshot = captureOpening(next);
  if (record.dueDate !== next.dueDate) {
    audit(next,user,'due-date-changed','Zmieniono aktualny termin sporządzenia oceny',{previous:record.dueDate,current:next.dueDate});
  }
  if ('stage' in changes && !resetOpening) validateAdvance(next, record.stage, rules);
  if ('signatures' in changes) applySignature(next, changes.signatures, user, rules);
  next.version += 1;
  let summary = 'Zaktualizowano ocenę';
  if ('managerId' in changes) summary = 'Przekazano ocenę nowej osobie oceniającej';
  else if (resetOpening) summary = 'Zmieniono dane rozmowy początkowej. Trzeba ponowić potwierdzenia';
  else if ('signatures' in changes) summary = 'Potwierdzono ocenę';
  else if (next.stage !== record.stage) summary = 'Zmieniono etap oceny';
  else if (trialSummary) summary = trialSummary;
  audit(next, user, 'updated', summary, keys);
  return next;
}

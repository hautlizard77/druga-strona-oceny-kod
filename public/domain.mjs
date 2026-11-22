const regulation = 'https://eli.gov.pl/api/acts/DU/2016/470/text.html';
const act = 'https://eli.gov.pl/eli/DU/2026/590/ogl';
const statutoryGuide = 'https://www.gov.pl/web/sluzbacywilna/oceny-pracownicze';

export const ROLES = Object.freeze({ manager: 'Przełożony', employee: 'Pracownik', hr: 'Kadry' });

export const STAGES = Object.freeze([
  { id: 'setup', label: 'Ustawienia oceny' },
  { id: 'start', label: 'Rozmowa początkowa' },
  { id: 'observations', label: 'Obserwacje' },
  { id: 'review', label: 'Rozmowa oceniająca' },
  { id: 'sign', label: 'Potwierdzenia' },
  { id: 'complete', label: 'Zakończona' },
]);

export const RULESET = Object.freeze({
  version: '2026.11.1',
  templateVersion: '2016.470',
  source: regulation,
  statute: act,
  guide: statutoryGuide,
  months: 24,
  maxAdditional: 3,
  trialDays: 30,
  recentDays: 30,
});

export const SCORE_OPTIONS = Object.freeze([
  { value: 1, label: 'Znacznie poniżej oczekiwań' },
  { value: 3, label: 'Poniżej oczekiwań' },
  { value: 5, label: 'Na poziomie oczekiwań' },
  { value: 7, label: 'Powyżej oczekiwań' },
  { value: 9, label: 'Znacznie powyżej oczekiwań' },
]);

const organization = 'Organizacja pracy i orientacja na osiąganie celów';
const catalog = [
  'Komunikacja',
  'Kreatywność',
  'Negocjowanie',
  organization,
  'Orientacja na klienta/interesanta',
  'Podejmowanie decyzji i odpowiedzialność',
  'Radzenie sobie w sytuacjach kryzysowych',
  'Rzetelność',
  'Myślenie analityczne',
  'Wykorzystywanie wiedzy i doskonalenie zawodowe',
  'Współpraca',
  'Wystąpienia publiczne',
  'Zarządzanie ludźmi',
  'Zarządzanie strategiczne',
];

const managerCriteria = [
  'Zarządzanie ludźmi',
  'Podejmowanie decyzji i odpowiedzialność',
  organization,
  'Współpraca',
  'Komunikacja',
];

const openingFields = [
  ['employeeFirstName', 'Imię ocenianego'],
  ['employeeLastName', 'Nazwisko ocenianego'],
  ['managerFirstName', 'Imię oceniającego'],
  ['managerLastName', 'Nazwisko oceniającego'],
  ['managerPosition', 'Stanowisko oceniającego'],
  ['openingManagerPlace', 'Miejscowość oceniającego przy rozpoczęciu'],
  ['openingEmployeePlace', 'Miejscowość ocenianego przy rozpoczęciu'],
];

const unitFields = [
  ['employeeUnit', 'Komórka organizacyjna ocenianego'],
  ['managerUnit', 'Komórka organizacyjna oceniającego'],
];

const finalFields = [
  ['periodEnd', 'Koniec okresu objętego oceną'],
  ['assessmentDate', 'Data sporządzenia oceny'],
  ['previousAssessmentResult', 'Poprzednia ocena okresowa urzędnika'],
  ['previousAssessmentLevel', 'Poziom poprzedniej oceny'],
  ['previousAssessmentDate', 'Data poprzedniej oceny'],
  ['previousAcknowledgmentDate', 'Data zapoznania się z poprzednią oceną'],
  ['serviceDegreeAttachment', 'Wniosek o kolejny stopień służbowy'],
  ['finalManagerPlace', 'Miejscowość podpisu oceniającego'],
  ['finalEmployeePlace', 'Miejscowość podpisu ocenianego'],
];

const degreeFields = [
  ['appointmentYear', 'Rok mianowania'],
  ['currentDegree', 'Posiadany stopień służbowy'],
  ['currentDegreeDate', 'Data przyznania obecnego stopnia'],
  ['requestedDegree', 'Wnioskowany stopień służbowy'],
  ['degreePlace', 'Miejscowość sporządzenia wniosku'],
  ['degreeDate', 'Data sporządzenia wniosku'],
];

function fieldsIn(section, fields) {
  return fields.map(([key, label]) => ({ key, label, section }));
}

function formMetadata(id, position, attachment, requiredCriteria, docx) {
  return {
    id,
    title: `Arkusz ${id}`,
    position,
    attachment,
    source: `https://www.gov.pl/attachment/${docx}`,
    requiredCriteria,
    optionalCriteria: catalog.filter(name => !requiredCriteria.includes(name)),
    fields: [
      ...fieldsIn('I', id === 'A' ? openingFields : [...openingFields, ...unitFields]),
      ...fieldsIn('II', id === 'A' ? [...finalFields, ['appealAuthority', 'Adresat sprzeciwu']] : finalFields),
      ...fieldsIn('III', degreeFields),
    ],
  };
}

const forms2016470 = Object.freeze({
  A: formMetadata('A', 'Kierownik urzędu', 2, [...managerCriteria, 'Zarządzanie strategiczne'], 'f30edd6d-9a69-4533-9db4-359d03c327b7'),
  B: formMetadata('B', 'Bezpośrednie kierowanie pracownikami', 3, [...managerCriteria], 'ddcb1649-673d-497d-9fcb-18ff91f70be2'),
  C: formMetadata('C', 'Pozostałe stanowiska', 4, [catalog[9], 'Rzetelność', organization, 'Współpraca', 'Komunikacja'], '5d938197-f62e-4b60-a52c-59f29e07a4e3'),
});

const formPacks = Object.freeze({'2016.470':forms2016470});
export const FORM_META = formPacks[RULESET.templateVersion];

export function formsFor(record) {
  const version = record.ruleSnapshot?.templateVersion ?? '2016.470';
  return Object.hasOwn(formPacks,version) ? formPacks[version] : {};
}

export const CASE_TYPES = Object.freeze([
  { id: 'absence', label: 'Usprawiedliwiona nieobecność ocenianego' },
  { id: 'manager-change', label: 'Zmiana osoby oceniającej' },
  { id: 'position-change', label: 'Zmiana stanowiska i istotna zmiana obowiązków' },
  { id: 'earlier-request', label: 'Wniosek ocenianego o zmianę terminu' },
  { id: 'expected-absence', label: 'Przewidywana dłuższa nieobecność' },
  { id: 'task-change', label: 'Zmiana zadań lub priorytetów' },
]);

export const ACTION_OPTIONS = Object.freeze([
  {
    id: 'priorities',
    label: 'Ustalajcie priorytety raz w tygodniu',
    description: 'Kierownik i pracownik ustalają trzy priorytety. Gdy dochodzi pilne zadanie, kierownik wskazuje, co można przesunąć.',
    owner: 'Przełożony',
    ownerRole: 'manager',
    metric: 'Liczba spraw przesuniętych bez uzgodnienia',
    development: 'Zgłaszać kolizję terminów przy przyjęciu pilnego zadania i potwierdzać uzgodnioną zmianę priorytetów.',
  },
  {
    id: 'workload',
    label: 'Rozdzielcie dyżur pilnych spraw',
    description: 'Koordynator zespołu układa tygodniowy dyżur pilnych spraw i przegląda z pracownikiem liczbę przydziałów.',
    owner: 'Koordynator zespołu',
    ownerRole: 'coordinator',
    metric: 'Liczba pilnych przydziałów poza dyżurem',
    development: 'Przekazywać pilne sprawy osobie dyżurującej i zgłaszać przypadki wymagające wsparcia zastępcy.',
  },
]);

const availableForms = Object.keys(FORM_META);
const scoreValues = SCORE_OPTIONS.map(option => option.value);
const oneDay = 86_400_000;
const fixedHolidays = new Set(['01-01', '01-06', '05-01', '05-03', '08-15', '11-01', '11-11', '12-25', '12-26']);

function asDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return date;
}

export function addDays(value, days) {
  const date = asDate(value);
  if (!date || !Number.isFinite(days)) return '';
  return new Date(+date + days * oneDay).toISOString().slice(0, 10);
}

export function addMonths(value, months) {
  const date = asDate(value);
  if (!date || !Number.isInteger(months)) return '';
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const monthEnd = new Date(date);
  monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1, 0);
  date.setUTCDate(Math.min(day, monthEnd.getUTCDate()));
  return date.toISOString().slice(0, 10);
}

function easterDate(year) {
  // Gregorian computus used for Easter Monday and Corpus Christi.
  const century = Math.floor(year / 100);
  const metonicRemainder = year % 19;
  const epact = (19 * metonicRemainder + century - Math.floor(century / 4) - Math.floor((century - Math.floor((century + 8) / 25) + 1) / 3) + 15) % 30;
  const remainder = year % 100;
  const leapOffset = (32 + 2 * (century % 4) + 2 * Math.floor(remainder / 4) - epact - remainder % 4) % 7;
  const correction = Math.floor((metonicRemainder + 11 * epact + 22 * leapOffset) / 451);
  const marchOffset = epact + leapOffset - 7 * correction + 114;
  const month = Math.floor(marchOffset / 31);
  const day = marchOffset % 31 + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function workingDeadline(value) {
  let date = asDate(value);
  if (!date) return '';
  while (date) {
    const dayOfWeek = date.getUTCDay();
    const year = date.getUTCFullYear();
    const monthDay = value.slice(5);
    const easter = easterDate(year);
    const holiday = fixedHolidays.has(monthDay) || (year >= 2025 && monthDay === '12-24') || value === addDays(easter, 1) || value === addDays(easter, 60);
    if (dayOfWeek > 0 && dayOfWeek < 6 && !holiday) return value;
    value = addDays(value, 1);
    date = asDate(value);
  }
  return '';
}

function dayCount(start, end) {
  return Math.round((+asDate(end) - +asDate(start)) / oneDay);
}

function today() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(new Date());
}

function randomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `demo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function formFor(positionType) {
  const code = String(positionType ?? '').toUpperCase();
  return availableForms.includes(code) ? code : null;
}

function nameParts(value) {
  const [first = '', ...last] = String(value || '').trim().split(/\s+/);
  return [first, last.join(' ')];
}

export function newCase(input = {}) {
  const formType = formFor(input.positionType ?? input.formType ?? 'C');
  const startDate = input.startDate ?? today();
  const ruleSnapshot = { ...RULESET, ...input.ruleSnapshot };
  const [employeeFirstName, employeeLastName] = nameParts(input.employeeName);
  const [managerFirstName, managerLastName] = nameParts(input.managerName);
  const fields = Object.values(FORM_META).flatMap(form => form.fields);
  const formDetails = Object.fromEntries(fields.map(field => [field.key, '']));
  const requiredCriteria = formsFor({ruleSnapshot})[formType]?.requiredCriteria ?? [];

  return {
    id: input.id ?? randomId(),
    title: input.title ?? '',
    employeeName: input.employeeName ?? '',
    employeeId: input.employeeId ?? '',
    managerName: input.managerName ?? '',
    managerId: input.managerId ?? '',
    office: input.office ?? '',
    officeId: input.officeId ?? '',
    position: input.position ?? '',
    positionType: formType,
    formType,
    startDate,
    dueDate: input.dueDate ?? workingDeadline(addMonths(startDate, ruleSnapshot.months)),
    stage: 'setup',
    ruleSnapshot,
    formDetails: {
      ...formDetails,
      employeeFirstName,
      employeeLastName,
      managerFirstName,
      managerLastName,
      serviceDegreeAttachment: 'not-applicable',
      ...input.formDetails,
    },
    criteria: requiredCriteria.map(name => ({ name, required: true, score: null, justification: '', evidenceIds: [] })),
    evidence: [],
    contexts: [],
    events: [],
    startMeeting: { date: '', notes: '', location: '', signedManager: null, signedEmployee: null },
    reviewMeeting: { date: '', notes: '' },
    outcome: { summary: '', development: '', serviceDegree: '' },
    signatures: { manager: null, employee: null },
    action: null,
    history: [],
  };
}

function warn(notices, code, message, source) {
  notices.push({ code, message, source });
}

function evaluateSchedule(record, config, notices) {
  const { startDate, formDetails = {} } = record;
  const earlierDate = formDetails.previousAssessmentDate || startDate;
  const positionReference = formDetails.previousAssessmentDate || record.startMeeting?.date || startDate;
  const negativePrevious = formDetails.previousAssessmentResult === 'negatywna';
  const originalDueDate = addMonths(earlierDate, config.months);
  let dueDate = originalDueDate;
  const openingDeadline = workingDeadline(addDays(earlierDate, negativePrevious ? 7 : 30));
  let positionWindow = null;
  let addedThrough = '';

  if (negativePrevious) {
    const acknowledged = formDetails.previousAcknowledgmentDate;
    if (asDate(acknowledged)) {
      dueDate = workingDeadline(addDays(addMonths(acknowledged, 6), 1));
    } else {
      dueDate = '';
      warn(notices, 'negative-previous-date', 'Podaj datę zapoznania z wcześniejszą negatywną oceną. Ponowna ocena przypada po upływie 6 miesięcy od tej daty.', 'art. 81 ust. 9');
    }
  }

  const events = [...(record.events ?? [])].sort((one, two) => (one.date || '').localeCompare(two.date || ''));
  for (const event of events) {
    if (!asDate(event.date)) continue;
    const afterSixMonths = asDate(earlierDate) && event.date > addMonths(earlierDate, 6);
    if (event.type === 'absence' && !negativePrevious) {
      if (!asDate(event.endDate) || event.endDate < event.date) {
        warn(notices, 'absence-open', 'Podaj datę zakończenia usprawiedliwionej nieobecności, aby obliczyć przedłużenie terminu.', 'art. 81 ust. 7');
      } else if (addDays(event.endDate, 1) > addMonths(event.date, 1) && dueDate && event.date <= workingDeadline(dueDate)) {
        const from = [startDate, event.date, addedThrough].sort().at(-1);
        if (from > event.endDate) continue;
        const days = dayCount(from, event.endDate) + 1;
        dueDate = addDays(dueDate, days);
        addedThrough = addDays(event.endDate, 1);
        warn(notices, 'absence-extension', `Usprawiedliwiona nieobecność wydłuża podstawowy termin oceny o ${days} dni.`, 'art. 81 ust. 7');
      }
    }
    if (event.type === 'position-change' && !negativePrevious) {
      if (event.material === false) {
        warn(notices, 'position-duties-verify', 'Sprawdź, czy zmiana stanowiska istotnie zmieniła zakres obowiązków.', 'art. 81 ust. 6');
      } else if (event.date > addMonths(positionReference, 6)) {
        const window = { from: addDays(event.date, -7), to: workingDeadline(addDays(event.date, 30)) };
        if (!positionWindow || window.to < positionWindow.to) positionWindow = window;
        warn(notices, 'position-window', `Przy istotnej zmianie obowiązków ocenę należy sporządzić od ${window.from} do ${window.to}.`, 'art. 81 ust. 6 oraz § 9 ust. 2');
      } else {
        warn(notices, 'position-reopen', `Ponów rozmowę początkową i ustal kryteria do ${workingDeadline(addDays(event.date, 30))}. Podstawowy termin oceny pozostaje bez zmiany.`, '§ 9 ust. 1');
      }
    }
    if (event.type === 'task-change') {
      warn(notices, 'task-context', 'Uwzględnij datę zmiany zadań podczas omawiania obserwacji.', '§ 10 pkt 1');
    }
    if (event.type === 'manager-change') {
      warn(notices, 'manager-continuity', 'Nowy oceniający stosuje wcześniej wybrane kryteria.', '§ 9 ust. 3');
    }
    if (['earlier-request', 'manager-change', 'expected-absence'].includes(event.type)) {
      if (!negativePrevious && afterSixMonths) {
        if (!asDate(event.newDueDate) || !event.noticeReference) {
          warn(notices, 'discretionary-date', asDate(event.newDueDate)
            ? 'Powiąż ze sprawą kopię pisemnego zawiadomienia o nowym terminie.'
            : 'Oceniający może zmienić termin. O nowym terminie zawiadamia ocenianego na piśmie, a kopię zawiadomienia dołącza do arkusza.', 'art. 81 ust. 8 oraz § 8');
        }
        if (asDate(event.newDueDate)) dueDate = event.newDueDate;
      } else if (!negativePrevious) {
        warn(notices, 'discretionary-six-months', 'Sprawdź warunek upływu ponad sześciu miesięcy przed zmianą terminu.', 'art. 81 ust. 8');
      }
    }
  }

  const employeeSignedDate = record.delivery?.acknowledgedOn;
  const appealDeadline = workingDeadline(addDays(employeeSignedDate, 7));
  const managerDate = formDetails.assessmentDate || signatureDate(record.signatures?.manager);
  if (asDate(managerDate) && positionWindow && (managerDate < positionWindow.from || managerDate > positionWindow.to)) {
    warn(notices, 'position-outside-window', 'Data oceny jest poza wyliczonym terminem po zmianie stanowiska. Wyjaśnij sytuację z kadrami.', '§ 9 ust. 2');
  }

  const adjustedDueDate = positionWindow?.to || workingDeadline(dueDate);
  if (!positionWindow && adjustedDueDate && adjustedDueDate !== dueDate) {
    warn(notices, 'nonworking-date', 'Termin upływa w następnym dniu, który nie jest dniem ustawowo wolnym od pracy ani sobotą.', 'art. 115 Kodeksu cywilnego');
  }
  return { dueDate: adjustedDueDate, originalDueDate, openingDeadline, appealDeadline, positionWindow };
}

function signatureDate(signature) {
  if (typeof signature === 'string') return signature.slice(0, 10);
  return signature?.date || (signature?.signedAt ?? signature?.at)?.slice(0, 10);
}

export function evaluateRules(record, config = RULESET, preparationDate = today()) {
  const version = { ...RULESET, ...config, ...record.ruleSnapshot };
  const formType = formFor(record.positionType ?? record.formType);
  const form = formsFor(record)[formType];
  const criteria = record.criteria ?? [];
  const issues = [];
  const notices = [];
  const need = (condition, code, message, stage, field) => {
    if (!condition) issues.push({ code, message, stage, ...(field ? {field} : {}) });
  };

  need(form && (!record.formType || record.formType === formType), 'form', 'Wybierz arkusz odpowiadający stanowisku.', 'setup');
  need(record.employeeName?.trim() && record.managerName?.trim(), 'names', 'Uzupełnij dane ocenianego i oceniającego.', 'setup');
  need(record.office?.trim() && record.position?.trim(), 'office-position', 'Uzupełnij urząd i stanowisko ocenianego.', 'setup');
  need(asDate(record.startDate), 'start-date', 'Wprowadź datę początku ocenianego okresu.', 'setup');

  if (form) {
    const additional = criteria.filter(item => !item.required);
    need(form.requiredCriteria.every(name => criteria.some(item => item.required && item.name === name)), 'required-criteria', 'Uzupełnij wszystkie kryteria obowiązkowe właściwe dla arkusza.', 'start');
    need(criteria.every(item => (item.required ? form.requiredCriteria : form.optionalCriteria).includes(item.name)), 'unknown-criteria', 'Dobierz kryteria zgodnie z wykazem właściwym dla arkusza.', 'start');
    need(new Set(criteria.map(item => item.name)).size === criteria.length, 'duplicate-criteria', 'Każde kryterium może wystąpić tylko raz.', 'start');
    need(additional.length <= version.maxAdditional, 'additional-limit', `Możesz wybrać najwyżej ${version.maxAdditional} kryteria dodatkowe.`, 'start');
  }

  const schedule = evaluateSchedule(record, version, notices);
  if (record.startMeeting?.date && schedule.openingDeadline && record.startMeeting.date > schedule.openingDeadline) {
    warn(notices, 'opening-late', 'Sprawdź termin rozmowy początkowej. Zapisana data jest późniejsza niż termin wynikający z reguły.', '§ 7');
  }
  need(asDate(record.startMeeting?.date), 'opening-date', 'Zapisz datę rozmowy początkowej.', 'start');
  need(record.startMeeting?.signedManager && record.startMeeting?.signedEmployee, 'opening-confirmations', 'Zapisz oba potwierdzenia rozmowy początkowej i zapoznania z kryteriami.', 'start');

  const details = record.formDetails ?? {};
  const reviewDate = record.reviewMeeting?.date;
  const assessmentDate = details.assessmentDate || signatureDate(record.signatures?.manager) || preparationDate;
  if (details.assessmentDate) {
    need(asDate(assessmentDate) && assessmentDate >= record.startDate && assessmentDate <= preparationDate,
      'assessment-chronology','Data sporządzenia oceny musi wypadać od początku okresu do dnia dzisiejszego.','review','assessmentDate');
  }
  need(asDate(reviewDate), 'review-date', 'Zapisz datę rozmowy oceniającej.', 'review', 'date');
  if (asDate(reviewDate)) {
    need(reviewDate >= record.startDate && reviewDate <= assessmentDate, 'review-chronology', 'Data rozmowy oceniającej musi wypadać między początkiem ocenianego okresu a datą sporządzenia oceny.', 'review', 'date');
  }
  if (asDate(details.periodEnd)) {
    need(details.periodEnd >= record.startDate && details.periodEnd <= assessmentDate, 'period-chronology', 'Koniec ocenianego okresu musi wypadać między początkiem okresu a datą sporządzenia oceny.', 'review', 'periodEnd');
  }
  if (details.periodEnd && !asDate(details.periodEnd)) {
    need(false,'period-chronology','Wprowadź poprawną datę końca ocenianego okresu.','review','periodEnd');
  }
  if (form) {
    const historic = record.openingManagerSnapshot ?? details;
    const fields = {
      ...details,
      openingManagerPlace: details.openingManagerPlace || record.startMeeting?.location,
      openingEmployeePlace: details.openingEmployeePlace || record.startMeeting?.location,
      finalManagerPlace: details.finalManagerPlace || record.reviewMeeting?.location,
      finalEmployeePlace: details.finalEmployeePlace || record.reviewMeeting?.location,
    };
    const required = ['employeeFirstName','employeeLastName','managerFirstName','managerLastName','managerPosition',
      'openingManagerPlace','openingEmployeePlace','finalManagerPlace','finalEmployeePlace'];
    if (formType !== 'A') required.push('employeeUnit','managerUnit');
    else required.push('appealAuthority');
    if (details.previousAssessmentResult) required.push('previousAssessmentDate','previousAssessmentLevel');
    if (details.previousAssessmentResult === 'negatywna') required.push('previousAcknowledgmentDate');
    if (details.serviceDegreeAttachment === 'yes') required.push(...degreeFields.map(([key]) => key));
    for (const key of required) {
      const label = form.fields.find(field => field.key === key).label;
      const value = fields[key];
      const present = /Date$/.test(key) ? asDate(value) : typeof value === 'string' && value.trim();
      need(present, 'worksheet-field', `Uzupełnij pole: ${label}.`, 'review', key);
    }
    if (record.openingManagerSnapshot) {
      need(historic.managerPosition?.trim(), 'opening-manager-position', 'Brak stanowiska pierwszego oceniającego w zapisanych danych otwarcia.', 'review');
      if (formType !== 'A') need(historic.managerUnit?.trim(), 'opening-manager-unit', 'Brak komórki pierwszego oceniającego w zapisanych danych otwarcia.', 'review');
    }
  }
  const scores = criteria.map(item => Number(item.score));
  const allScored = scores.length > 0 && scores.every(score => scoreValues.includes(score)) && !issues.some(issue => issue.stage === 'start' && /criteria|additional/.test(issue.code));
  need(allScored, 'scores', 'Oceniający powinien wprowadzić ocenę cząstkową dla każdego wybranego kryterium.', 'review');
  const average = allScored ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null;
  const level = average === null ? '' : SCORE_OPTIONS.find(option => average <= option.value + 1).label;
  const outcome = average === null ? null : average > 4 && !scores.includes(1) ? 'pozytywna' : 'negatywna';
  need(outcome !== 'negatywna' || record.outcome?.summary?.trim(), 'negative-reason', 'Ocena negatywna wymaga uzasadnienia.', 'review');
  need(record.outcome?.development?.trim(), 'development', 'Uzupełnij wnioski do indywidualnego programu rozwoju zawodowego.', 'review');
  if (record.formDetails?.serviceDegreeAttachment === 'yes') {
    need(outcome === 'pozytywna', 'degree-positive', 'Wniosek o kolejny stopień można dołączyć do pozytywnej oceny urzędnika służby cywilnej.', 'review');
    need(record.outcome?.serviceDegree?.trim() && record.formDetails.requestedDegree, 'degree-grounds', 'Wprowadź wnioskowany stopień służbowy i uzasadnienie wniosku.', 'review');
  }

  need(record.signatures?.manager, 'manager-confirmation', 'Brakuje potwierdzenia oceniającego.', 'sign');
  need(record.signatures?.employee, 'employee-confirmation', 'Brakuje potwierdzenia zapoznania się z oceną przez ocenianego.', 'sign');

  return { formType, ...schedule, issues, notices, criteria, score: average, outcome, level, ruleVersion: version.version };
}

export function observationPeriod(record, currentDate = today()) {
  return {
    start:record.startDate,
    end:[record.observationEnd || record.formDetails?.periodEnd || record.reviewMeeting?.date,currentDate].filter(Boolean).sort()[0],
  };
}

export function observationInPeriod(entry, period) {
  return Boolean(asDate(entry.date) && entry.date >= period.start && entry.date <= period.end);
}

export function openingSection(record) {
  return record.openingSnapshot ?? (record.startMeeting?.signedEmployee ? null : record);
}

export function analyzeEvidence(record) {
  const period = observationPeriod(record);
  const observations = (record.evidence ?? []).filter(entry => observationInPeriod(entry,period));
  const historical = (record.evidence ?? []).filter(entry => !observationInPeriod(entry,period));
  const contexts = record.contexts ?? [];
  const notices = [];
  const referenceDate = period.end;
  const recentDays = record.ruleSnapshot?.recentDays ?? RULESET.recentDays;
  const recentBoundary = addDays(referenceDate, 1 - recentDays);
  const evidenceIds = new Set();
  const items = (record.criteria ?? []).map(criterion => {
    const links = new Set(criterion.evidenceIds ?? []);
    const evidence = observations.filter(item => links.has(item.id));
    const otherObservations = observations.filter(item => item.criterion === criterion.name && !links.has(item.id));
    const linkedContexts = contexts.filter(item => evidence.some(entry => entry.id === item.evidenceId));
    evidence.forEach(item => evidenceIds.add(item.id));
    const recentOnly = Boolean(recentBoundary && evidence.length > 0 && evidence.every(item => item.date >= recentBoundary && item.date <= referenceDate));
    const gap = evidence.length === 0;
    if (recentOnly) notices.push({ code: 'recent-only', criterion: criterion.name, message: `Powiązane przykłady pochodzą wyłącznie z ostatnich ${recentDays} dni. Sprawdź wcześniejsze obserwacje.` });
    if (gap) notices.push({ code: 'unlinked-reason', criterion: criterion.name, message: 'Brak powiązanej obserwacji z ocenianego okresu.' });

    return {
      criterion: criterion.name,
      name: criterion.name,
      evidence,
      observations: [...evidence, ...otherObservations],
      otherObservations,
      contexts: linkedContexts,
      counterexamples: otherObservations.filter(item => item.tone === 'positive'),
      recentOnly,
      gap,
    };
  });

  const taskChange = (record.events ?? []).find(event => event.type === 'task-change' || event.type === 'position-change');
  const question = taskChange
    ? 'Kiedy dochodziło pilne zadanie, jak ustalaliście, którą wcześniejszą sprawę można przesunąć? Co pomogłoby rozwiązać taki konflikt terminów?'
    : 'Które zadania były najtrudniejsze do pogodzenia i jakie przykłady z ocenianego okresu pomogą to wyjaśnić?';
  if (taskChange) notices.push({ code: 'task-context', message: 'W okresie oceny zmieniły się zadania lub priorytety. Omów kontekst z pracownikiem przed sformułowaniem wniosku.' });

  return { items, historical, unlinked: observations.filter(item => !evidenceIds.has(item.id)), notices, question };
}

export function buildAction(optionId, record) {
  const option = ACTION_OPTIONS.find(actionOption => actionOption.id === optionId);
  if (!option) return null;
  const startDate = record.reviewMeeting?.date || today();
  const days = record.ruleSnapshot?.trialDays ?? RULESET.trialDays;
  const owner = option.ownerRole === 'manager' ? record.managerName || option.owner : option.owner;

  return {
    ...option,
    metricDefinition: optionId === 'priorities' ? {
      event:'Sprawa przesunięta poza uzgodniony termin bez wcześniejszego uzgodnienia.',
      population:'Wszystkie sprawy przydzielone zespołowi w okresie pomiaru.',
      source:'Rejestr przydziałów i zmian terminów zespołu.',
    } : {
      event:'Pilna sprawa przydzielona poza ustalonym dyżurem.',
      population:'Wszystkie pilne sprawy przydzielone zespołowi w okresie pomiaru.',
      source:'Rejestr dyżurów i przydziałów pilnych spraw.',
    },
    id: randomId(),
    optionId,
    owner,
    startDate,
    reviewDate: addDays(startDate, days),
    status: 'active',
    baseline: null,
    followUp: null,
    note: '',
    employeeComment: '',
    decision: '',
  };
}

export function makeDemoState() {
  const office = 'Urząd Administracji Publicznej w Brzezinach';
  const officeId = 'demo-office';
  const users = [
    { id: 'demo-manager', role: 'manager', name: 'Michał Nowicki' },
    { id: 'demo-employee', role: 'employee', name: 'Anna Kowalska' },
    { id: 'demo-hr', role: 'hr', name: 'Ewa Zielińska' },
  ].map(user => ({ ...user, office, officeId }));

  const demo = newCase({
    id: 'demo-ocena',
    title: 'Ocena okresowa Anny Kowalskiej',
    employeeId: 'demo-employee',
    employeeName: 'Anna Kowalska',
    managerId: 'demo-manager',
    managerName: 'Michał Nowicki',
    office,
    officeId,
    position: 'Specjalistka ds. obsługi spraw',
    positionType: 'C',
    startDate: '2024-11-21',
    formDetails: {
      employeeUnit: 'Wydział Obsługi Spraw',
      managerUnit: 'Wydział Obsługi Spraw',
      managerPosition: 'Kierownik wydziału',
      openingManagerPlace: 'Brzeziny',
      openingEmployeePlace: 'Brzeziny',
      finalManagerPlace: 'Brzeziny',
      finalEmployeePlace: 'Brzeziny',
    },
  });
  demo.stage = 'observations';
  demo.startMeeting = {
    date: '2024-12-05',
    notes: 'Omówiono prowadzenie spraw, zmianę priorytetów, oczekiwania dotyczące terminowości i sposób uzgadniania działań.',
    location: 'Brzeziny',
    signedManager: { name: 'Michał Nowicki', date: '2024-12-05' },
    signedEmployee: { name: 'Anna Kowalska', date: '2024-12-05' },
  };
  demo.reviewMeeting = { date: '2026-11-21', notes: '' };
  demo.events = [
    { id: 'demo-manager-change', type: 'manager-change', date: '2026-08-01', note: 'Kierownik Michał Nowicki przejął prowadzenie sprawy.' },
    { id: 'demo-task-change', type: 'task-change', date: '2026-10-28', note: 'Wydział przejął dodatkową kolejkę pilnych spraw.' },
  ];
  demo.evidence = [
    { id: 'ev-1', date: '2026-11-18', text: 'Sprawę 114 przekazano o dwa dni po uzgodnionym terminie.', criterion: organization, shared: true, tone: 'concern', authorId: 'demo-manager' },
    { id: 'ev-2', date: '2026-11-13', text: 'Sprawę 109 przekazano jeden dzień po terminie.', criterion: organization, shared: true, tone: 'concern', authorId: 'demo-manager' },
    { id: 'ev-3', date: '2026-11-04', text: 'Sprawę 103 przekazano trzy dni po terminie.', criterion: organization, shared: true, tone: 'concern', authorId: 'demo-manager' },
    { id: 'ev-4', date: '2026-09-15', text: 'W ostatnim przeglądzie przed zmianą priorytetów wszystkie 12 spraw przekazano w terminie.', criterion: organization, shared: true, tone: 'positive', authorId: 'demo-manager' },
    { id: 'ev-5', date: '2026-04-15', text: 'Opracowała krótką instrukcję dla nowych pracowników i omówiła ją z zespołem.', criterion: 'Współpraca', shared: true, tone: 'positive', authorId: 'demo-manager' },
    { id: 'ev-6', date: '2026-10-20', text: 'Robocza notatka do przygotowania rozmowy. Sprawdzić przepływ pilnych zadań między stanowiskami.', criterion: organization, shared: false, tone: 'neutral', authorId: 'demo-manager' },
  ];
  demo.criteria.find(item => item.name === organization).evidenceIds = ['ev-1', 'ev-2', 'ev-3'];
  demo.criteria.find(item => item.name === organization).justification = 'W trzech ostatnich przypadkach sprawy zakończono po terminie.';
  demo.criteria.find(item => item.name === 'Współpraca').evidenceIds = ['ev-5'];
  demo.history = [
    { at: '2024-12-05T09:30:00Z', actorId: 'demo-manager', action: 'Otwarto okres oceny' },
    { at: '2026-08-01T08:00:00Z', actorId: 'demo-hr', action: 'Zaktualizowano osobę oceniającą' },
  ];

  return { users, cases: [demo], config: { ...RULESET } };
}

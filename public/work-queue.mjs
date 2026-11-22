import { addDays, evaluateRules } from './domain.mjs';

const supportedRoles = new Set(['manager', 'employee', 'hr']);
const dueOrder = { overdue: 0, today: 1, soon: 2, upcoming: 3, none: 4 };

function sortItems(left, right) {
  return Number(left.optional) - Number(right.optional)
    || dueOrder[left.dueState] - dueOrder[right.dueState]
    || (left.dueDate ?? '').localeCompare(right.dueDate ?? '')
    || left.employeeName.localeCompare(right.employeeName, 'pl')
    || left.id.localeCompare(right.id);
}

function firstDate(...values) {
  return values.map(value => addDays(value, 0)).filter(Boolean).sort()[0] ?? null;
}

function addItem(list, record, dates, {kind, title, description, date, panel = 'process', optional = false}) {
  const dueDate = firstDate(date);
  const dueState = !dueDate ? 'none'
    : dueDate < dates.today ? 'overdue'
    : dueDate === dates.today ? 'today'
    : dueDate <= dates.soon ? 'soon'
    : 'upcoming';
  list.push({
    id: `${record.id}:${kind}`,
    recordId: record.id,
    employeeName: record.employeeName ?? '',
    kind,
    title,
    description,
    dueDate,
    dueState,
    panel,
    step: panel === 'process' ? record.stage : undefined,
    optional,
  });
}

function openingDeadline(record, role) {
  if (Object.hasOwn(record, 'openingDeadline')) return record.openingDeadline;
  // Employee and HR projections omit some inputs used by the schedule evaluator.
  return role === 'manager' ? evaluateRules(record).openingDeadline : null;
}

function managerItems(record, dates, tasks, waiting) {
  const opening = openingDeadline(record, 'manager');
  const { startMeeting, signatures, dueDate } = record;
  const add = (item, list = tasks) => addItem(list, record, dates, item);

  switch (record.stage) {
    case 'setup':
      add({kind: 'prepare-opening', title: 'Dobierz arkusz i kryteria', description: 'Sprawdź stanowisko oraz kryteria przed rozmową początkową.', date: opening});
      break;
    case 'start':
      if (!startMeeting?.date) {
        add({kind: 'save-opening', title: 'Zapisz rozmowę początkową', description: 'Uzupełnij datę rozmowy, miejsce i ustalone oczekiwania.', date: opening});
      } else if (!startMeeting.signedManager) {
        add({kind: 'sign-opening', title: 'Potwierdź ustalenia początkowe', description: 'Po Twoim potwierdzeniu pracownik może potwierdzić zapoznanie.', date: opening});
      } else if (!startMeeting.signedEmployee) {
        add({kind: 'await-opening', title: 'Pracownik potwierdza ustalenia początkowe', description: 'Rozpocznij zbieranie obserwacji po potwierdzeniu pracownika.'}, waiting);
      } else {
        add({kind: 'begin-observations', title: 'Rozpocznij zbieranie obserwacji', description: 'Obie strony potwierdziły ustalenia początkowe.'});
      }
      break;
    case 'observations':
      add({kind: 'prepare-review', title: 'Przygotuj rozmowę oceniającą', description: 'Przejrzyj obserwacje i pytania w widoku Partner HR.', date: record.positionWindow?.to || firstDate(record.reviewMeeting?.date, dueDate), panel: 'partner'});
      break;
    case 'review':
      add({kind: 'complete-review', title: 'Uzupełnij ocenę i wnioski rozwojowe', description: 'Zapisz ustalenia z rozmowy oraz oceny cząstkowe.', date: dueDate});
      break;
    case 'sign':
      if (!signatures?.manager) {
        add({kind: 'sign-review', title: 'Potwierdź podpisanie oceny', description: 'Sprawdź kompletność arkusza i zapisz potwierdzenie.', date: dueDate});
      } else if (!signatures.employee) {
        add({kind: 'await-review', title: 'Pracownik zapoznaje się z oceną', description: 'Sprawa zamknie się po potwierdzeniu obu stron.'}, waiting);
      }
      break;
  }
}

function employeeItems(record, dates, tasks, waiting) {
  const { startMeeting, signatures } = record;
  const add = (item, list = tasks) => addItem(list, record, dates, item);

  if (record.stage === 'start' && !startMeeting?.signedEmployee && startMeeting?.signedManager) {
    add({kind: 'acknowledge-opening', title: 'Potwierdź zapoznanie z ustaleniami', description: 'Przeczytaj ustalenia rozmowy początkowej i zapisz zapoznanie.', date: openingDeadline(record, 'employee')});
  } else if (record.stage === 'sign' && !signatures?.employee && signatures?.manager) {
    add({kind: 'acknowledge-review', title: 'Potwierdź zapoznanie z oceną', description: 'Otwórz arkusz i zapisz potwierdzenie zapoznania.'});
  } else if (record.stage === 'setup' || (record.stage === 'start' && !startMeeting?.signedManager)) {
    add({kind: 'await-opening', title: 'Przełożony przygotowuje ustalenia początkowe', description: 'Możliwość potwierdzenia pojawi się po zapisaniu ustaleń przez przełożonego.'}, waiting);
  } else if (['observations','review','sign'].includes(record.stage) && !signatures?.manager) {
    add({kind: 'await-review', title: 'Przełożony przygotowuje ocenę', description: 'Arkusz oceny będzie dostępny po potwierdzeniu przez przełożonego.'}, waiting);
  }

  if (['observations','review'].includes(record.stage) && !signatures?.manager) {
    const withContext = new Set((record.contexts ?? []).map(entry => entry.evidenceId));
    const awaitingContext = (record.evidence ?? []).some(entry => entry.shared && !withContext.has(entry.id));
    if (awaitingContext) {
      add({kind: 'add-context', title: 'Sprawdź udostępnione obserwacje', description: 'Możesz dopisać swój kontekst przed przygotowaniem końcowej oceny.', panel: 'evidence', optional: true});
    }
  }
}

function hrItems(record, dates, tasks) {
  if (record.stage === 'complete' || record.signatures?.manager) return;

  const dueDate = firstDate(record.dueDate);
  const opening = ['setup','start'].includes(record.stage) && !record.startMeeting?.signedEmployee
    ? openingDeadline(record, 'hr') : null;
  const closestDate = firstDate(dueDate, opening);
  if (!dueDate || (closestDate && closestDate <= dates.horizon)) {
    const title = !dueDate ? 'Sprawdź termin sprawy'
      : closestDate === opening && opening !== dueDate ? 'Sprawdź termin otwarcia oceny'
      : 'Sprawdź termin sporządzenia oceny';
    addItem(tasks, record, dates, {kind: 'check-deadline', title, description: 'Zweryfikuj etap sprawy i ewentualne zdarzenia kadrowe.', date: closestDate});
  }
}

function addTrialItems(record, role, dates, tasks, waiting) {
  const action = record.action;
  if (action?.status !== 'active') return;

  const date = firstDate(action.reviewDate);
  if (role === 'manager' && date) {
    const open = date <= dates.today;
    addItem(open ? tasks : waiting, record, dates, {
      kind: 'verify-trial',
      title: open ? 'Sprawdź efekt działania na 30 dni' : 'Działanie na 30 dni jest w toku',
      description: open ? 'Porównaj pomiar po zmianie z wartością początkową i zapisz decyzję.' : 'Wynik można zapisać od daty weryfikacji.',
      date,
      panel: 'partner',
    });
  }
  if (role === 'employee' && record.signatures?.manager && !action.employeeComment) {
    addItem(tasks, record, dates, {
      kind: 'comment-trial',
      title: 'Podziel się opinią o uzgodnionej zmianie',
      description: 'Możesz opisać, jak uzgodnione działanie wpływa na Twoją pracę.',
      panel: 'partner',
      optional: true,
    });
  }
}

export function buildWorkQueue(cases, role, today) {
  const tasks = [];
  const waiting = [];
  if (!supportedRoles.has(role)) return {tasks, waiting};
  if (!addDays(today, 0)) throw new RangeError('Podaj bieżącą datę urzędu w formacie RRRR-MM-DD.');
  const dates = {today, soon: addDays(today, 7), horizon: addDays(today, 14)};

  for (const record of cases) {
    // An item only documents a case the server already authorized for this role.
    if (role === 'manager') managerItems(record, dates, tasks, waiting);
    else if (role === 'employee') employeeItems(record, dates, tasks, waiting);
    else hrItems(record, dates, tasks);

    if (role !== 'employee' && record.stage === 'complete' && !record.signedFile) {
      addItem(tasks, record, dates, {kind: 'attach-signed', title: 'Dołącz podpisany arkusz', description: 'Dodaj podpisany PDF przekazany przez obieg urzędu.', panel: 'documents'});
    }
    if (role === 'hr' && record.stage === 'complete' && record.signedFile && !record.handoffs?.length) {
      addItem(tasks, record, dates, {kind: 'record-handoff', title: 'Zapisz przekazanie podpisanego arkusza', description: 'Po przekazaniu dokumentu do obiegu zapisz potwierdzenie w sprawie.', panel: 'documents'});
    }
    addTrialItems(record, role, dates, tasks, waiting);
  }

  return {tasks: tasks.sort(sortItems), waiting: waiting.sort(sortItems)};
}

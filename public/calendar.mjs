import { addDays } from './domain.mjs';

function calendarText(value) {
  return String(value).replaceAll('\\', '\\\\').replace(/\r?\n/g, '\\n').replaceAll(',', '\\,').replaceAll(';', '\\;');
}

function calendarEvent({id, dueDate, title, description, leadDays}, generatedAt) {
  if (!addDays(dueDate, 0)) throw new Error('Dobierz termin przed zapisaniem przypomnienia.');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Druga Strona Oceny//PL', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', `UID:${calendarText(id)}@druga-strona-oceny.local`,
    `DTSTAMP:${generatedAt.toISOString().replace(/[-:]|\.\d{3}/g,'')}`,
    `DTSTART;VALUE=DATE:${dueDate.replaceAll('-','')}`,
    `SUMMARY:${calendarText(title)}`, 'CLASS:PRIVATE', 'TRANSP:TRANSPARENT',
    'BEGIN:VALARM', `TRIGGER:-P${leadDays}D`, 'ACTION:DISPLAY', `DESCRIPTION:${calendarText(description)}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}

export function reminderCalendar(record, generatedAt = new Date()) {
  return calendarEvent({id: record.id, dueDate: record.positionWindow?.to || record.dueDate, title: 'Termin oceny okresowej', description: 'Sprawdź termin oceny okresowej', leadDays: 7}, generatedAt);
}

const taskTitles = {
  'prepare-review': 'Rozmowa oceniająca',
  'verify-trial': 'Sprawdzenie działania po ocenie okresowej',
  'prepare-opening': 'Rozmowa początkowa',
  'save-opening': 'Rozmowa początkowa',
  'sign-opening': 'Potwierdzenie ustaleń początkowych',
  'acknowledge-opening': 'Potwierdzenie ustaleń początkowych',
};

export function taskReminderCalendar(item, generatedAt = new Date()) {
  const title = Object.hasOwn(taskTitles, item.kind) ? taskTitles[item.kind] : 'Termin oceny okresowej';
  return calendarEvent({id:item.id,dueDate:item.dueDate,title,description:title,leadDays:item.kind === 'verify-trial' ? 1 : 7}, generatedAt);
}

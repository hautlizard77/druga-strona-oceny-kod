import { formsFor, openingSection, SCORE_OPTIONS } from './domain.mjs';
import { button, date, esc } from './ui.mjs';

const line = (label,value) => `<tr><th scope="row">${esc(label)}</th><td>${esc(value || '—')}</td></tr>`;
const table = (label,rows) => `<table aria-label="${esc(label)}"><tbody>${rows.join('')}</tbody></table>`;

function signature(label, place, entry) {
  const named = typeof entry === 'object' && entry ? entry.name : '';
  const when = typeof entry === 'object' && entry ? date(entry.at ?? entry.date) : '';
  return `<div class="print-sign"><strong>${esc(label)}</strong><p>${esc(place || 'Miejscowość: ........................')} · ${esc(when || 'Data: ........................')}</p>${named ? `<p>Potwierdził(a) w systemie: ${esc(named)}</p>` : ''}<p>Podpis: ................................................</p></div>`;
}

export function printView(record, rules) {
  const type = rules.formType ?? record.formType ?? record.positionType;
  const meta = formsFor(record)[type];
  const details = record.formDetails ?? {};
  const opening = openingSection(record);
  const start = opening?.startMeeting ?? {};
  const first = opening?.formDetails ?? {};
  const review = record.reviewMeeting ?? {};
  const evaluation = record.outcome ?? {};
  const employee = [details.employeeFirstName,details.employeeLastName].filter(Boolean).join(' ') || record.employeeName;
  const manager = [details.managerFirstName,details.managerLastName].filter(Boolean).join(' ') || record.managerName;
  const openingManager = opening?.openingManagerSnapshot ?? {managerName:opening?.managerName,managerPosition:first.managerPosition,managerUnit:first.managerUnit};
  const name = value => String(value ?? '');
  const mandatory = record.criteria.filter(item => item.required);
  const additional = record.criteria.filter(item => !item.required);
  const criteria = [...mandatory,...Array.from({length:3},(_,index) => additional[index] ?? {})];
  const openingRows = [line('Urząd',opening?.office),line('Imię i nazwisko ocenianego',[first.employeeFirstName,first.employeeLastName].filter(Boolean).join(' ') || opening?.employeeName),line('Stanowisko pracy ocenianego',opening?.position)];
  if (type !== 'A') openingRows.push(line('Komórka organizacyjna ocenianego',first.employeeUnit));
  openingRows.push(line('Imię i nazwisko oceniającego',openingManager.managerName || manager),line('Stanowisko pracy oceniającego',openingManager.managerPosition));
  if (type !== 'A') openingRows.push(line('Komórka organizacyjna oceniającego',openingManager.managerUnit));
  openingRows.push(line('Termin sporządzenia oceny',date(opening?.dueDate)),line('Data rozmowy początkowej',date(start.date)),line('Oczekiwania ustalone w rozmowie początkowej',start.notes));
  const previousResult = [details.previousAssessmentResult,details.previousAssessmentLevel].filter(Boolean).join(' · ');
  const serviceDegree = {yes:'Dołączono',no:'Nie dołączono','not-applicable':'Nie dotyczy'}[details.serviceDegreeAttachment];
  const result = [rules.outcome,rules.level].filter(Boolean).join(' · ');
  const previousDate = details.previousAssessmentDate ? date(details.previousAssessmentDate) : '—';
  const appeal = type === 'A' ? (details.appealAuthority || '................................') : 'dyrektor generalny urzędu';
  return `<main class="document" id="main"><div class="document-actions row">${button('Wróć do oceny','print-close',{style:'secondary'})}${button('Drukuj / zapisz PDF','print-now',{glyph:'printer'})}</div><p class="caption">Załącznik nr ${esc(meta?.attachment ?? '')} · arkusz ${esc(type)}</p><h1>Arkusz oceny okresowej członka korpusu służby cywilnej</h1><h2>Część I · Dane i kryteria</h2>${opening ? `${table('Dane i ustalenia początkowe',openingRows)}<p><strong>Kryteria obowiązkowe</strong></p>${table('Kryteria obowiązkowe',opening.criteria.filter(item => item.required).map((item,index) => line(index+1,name(item.name))))}<p><strong>Kryteria dodatkowe</strong></p>${table('Kryteria dodatkowe',opening.criteria.filter(item => !item.required).map((item,index) => line(index+1,item.name)))}<div class="signatures">${signature('Oceniający',first.openingManagerPlace || start.location,start.signedManager)}${signature('Oceniany',first.openingEmployeePlace || start.location,start.signedEmployee)}</div>` : '<p>Brak zachowanej wersji części I potwierdzonej przez pracownika.</p>'}<h2>Część II · Ocena</h2>${table('Okres oceny i rozmowa',[line('Data rozmowy oceniającej',date(review.date)),line('Okres od',date(record.startDate)),line('Okres do',date(details.periodEnd || review.date))])}<table aria-label="Poziomy według kryteriów"><thead><tr><th scope="col">Kryterium</th><th scope="col">Poziom</th><th scope="col">Punkty</th><th scope="col">Uzasadnienie cząstkowe</th></tr></thead><tbody>${criteria.map(item => `<tr><td>${esc(item.name || '—')}</td><td>${esc(SCORE_OPTIONS.find(option => option.value === Number(item.score))?.label || '—')}</td><td>${esc(item.score ?? '—')}</td><td>${esc(item.justification ?? '')}</td></tr>`).join('')}</tbody></table>${table('Wynik i wnioski',[line('Średnia arytmetyczna',rules.score == null ? '' : String(rules.score)),line('Ocena okresowa',result),line('Uzasadnienie oceny',evaluation.summary),line('Wnioski do indywidualnego programu rozwoju zawodowego',evaluation.development),line('Ostatnia ocena okresowa urzędnika',previousResult),line('Data ostatniej oceny',previousDate),line('Wniosek o kolejny stopień służbowy',serviceDegree),line('Imię i nazwisko oceniającego',manager),line('Stanowisko pracy oceniającego',details.managerPosition),...(type !== 'A' ? [line('Komórka organizacyjna oceniającego',details.managerUnit)] : [])])}<div class="signatures">${signature('Sporządził(a) ocenę',details.finalManagerPlace || review.location,record.signatures?.manager)}${signature('Zapoznał(a) się z oceną',details.finalEmployeePlace || review.location,record.signatures?.employee)}</div><p class="caption"><strong>Pouczenie.</strong> Sprzeciw od oceny można wnieść w ciągu 7 dni od dnia zapoznania się z oceną. Adresat: ${esc(appeal)}. Podstawa: art. 83 ustawy o służbie cywilnej.</p>${details.serviceDegreeAttachment === 'yes' ? `<h2>Część III · Wniosek o przyznanie kolejnego stopnia służbowego</h2>${table('Wniosek o kolejny stopień',[line('Imię i nazwisko urzędnika',employee),line('Rok mianowania',details.appointmentYear),line('Posiadany stopień',details.currentDegree),line('Data przyznania obecnego stopnia',date(details.currentDegreeDate)),line('Wnioskowany stopień',details.requestedDegree),line('Uzasadnienie wniosku',evaluation.serviceDegree)])}${signature('Oceniający',details.degreePlace,details.degreeDate ? {...record.signatures?.manager,at:details.degreeDate} : record.signatures?.manager)}` : ''}</main>`;
}

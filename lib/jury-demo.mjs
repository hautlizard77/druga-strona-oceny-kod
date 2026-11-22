import { buildAction } from '../public/domain.mjs';
import { problem } from './cases.mjs';

export function advanceJuryTrial(record, body) {
  if (body.version !== record.version) throw problem(409,'Sprawę zmieniono od ostatniego odczytu.');
  const current = record.juryTrial;
  let juryTrial;
  if (!current && body.step === 'start') {
    juryTrial = {...buildAction('priorities',record),status:'active',
      startDate:'2026-11-21',reviewDate:'2026-12-21',baselineFrom:'2026-10-22',baselineTo:'2026-11-20',
      baseline:8,baselineTotal:20,targetRate:25};
  } else if (current?.status === 'active' && body.step === 'result') {
    juryTrial = {...current,status:'completed',followUp:4,followUpTotal:8};
  } else if (current?.status === 'completed' && !current.nextTrial && body.step === 'repeat') {
    juryTrial = {...current,decision:'Zmienić',nextTrial:{
      label:'Uzgadniać listę priorytetów na krótkiej odprawie przed przyjęciem kolejki pilnych spraw',
      startDate:'2026-12-21',reviewDate:'2027-01-20',baseline:4,baselineTotal:8,
    }};
  } else {
    throw problem(409,'Wybierz kolejny dostępny krok pokazu.');
  }
  return {...record,juryTrial,version:record.version+1};
}

export function juryTrialCase(source) {
  const record = structuredClone(source);
  record.id = 'demo-proba-zweryfikowana';
  record.title = 'Scenariusz demonstracyjny · próba zweryfikowana';
  record.stage = 'complete';
  record.reviewMeeting = { date:'2026-10-22',location:'Brzeziny',notes:'Rozmowa w fikcyjnej odnodze scenariusza demonstracyjnego.' };
  record.formDetails.periodEnd = '2026-10-22';
  record.evidence = record.evidence.filter(entry => entry.date <= record.formDetails.periodEnd);
  const visibleEvidence = new Set(record.evidence.map(entry => entry.id));
  record.criteria = record.criteria.map(criterion => ({ ...criterion, score:5, justification:'', evidenceIds:criterion.evidenceIds.filter(id => visibleEvidence.has(id)) }));
  record.events = record.events.filter(entry => entry.date <= record.formDetails.periodEnd);
  record.outcome = { summary:'Fikcyjna ocena na poziomie oczekiwań.',development:'Sprawdzać z kierownikiem zmiany priorytetów.',serviceDegree:'' };
  record.signatures = {
    manager: {by:record.managerId,name:record.managerName,date:'2026-10-22',at:'2026-10-22T10:00:00Z'},
    employee: {by:record.employeeId,name:record.employeeName,date:'2026-10-22',at:'2026-10-22T10:30:00Z'},
  };
  record.action = {
    ...buildAction('priorities', record), obstacle:'priorities',
    startDate:'2026-10-22',reviewDate:'2026-11-21',completedAt:'2026-11-21T10:00:00Z',
    baselineFrom:'2026-09-22',baselineTo:'2026-10-21',baseline:8,baselineTotal:20,
    followUp:4,followUpTotal:8,targetRate:25,status:'completed',decision:'Zmienić',
    note:'Po zmianie liczba spraw była niższa. Przed decyzją porównajmy wynik w kolejnym okresie.',
    employeeComment:'W tygodniach z małą liczbą spraw więcej z nich miało pilny termin.',
  };
  record.history.push({at:'2026-11-21T10:00:00Z',action:'Zapisano fikcyjny wynik próby'});
  return record;
}

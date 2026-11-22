import { addDays, addMonths, buildAction, evaluateRules, newCase } from '../public/domain.mjs';
import { captureOpening } from './cases.mjs';

const teams = {
  service:{unit:'Wydział Obsługi Spraw',managerId:'demo-manager',managerName:'Michał Nowicki'},
  control:{unit:'Wydział Kontroli i Organizacji',managerId:'demo-manager-control',managerName:'Aleksandra Rybak'},
};
const people = [
  {id:'bartosz',name:'Bartosz Kaczmarek',position:'Specjalista ds. wniosków',stage:'complete',sample:[9,30,3,27],note:'Wprowadził sprawdzenie listy załączników przed rejestracją wniosku.'},
  {id:'celina',name:'Celina Maj',position:'Referentka ds. korespondencji',stage:'complete',sample:[8,25,3,26],note:'Uzgodniła z zespołem kolejność rejestrowania pism przekazanych pod koniec dnia.'},
  {id:'dawid',name:'Dawid Lis',position:'Specjalista ds. obsługi interesantów',stage:'complete',sample:[7,24,5,29],note:'Odnotował zgłoszenia wymagające odpowiedzi z drugiego wydziału i przekazał je koordynatorowi.'},
  {id:'ewa',name:'Ewa Baran',position:'Koordynatorka punktu obsługi',form:'B',stage:'complete',sample:[11,34,6,32],note:'Rozdzieliła zastępstwa na czas wzmożonego napływu wniosków.'},
  {id:'filip',name:'Filip Wójcik',position:'Inspektor ds. kontroli',team:'control',stage:'complete',sample:[10,28,8,30],note:'Uzupełnił harmonogram kontroli o terminy pozyskania dokumentów.'},
  {id:'gabriela',name:'Gabriela Zając',position:'Specjalistka ds. organizacji pracy',team:'control',stage:'complete',sample:[5,17,3,18],option:'workload',note:'Sprawdziła obciążenie dyżurów w dwóch kolejnych tygodniach.'},
  {id:'hubert',name:'Hubert Sikora',position:'Inspektor ds. kontroli wewnętrznej',team:'control',stage:'review',event:'absence',note:'Zestawił ustalenia z kontroli i przedstawił zespołowi listę rozbieżności.',reply:'Jedno zestawienie uzupełniłem po otrzymaniu dokumentów z jednostki.'},
  {id:'ida',name:'Ida Dudek',position:'Specjalistka ds. obsługi spraw',stage:'review',event:'position-change',note:'Po przejęciu nowego zakresu obowiązków przygotowała wykaz spraw w toku.'},
  {id:'jakub',name:'Jakub Pawlak',position:'Kierownik oddziału obsługi',form:'B',stage:'sign',acknowledgmentPending:true,note:'Wdrożył harmonogram zastępstw i sprawdził go podczas urlopów zespołu.'},
  {id:'karolina',name:'Karolina Nowak',position:'Referentka ds. dokumentacji',stage:'start',note:'W pierwszym kwartale uporządkuje obieg dokumentów przekazywanych do akt.'},
  {id:'lena',name:'Lena Mazur',position:'Kierowniczka urzędu',form:'A',team:'control',stage:'setup'},
  {id:'marek',name:'Marek Adamczyk',position:'Specjalista ds. obsługi zgłoszeń',stage:'observations',event:'earlier-request',note:'Zgłosił ryzyko opóźnienia po zmianie zakresu zadania i zaproponował nowy harmonogram.',reply:'Termin uzgodniliśmy po potwierdzeniu dostępności drugiej komórki.'},
];

function attestation(id,name,date) {
  return {by:id,name,date,at:`${date}T09:00:00Z`};
}

function exampleCase(person, primary, today) {
  const team = teams[person.team ?? 'service'];
  const complete = person.stage === 'complete';
  const recentStart = ['setup','start'].includes(person.stage);
  const startDate = recentStart ? addDays(today,person.stage === 'setup' ? -5 : -12)
    : addDays(addMonths(today,-24),complete ? -46 : person.event === 'absence' ? -33 : 3);
  const record = newCase({
    id:`demo-office-${person.id}`,title:`Ocena okresowa · ${person.name}`,positionType:person.form ?? 'C',
    office:primary.office,officeId:primary.officeId,employeeId:`demo-staff-${person.id}`,employeeName:person.name,
    managerId:team.managerId,managerName:team.managerName,position:person.position,startDate,
    formDetails:{employeeUnit:team.unit,managerUnit:team.unit,managerPosition:'Kierownik wydziału',
      appealAuthority:'Dyrektor generalny urzędu'},
  });
  record.stage = person.stage;
  const opened = addDays(startDate,5);
  if (person.stage !== 'setup') {
    record.startMeeting = {
      ...record.startMeeting,date:opened,location:'Brzeziny',notes:'Omówiono obowiązki, kryteria i sposób zapisywania przykładów.',
      duties:`Zadania stanowiska: ${person.position}.`,
      goals:person.stage === 'start' ? person.note : 'Uzgadniać zmianę terminu i zapisywać przyczyny przesunięcia sprawy.',
      signedManager:attestation(team.managerId,team.managerName,opened),
      signedEmployee:recentStart ? null : attestation(record.employeeId,person.name,opened),
    };
  }
  if (record.startMeeting.signedEmployee) record.openingSnapshot = captureOpening(record);
  const reviewDate = addDays(today,complete ? -52 : -2);
  if (!recentStart) {
    const evidenceDate = addDays(reviewDate,-9);
    const criterion = record.criteria[0];
    record.evidence = [{id:`${record.id}-observation`,date:evidenceDate,text:person.note,criterion:criterion.name,
      tone:'positive',shared:true,authorId:team.managerId}];
    criterion.evidenceIds = [record.evidence[0].id];
    criterion.justification = person.note;
    if (person.reply) record.contexts.push({id:`${record.id}-reply`,evidenceId:record.evidence[0].id,
      text:person.reply,date:addDays(evidenceDate,1),authorId:record.employeeId});
  }
  if (person.event) {
    const event = {id:`${record.id}-event`,type:person.event,date:addDays(today,-31)};
    if (person.event === 'absence') Object.assign(event,{date:addDays(today,-81),endDate:addDays(today,-39),note:'Usprawiedliwiona nieobecność z zamkniętym okresem.'});
    if (person.event === 'earlier-request') Object.assign(event,{newDueDate:addDays(today,3),
      noticeReference:'DEMO.08/OC',noticeDate:addDays(today,-22),note:'Indywidualnie uzgodniona data rozmowy i sporządzenia oceny.'});
    record.events.push(event);
    record.dueDate = evaluateRules(record).dueDate;
  }
  if (['review','sign','complete'].includes(person.stage)) {
    record.reviewMeeting = {date:reviewDate,location:'Brzeziny',notes:'Przegląd ustaleń i przykładów z ocenianego okresu.'};
  }
  if (person.acknowledgmentPending || complete) {
    record.formDetails.assessmentDate = reviewDate;
    record.outcome = {summary:'Omówiono terminowość i współpracę na podstawie wpisu z okresu.',development:'Raz w tygodniu potwierdzać priorytety i terminy.',serviceDegree:''};
    record.criteria.forEach(item => {item.score = 5;});
    record.signatures.manager = attestation(team.managerId,team.managerName,reviewDate);
  }
  if (complete) {
    record.signatures.employee = attestation(record.employeeId,person.name,addDays(reviewDate,1));
    const [baseline,baselineTotal,followUp,followUpTotal] = person.sample;
    const action = buildAction(person.option ?? 'priorities',record);
    record.action = {...action,obstacle:person.option ?? 'priorities',status:'completed',baseline,baselineTotal,
      baselineFrom:addDays(action.startDate,-30),baselineTo:addDays(action.startDate,-1),
      followUp,followUpTotal,completedAt:`${action.reviewDate}T09:00:00Z`,decision:'Kontynuować',
      note:'Utrzymać uzgodniony sposób planowania i wrócić do pomiaru przy kolejnej zmianie obciążenia.'};
  } else if (person.id === 'ida') {
    record.action = {...buildAction('priorities',record),obstacle:'priorities',baseline:5,baselineTotal:19,
      baselineFrom:addDays(reviewDate,-30),baselineTo:addDays(reviewDate,-1),targetRate:20};
  }
  record.history.push({at:`${startDate}T09:00:00Z`,actorId:team.managerId,action:'Utworzono fikcyjną sprawę demonstracyjną'});
  return record;
}

export function officeDemo(primary, today) {
  const users = [
    {id:teams.control.managerId,username:'kierownik-kontrola',name:teams.control.managerName,role:'manager'},
    ...people.map(person => ({
      id:`demo-staff-${person.id}`,username:`demo-${person.id}`,name:person.name,role:'employee',
      directManagerId:teams[person.team ?? 'service'].managerId,
    })),
  ].map(user => ({...user,officeId:primary.officeId,officeName:primary.office}));
  const cases = people.map(person => exampleCase(person,primary,today));
  return {users,cases};
}

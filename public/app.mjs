import { ACTION_OPTIONS, buildAction, CASE_TYPES, FORM_META, formsFor, ROLES, RULESET, SCORE_OPTIONS, STAGES, addDays, analyzeEvidence, evaluateRules, observationInPeriod, observationPeriod, formFor } from './domain.mjs';
import { button, callout, date, empty, esc, field, icon, pill, submit } from './ui.mjs';
import { printView } from './print.mjs';
import { reminderCalendar, taskReminderCalendar } from './calendar.mjs';
import { buildWorkQueue } from './work-queue.mjs';
import { optionSummary, trialComparison, trialFollowup, trialForm, trialHistory, metricDefinitionView } from './trial-view.mjs';
import { trialInsightsView } from './trial-insights-view.mjs';

const app = document.querySelector('#app');
const dialog = document.querySelector('#dialog');
const messages = document.querySelector('#notice');
const today = () => new Intl.DateTimeFormat('sv-SE', {timeZone:'Europe/Warsaw'}).format(new Date());
const stageLabels = { setup:'Arkusz', start:'Rozmowa początkowa', observations:'Obserwacje', review:'Rozmowa oceniająca', sign:'Podpisy', complete:'Zakończona' };
const stage = id => stageLabels[id] ?? id;
const role = id => ROLES[id] ?? (id === 'director' ? 'Dyrekcja' : id);
const initial = {user:null, demoAccounts:[], config:RULESET, cases:[], record:null, panel:'process', step:'setup', screen:'home', print:false, selectedOption:ACTION_OPTIONS[0]?.id,repeatTrial:false,showDemoInsights:false};
const state = {...initial};
const canEdit = () => state.user?.role === 'manager' && !state.record?.signatures?.manager && state.record?.stage !== 'complete';
const stageIndex = id => STAGES.findIndex(item => item.id === id);
let toastTimer;
let busy = false;

async function api(path, method = 'GET', body) {
  const response = await fetch(`/api${path}`, {method, credentials:'same-origin', ...(body === undefined ? {} : {headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)})});
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.message ?? data.error ?? 'Wystąpił błąd zapisu.');
    error.status = response.status;
    error.details = data.details;
    throw error;
  }
  return data;
}

function announce(text, isError = false) {
  clearTimeout(toastTimer);
  messages.textContent = text;
  messages.hidden = false;
  messages.classList.toggle('error', isError);
  toastTimer = setTimeout(() => { messages.hidden = true; }, isError ? 8500 : 4300);
}

function modal(title, body) {
  dialog.innerHTML = `<div class="row between dialog-head"><h2 id="dialog-title">${esc(title)}</h2>${button('Zamknij','close',{style:'text',glyph:'close'})}</div>${body}`;
  if (!dialog.open) dialog.showModal();
}

function readForm(target) { return new FormData(target); }
function selectedForm(value) { const found = formFor(value); return typeof found === 'string' ? found : value; }
function stagesFor(record) { return evaluateRules(record, record.ruleSnapshot ?? state.config); }
function currentIssues(record) { return stagesFor(record).issues.filter(issue => issue.stage === record.stage); }

async function loadHome(screen = 'home') {
  if (state.user.role === 'director' || screen === 'stats') {
    state.stats = (await api('/statistics')).statistics;
    state.screen = 'stats';
  } else {
    state.cases = (await api('/cases')).cases;
    state.screen = screen;
  }
  state.record = null;
  render();
}

async function openRecord(id, {step, panel} = {}) {
  state.record = (await api(`/cases/${encodeURIComponent(id)}`)).record;
  state.step = step ?? state.record.stage;
  state.panel = panel ?? (state.user.role === 'employee' && state.record.stage === 'review' ? 'evidence' : 'process');
  state.selectedOption = state.record.action?.optionId ?? ACTION_OPTIONS[0]?.id;
  state.repeatTrial = false;
  state.partnerCriterion = null;
  state.screen = 'record';
  render();
}

async function update(changes, message, nextView = {}) {
  const id = state.record.id;
  try {
    const data = await api(`/cases/${encodeURIComponent(id)}`, 'PATCH', {version:state.record.version, changes});
    state.record = data.record;
    Object.assign(state, nextView);
    if (dialog.open) dialog.close();
    render();
    if (message) announce(message);
  } catch (error) {
    if (error.status === 409 && error.message.includes('ostatniego odczytu')) {
      await openRecord(id, {step:state.step, panel:state.panel});
      if (dialog.open) dialog.close();
      announce(error.message || 'Sprawę zmieniono w innym oknie. Odświeżono dane.', true);
      return;
    }
    throw error;
  }
}

function meetingLink(id) {
  return `<a class="btn secondary" href="/rozmowa.html#${encodeURIComponent(id)}">${icon('message')}Wspólny ekran rozmowy</a>`;
}

function demoAccountGroups(simple = false) {
  const accounts = state.demoAccounts;
  const primary = ['kierownik','pracownik','kadry','dyrektor'];
  const cards = people => `<div class="demo-roles">${people.map(account => {
    if (simple && primary.includes(account.username)) {
      return button(role(account.role),'demo-login',{style:'secondary',glyph:'person',value:account.username});
    }
    return `<button type="button" class="btn secondary" data-act="demo-login" data-value="${esc(account.username)}">${icon('person')}<span>${esc(role(account.role))}<small>${esc(account.name)}</small></span></button>`;
  }).join('')}</div>`;
  const additional = accounts.filter(account => !primary.includes(account.username));
  return `${cards(accounts.filter(account => primary.includes(account.username)))}${additional.length
    ? `<details><summary>Więcej kont demonstracyjnych (${additional.length})</summary>${cards(additional)}</details>` : ''}`;
}

function loginView() {
  const accounts = state.demoAccounts;
  const demo = accounts.length ? `<section class="login-demo stack">
    <div class="row between"><h2>Konta demonstracyjne</h2>${pill('Dane fikcyjne','neutral')}</div>
    ${accounts.some(person => person.role === 'manager') ? `<div>${button('Zobacz rozmowę Anny','demo-meeting',{glyph:'message'})}</div>` : ''}
    ${demoAccountGroups()}
  </section>` : '';
  return `<main id="main" class="login">
    <header class="portal-masthead"><div class="portal-width"><div class="brand"><span class="brand-mark" aria-hidden="true">D</span><span>Druga Strona Oceny<small>Oceny okresowe służby cywilnej</small></span></div></div></header>
    <div class="login-main">
      <div class="title-block"><p class="eyebrow">Służba cywilna</p><h1>Oceny okresowe</h1></div>
      <div class="login-panels">
        ${demo}
        <form class="stack" data-form="login">
          <h2>Zaloguj się do urzędu</h2>
          ${field('username','Login','',{required:true,extra:'autocomplete="username"'})}
          ${field('password','Hasło','',{type:'password',required:true,extra:'autocomplete="current-password"'})}
          <div>${submit('Zaloguj się','person')}</div>
        </form>
      </div>
    </div>
  </main>`;
}

function shell(body, crumb) {
  const user = state.user;
  const managerOrEmployee = ['manager','employee'].includes(user.role);
  const links = [ ...(user.role !== 'director' ? [['home','home','Pulpit'],['queue','check','Zadania'],['cases','file','Oceny okresowe']] : []), ...(managerOrEmployee ? [] : [['stats','stats','Statystyki']]), ...(user.role === 'hr' ? [['config','settings','Reguły urzędu'],['supervisors','person','Podległość']] : []) ];
  const avatar = user.name.split(' ').slice(0,2).map(word => word[0]).join('');
  const home = user.role === 'director' ? 'stats' : 'home';
  const nav = links.map(([id,glyph,label]) => `<button type="button" data-act="navigate" data-value="${id}"${state.screen === id || (id === 'cases' && state.screen === 'record') ? ' aria-current="page"' : ''}>${icon(glyph)}${label}</button>`).join('');
  return `<div class="portal">
    <header class="portal-masthead">
      <div class="portal-width row between">
        <button type="button" class="brand" data-act="navigate" data-value="${home}">
          <span class="brand-mark" aria-hidden="true">D</span>
          <span>Druga Strona Oceny<small>Oceny okresowe służby cywilnej</small></span>
        </button>
        <div class="profile"><div class="avatar" aria-hidden="true">${esc(avatar)}</div><span><strong>${esc(user.name)}</strong><small>${esc(role(user.role))}</small></span></div>
      </div>
    </header>
    <div class="portal-navigation"><div class="portal-width row between">
      <nav aria-label="Menu główne">${nav}</nav>
      <div class="portal-account row">
        ${state.demoAccounts.length ? button('Zmień rolę','roles',{style:'text',glyph:'person'}) : ''}
        ${button('Wyloguj się','logout',{style:'text',glyph:'logout'})}
      </div>
    </div></div>
    <div class="portal-location portal-width row between">
      <span class="crumb">${esc(crumb)}</span>
      <span class="portal-office">${esc(user.officeName ?? 'Urząd')} ${state.demoAccounts.length ? pill('Dane demonstracyjne','neutral') : ''}</span>
    </div>
    <main id="main" class="content portal-width">${body}</main>
  </div>`;
}

function casesTable() {
  if (!state.cases.length) return `<div class="surface">${empty('Nie ma jeszcze ocen okresowych dostępnych na tym koncie.')}</div>`;
  return `<div class="surface flush"><div class="table-wrap"><table class="table"><thead><tr><th>Pracownik</th><th>Arkusz</th><th>Termin</th><th>Etap</th><th>Sprawa</th></tr></thead><tbody>${state.cases.map(record => `<tr><td><strong>${esc(record.employeeName)}</strong><br><span class="small sub">${esc(record.position)}</span></td><td>${esc(record.formType ?? record.positionType)}</td><td>${date(record.dueDate)}</td><td>${pill(stage(record.stage),record.stage === 'complete' ? '' : 'neutral')}</td><td>${button('Otwórz','record',{style:'secondary',value:record.id})}</td></tr>`).join('')}</tbody></table></div></div>`;
}

function queueCard(task, compact = false) {
  const urgency = {overdue:'Po terminie',today:'Dzisiaj',soon:'Zbliża się termin'}[task.dueState];
  const status = task.dueDate ? pill([urgency,date(task.dueDate)].filter(Boolean).join(' · '),urgency ? 'warning' : 'neutral') : '';
  const target = [task.recordId,task.panel,task.step ?? ''].join('/');
  return `<li class="queue-card"><div class="stack tight"><div class="row">${status}${task.optional ? pill('Opcjonalne','neutral') : ''}</div><h3>${esc(task.title)}</h3><p class="small sub">${esc(task.employeeName)}${!compact && task.description ? ` · ${esc(task.description)}` : ''}</p></div><div class="row">${!compact && ['soon','upcoming'].includes(task.dueState) ? button('Do kalendarza','queue-calendar',{style:'text',glyph:'calendar',value:task.id}) : ''}${button('Przejdź do sprawy','queue-task',{style:'secondary',value:target})}</div></li>`;
}

function queueView() {
  const {tasks,waiting} = buildWorkQueue(state.cases,state.user.role,today());
  return shell(`<div class="title-block"><h1>Zadania</h1><p class="sub">Czynności dostępne na Twoim koncie, uporządkowane według terminu.</p></div><section class="surface stack"><h2>Do zrobienia</h2>${tasks.length ? `<ul class="timeline">${tasks.map(task => queueCard(task)).join('')}</ul>` : empty('Nie masz czynności do wykonania w dostępnych sprawach.')}</section><section class="surface stack"><h2>Oczekujące</h2>${waiting.length ? `<ul class="timeline">${waiting.map(task => queueCard(task)).join('')}</ul>` : empty('Brak spraw czekających na inny etap.')}</section>`, 'Zadania');
}

function homeView() {
  const manager = state.user.role === 'manager';
  if (state.screen === 'cases') return shell(`<div class="row between"><div class="title-block"><h1>Oceny okresowe</h1><p class="sub">Sprawy dostępne na Twoim koncie.</p></div>${manager ? button('Nowa ocena','new',{glyph:'plus'}) : ''}</div>${casesTable()}`, 'Oceny okresowe');
  const featured = state.cases.find(record => record.stage !== 'complete') ?? state.cases[0];
  const count = state.cases.filter(record => record.stage !== 'complete').length;
  const ready = state.cases.filter(record => ['review','sign'].includes(record.stage)).length;
  const next = buildWorkQueue(state.cases,state.user.role,today()).tasks.filter(task => !task.optional).slice(0,3);
  const work = next.length ? `<section class="surface stack"><div class="row between"><h2>Najbliższe zadania</h2>${button('Wszystkie zadania','navigate',{style:'text',value:'queue'})}</div><ul class="timeline">${next.map(task => queueCard(task,true)).join('')}</ul></section>` : '';
  const upcoming = state.cases.filter(record => record.stage !== 'complete' && record.dueDate && record.dueDate <= addDays(today(),14)).sort((left,right) => left.dueDate.localeCompare(right.dueDate));
  const reminders = upcoming.length ? `<section class="surface stack"><h2>Nadchodzące terminy</h2><ul class="timeline">${upcoming.slice(0,4).map(record => `<li class="row between"><strong>${esc(record.employeeName)}</strong><div class="row">${pill(record.dueDate < today() ? `Po terminie · ${date(record.dueDate)}` : date(record.dueDate),'warning')}${button('Przypomnienie w kalendarzu','calendar',{style:'text',glyph:'calendar',value:record.id})}</div></li>`).join('')}</ul></section>` : '';
  const hero = `<section class="dashboard-heading"><div class="title-block"><h1>Pulpit ocen okresowych</h1><p>${manager ? 'Przejrzyj obserwacje, przygotuj uzasadnienie i uzgodnij działanie po rozmowie.' : 'Zobacz terminy, udostępnione obserwacje i działania uzgodnione po rozmowie.'}</p></div><div class="row">${featured ? button('Otwórz sprawę','record',{glyph:'file',value:featured.id}) : ''}${featured && ['manager','employee'].includes(state.user.role) ? meetingLink(featured.id) : ''}${manager ? button('Nowa ocena','new',{style:'secondary',glyph:'plus'}) : ''}</div></section>`;
  return shell(`${hero}<div class="grid-stat portal-stat-strip">${[[count,'W toku'],[ready,'Rozmowa lub podpis'],[state.cases.length - count,'Zakończone']].map(([n,label]) => `<div class="surface stat"><strong>${n}</strong><span>${label}</span></div>`).join('')}</div>${work}${reminders}<div class="row between"><h2>Sprawy</h2>${button('Wszystkie oceny','navigate',{style:'text',value:'cases'})}</div>${casesTable()}`, 'Pulpit');
}

function statisticsView() {
  const data = state.stats ?? {};
  const slots = [['total','Wszystkie oceny'],['overdue','Po terminie'],['completed','Zakończone'],['activeActions','Działania w toku']];
  const real = data.trialInsights ? trialInsightsView(data.trialInsights) : '';
  const sample = data.demoTrialInsights ? `<div>${button(state.showDemoInsights ? 'Ukryj przykładowe zestawienie' : 'Pokaż przykładowe zestawienie','insights-demo',{style:'secondary',glyph:'stats'})}</div>${state.showDemoInsights ? trialInsightsView(data.demoTrialInsights,{demo:true}) : ''}` : '';
  return shell(`<div class="title-block"><h1>Statystyki urzędu</h1><p class="sub">Podsumowanie przebiegu ocen i działań rozwojowych.</p></div><div class="grid-stat">${slots.map(([key,label]) => `<div class="surface stat"><strong>${esc(data[key] ?? 0)}</strong><span>${label}</span></div>`).join('')}</div>${real}${sample}<section class="surface stack"><h2>Oceny według etapu</h2><dl class="definition">${STAGES.map(item => `<dt>${esc(stage(item.id))}</dt><dd>${esc(data.byStage?.[item.id] ?? 0)}</dd>`).join('')}</dl></section>`, 'Statystyki');
}

function configView() {
  const config = state.config;
  return shell(`<div class="title-block"><h1>Reguły urzędu</h1><p class="sub">Wersja ${esc(config.version)}. Nowe sprawy zapisują obowiązującą w momencie rozpoczęcia wersję konfiguracji.</p></div><section class="surface stack"><h2>Parametry procesu</h2><p class="sub">Aktualizuj parametry po potwierdzeniu podstawy prawnej i zasad przejściowych.</p><form data-form="config" class="stack"><div class="form-grid">${field('months','Podstawowy okres oceny (miesiące)',config.months,{type:'number',required:true,extra:'min="1" max="60"'})}${field('maxAdditional','Limit dodatkowych kryteriów',config.maxAdditional,{type:'number',required:true,extra:'min="0" max="3"'})}</div><div>${submit('Zapisz nową wersję reguł')}</div></form><p class="small"><a href="https://eli.gov.pl/eli/DU/2016/470/ogl" target="_blank" rel="noreferrer">Rozporządzenie w sprawie ocen okresowych</a></p></section>`, 'Reguły urzędu');
}

function caseView(record) {
  const tabs = [['process','Przebieg oceny'],['evidence','Obserwacje'],['partner','Partner HR'],['documents','Dokumenty i historia']];
  const heading = `<div class="case-header"><div class="title-block"><p class="eyebrow">Ocena okresowa · arkusz ${esc(record.formType ?? record.positionType)}</p><h1>${esc(record.employeeName)}</h1><div class="case-meta"><span>${icon('person')}${esc(record.position)}</span><span>${icon('calendar')}Termin ${date(record.dueDate)}</span><span>${pill(stage(record.stage))}</span>${record.positionWindow ? `<span>Okno sporządzenia oceny ${date(record.positionWindow.from)} – ${date(record.positionWindow.to)}</span>` : ''}</div></div><div class="row">${['manager','employee'].includes(state.user.role) ? meetingLink(record.id) : ''}${button('Wróć do listy','navigate',{style:'secondary',value:'cases'})}</div></div>`;
  const nav = `<nav class="tabs" aria-label="Widoki sprawy">${tabs.map(([id,label]) => `<button type="button" data-act="panel" data-value="${id}"${state.panel === id ? ' aria-current="page"' : ''}>${label}</button>`).join('')}</nav>`;
  let body;
  if (state.panel === 'evidence') body = evidenceView(record);
  else if (state.panel === 'partner') body = partnerView(record);
  else if (state.panel === 'documents') body = documentsView(record);
  else body = processView(record);
  return shell(`${heading}${nav}${body}`, `Oceny okresowe / ${record.employeeName}`);
}

function processView(record) {
  const current = stageIndex(record.stage);
  const stepper = `<ol class="stage-stepper" aria-label="Etapy oceny">${STAGES.map((item,index) => `<li class="${index < current ? 'done' : index === current ? 'current' : ''}"><button type="button" data-act="step" data-value="${esc(item.id)}"${state.step === item.id ? ' aria-current="step"' : ''}><span class="step-icon">${index < current ? icon('check') : index+1}</span>${esc(stage(item.id))}</button></li>`).join('')}</ol>`;
  const views = {setup:setupView,start:startView,observations:observationsStep,review:reviewView,sign:signView,complete:completedView};
  const locked = stageIndex(state.step) > current && state.step !== 'complete';
  const body = locked ? `<section class="surface"><h2>${esc(stage(state.step))}</h2>${empty('Ten etap będzie dostępny po wykonaniu poprzednich kroków.')}</section>` : (views[state.step] ?? setupView)(record);
  const eventSection = ['manager','hr'].includes(state.user.role) ? eventsView(record) : '';
  return `${stepper}${body}${eventSection}`;
}

function advance(record, label) {
  if (state.step !== record.stage || !canEdit() || record.stage === 'complete') return '';
  const issues = currentIssues(record);
  return `<div class="stack tight">${issues.length ? callout(`<strong>Przed następnym etapem</strong><ul>${issues.map(issue => `<li>${esc(issue.message)} ${issue.field ? button('Przejdź do pola',issue.field === 'date' ? 'review-date' : 'details',{style:'text',value:issue.field}) : ''}</li>`).join('')}</ul>`,'warning') : ''}<div>${button(label,'advance',{glyph:'check'})}</div></div>`;
}

function setupView(record) {
  const formType = record.formType ?? record.positionType;
  const info = formsFor(record)[formType];
  const allow = canEdit() && record.stage === 'setup';
  const required = info?.requiredCriteria ?? [];
  const optional = info?.optionalCriteria ?? [];
  const checked = record.criteria.filter(item => !item.required).map(item => item.name);
  return `<div class="split"><section class="surface stack"><div><h2>Arkusz i kryteria</h2><p class="sub">${esc(info?.title ?? `Arkusz ${formType}`)}</p></div><p><strong>Kryteria obowiązkowe</strong></p><ul class="criteria">${required.map(label => `<li>${esc(label)}</li>`).join('')}</ul>${allow ? `<form data-form="criteria" class="stack"><fieldset class="checks"><legend>Kryteria dodatkowe · maks. ${esc(record.ruleSnapshot?.maxAdditional ?? state.config.maxAdditional)}</legend>${optional.map(name => `<label class="check"><input type="checkbox" name="optional" value="${esc(name)}"${checked.includes(name) ? ' checked' : ''}>${esc(name)}</label>`).join('')}</fieldset><div>${submit('Zapisz kryteria')}</div></form>` : `<p class="sub small">Kryteria dodatkowe ${checked.length ? esc(checked.join(', ')) : '—'}</p>`}${advance(record,'Rozpocznij rozmowę początkową')}</section><aside class="surface stack"><h3>Dane oceny</h3><dl class="definition"><dt>Wzór</dt><dd>${esc(formType)}</dd><dt>Przełożony</dt><dd>${esc(record.managerName)}</dd><dt>Data rozpoczęcia</dt><dd>${date(record.startDate)}</dd><dt>Termin</dt><dd>${date(record.dueDate)}</dd></dl><div class="row">${allow ? button('Zmień dane i arkusz','edit-setup',{style:'secondary'}) : ''}${button('Pokaż formularz','print',{style:'secondary',glyph:'printer'})}</div></aside></div>`;
}

function signName(value) { return value ? (typeof value === 'object' ? `${value.name ?? 'Potwierdzono'} · ${date(value.at ?? value.date)}` : typeof value === 'string' ? value : 'Potwierdzono') : 'Oczekuje na potwierdzenie'; }

function startView(record) {
  const meeting = record.startMeeting ?? {};
  const allow = canEdit() && record.stage === 'start';
  const employee = state.user.role === 'employee';
  return `<div class="split"><section class="surface stack"><h2>Rozmowa rozpoczynająca</h2><p><strong>Termin z części I</strong> · ${record.startMeeting.signedEmployee && !record.openingSnapshot ? 'Brak zapisu wersji potwierdzonej' : date(record.openingSnapshot?.dueDate || record.dueDate)}</p><p><strong>Kryteria</strong> · ${esc((record.openingSnapshot?.criteria ?? record.criteria).map(item=>item.name).join(", "))}</p>${allow ? `<form class="stack" data-form="start"><div class="form-grid">${field('date','Data rozmowy',meeting.date || today(),{type:'date',required:true})}${field('location','Miejscowość',meeting.location,{required:true})}</div>${field('notes','Ustalone oczekiwania i sposób oceny',meeting.notes,{type:'textarea',required:true})}${field('duties','Najważniejsze obowiązki na stanowisku',meeting.duties,{type:'textarea',extra:'maxlength="1000"',hint:'Wpisz obowiązki z opisu stanowiska, po jednym wierszu. Zapisz, aby użyć ich w pytaniach.'})}${field('goals','Uzgodnione cele na okres oceny',meeting.goals,{type:'textarea',extra:'maxlength="2000"'})}<div>${submit('Zapisz rozmowę')}</div></form>` : `<dl class="definition"><dt>Rozmowa</dt><dd>${date(meeting.date)}</dd><dt>Miejscowość</dt><dd>${esc(meeting.location || '—')}</dd><dt>Ustalenia</dt><dd>${esc(meeting.notes || '—')}</dd><dt>Obowiązki</dt><dd class="meeting-goals">${esc(meeting.duties || '—')}</dd><dt>Cele</dt><dd class="meeting-goals">${esc(meeting.goals || '—')}</dd></dl>`}<div class="signatures"><div><h3>Oceniający</h3><p>${esc(signName(meeting.signedManager))}</p>${allow && meeting.date && !meeting.signedManager ? button('Potwierdź ustalenia','meeting-sign',{style:'secondary',value:'signedManager'}) : ''}</div><div><h3>Oceniany</h3><p>${esc(signName(meeting.signedEmployee))}</p>${employee && record.stage === 'start' && meeting.signedManager && !meeting.signedEmployee ? button('Potwierdź zapoznanie','meeting-sign',{style:'secondary',value:'signedEmployee'}) : ''}</div></div>${advance(record,'Rozpocznij zbieranie obserwacji')}</section><aside class="surface stack"><h3>Przygotuj rozmowę</h3><ul class="source-list">${openingPrompts(record)}</ul></aside></div>`;
}

function openingPrompts(record) {
  const examples = {
    'Współpraca':'Uzgodnij, kto przejmuje sprawę oraz jakie informacje przekazać przy zastępstwie.',
    'Komunikacja':'Ustal, kiedy i w jakiej formie zgłaszać zmianę terminu lub ryzyko.',
    'Rzetelność':'Ustal, które elementy dokumentu pracownik sprawdza przed przekazaniem dalej.',
  };
  const duties = (record.startMeeting?.duties ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const examplesByForm = {A:'Jak sprawdzicie wykonanie priorytetów urzędu?', B:'Jak sprawdzicie podział zadań i zastępstwa w zespole?', C:'Jak sprawdzicie terminowość i kompletność typowych spraw?'};
  const selected = record.criteria.map(({name}) => `<li><strong>${esc(name)}</strong>. ${esc(examples[name] ?? 'Wybierz konkretne zadanie ze stanowiska i nazwij wynik, sposób sprawdzenia oraz termin.')}</li>`);
  return `<li>Jakie obowiązki na stanowisku „${esc(record.position)}” zajmują najwięcej czasu? Które z nich zamienicie w cele?</li>${duties.length ? duties.slice(0,4).map(duty => `<li>Jak zmierzycie wykonanie zadania „${esc(duty)}” i do kiedy?</li>`).join('') : `<li>${esc(examplesByForm[record.formType] ?? examplesByForm.C)}</li>`}${selected.join('')}`;
}

function observationsStep(record) {
  return `<section class="surface stack"><h2>Obserwacje w okresie oceny</h2><p class="sub">Zapisano ${record.evidence.length} obserwacji dostępnych na tym koncie. Można powiązać je z konkretnymi kryteriami i wrócić do nich przed rozmową.</p><div>${button('Otwórz oś obserwacji','panel',{style:'secondary',value:'evidence',glyph:'message'})}</div>${advance(record,'Przejdź do rozmowy oceniającej')}</section>`;
}

function evidenceView(record) {
  const allow = canEdit() && ['observations','review'].includes(record.stage);
  const employee = state.user.role === 'employee';
  const evidence = [...record.evidence].sort((left,right) => right.date.localeCompare(left.date));
  const period = observationPeriod(record);
  const entries = evidence.map(entry => {
    const contexts = record.contexts.filter(context => context.evidenceId === entry.id);
    return `<li class="event-card" id="observation-${esc(entry.id)}" tabindex="-1"><div class="row between"><span class="date">${date(entry.date)}</span>${pill(entry.shared ? 'Udostępniona pracownikowi' : 'Wewnętrzna','neutral')}${observationInPeriod(entry,period) ? '' : pill('Kontekst spoza okresu','warning')}</div>${entry.criterion ? `<strong>${esc(entry.criterion)}</strong>` : ''}<p>${esc(entry.text)}</p>${contexts.map(context => `<div class="context"><strong>Kontekst pracownika</strong><p>${esc(context.text)}</p></div>`).join('')}${employee && entry.shared && ['observations','review'].includes(record.stage) ? `<div>${button('Dodaj kontekst','context',{style:'text',glyph:'message',value:entry.id})}</div>` : ''}${allow ? `<div>${button('Edytuj obserwację','evidence-edit',{style:'text',value:entry.id})}</div>` : ''}</li>`;
  }).join('');
  return `<div class="split"><section class="surface stack"><div class="row between"><h2>Oś obserwacji</h2>${allow ? button('Dodaj obserwację','evidence-edit',{glyph:'plus'}) : ''}</div>${entries ? `<ol class="timeline">${entries}</ol>` : empty('Brak obserwacji na tym koncie.')}</section><aside class="surface stack"><h3>Obserwacja do rozmowy</h3><p class="sub">Zapisz datę, zdarzenie oraz skutek dla pracy. Powiąż je z kryterium i zaznacz udostępnienie, gdy pracownik ma móc dodać swój kontekst.</p>${button('Otwórz partnera HR','panel',{style:'secondary',glyph:'spark',value:'partner'})}</aside></div>`;
}

function reviewView(record) {
  const meeting = record.reviewMeeting ?? {};
  const allow = canEdit() && ['review','sign'].includes(record.stage);
  const rules = stagesFor(record);
  const options = [{value:'',label:'Wybierz poziom'}, ...SCORE_OPTIONS];
  const period = observationPeriod(record);
  const eligible = record.evidence.filter(entry => observationInPeriod(entry,period));
  const cards = record.criteria.map((criterion,index) => `<fieldset class="score-block stack tight"><legend><strong>${esc(criterion.name)}</strong></legend>${allow ? `${field(`score-${index}`,'Poziom wybrany przez przełożonego',criterion.score,{type:'select',options})}${field(`reason-${index}`,'Uzasadnienie / przykład',criterion.justification,{type:'textarea'})}<details><summary>Powiąż obserwacje (${(criterion.evidenceIds ?? []).length})</summary><div class="checks">${eligible.map(evidence => `<label class="check"><input type="checkbox" name="evidence-${index}" value="${esc(evidence.id)}"${criterion.evidenceIds?.includes(evidence.id) ? ' checked' : ''}>${date(evidence.date)} · ${esc(evidence.text)}</label>`).join('') || '<p class="sub">Na osi czasu nie ma jeszcze obserwacji.</p>'}</div></details>` : `<p>${esc(options.find(item => String(item.value) === String(criterion.score))?.label ?? '—')}</p><p>${esc(criterion.justification ?? '')}</p>`}</fieldset>`).join('');
  const outcome = record.outcome ?? {};
  const form = allow ? `<form data-form="review" class="stack"><div class="form-grid">${field('date','Data rozmowy oceniającej',meeting.date || today(),{type:'date',required:true,hint:`Od ${date(record.startDate)} do dnia sporządzenia oceny (${date(record.formDetails?.assessmentDate || today())}).`,extra:`min="${esc(record.startDate)}" max="${today()}"`})}${field('location','Miejscowość',meeting.location || record.startMeeting?.location)}</div>${field('notes','Notatka do rozmowy',meeting.notes,{type:'textarea'})}${cards}${field('summary','Uzasadnienie oceny',outcome.summary,{type:'textarea'})}${field('development','Wnioski do indywidualnego programu rozwoju',outcome.development,{type:'textarea'})}${record.formDetails?.serviceDegreeAttachment === 'yes' ? field('serviceDegree','Uzasadnienie wniosku o kolejny stopień służbowy',outcome.serviceDegree,{type:'textarea',required:true}) : ''}<div>${submit('Zapisz rozmowę i ocenę')}</div></form>` : `<p class="sub">Rozmowa ${date(meeting.date)}</p>${cards}<div><strong>Wnioski rozwojowe</strong><p>${esc(outcome.development || '—')}</p></div>`;
  return `<div class="split"><section class="surface stack"><h2>Rozmowa i ocena</h2>${record.startMeeting?.goals ? `<div class="context"><strong>Cele z rozmowy początkowej</strong><p class="meeting-goals">${esc(record.startMeeting.goals)}</p></div>` : ''}${form}${advance(record,'Przekaż do podpisania')}</section><aside class="stack"><section class="surface stack"><h3>Wynik z ocen cząstkowych</h3><p>${rules.score == null ? 'Wynik pojawi się po zapisaniu wszystkich poziomów.' : `${esc(rules.score)} · ${esc(rules.level ?? rules.outcome ?? '')}`}</p><p class="small sub">Poziomy cząstkowe wybiera przełożony. Średnia jest liczona zgodnie z przyjętą skalą.</p></section><section class="surface action-panel stack"><h3>${icon('spark')} Partner HR</h3><p>Sprawdź obserwacje i przygotuj pytania. Po rozmowie zaplanuj działanie i jego weryfikację.</p><div>${button('Przygotuj rozmowę','panel',{style:'mint',value:'partner'})}</div></section></aside></div>`;
}

function signView(record) {
  const errors = state.user.role === 'manager' && !record.signatures.manager
    ? stagesFor(record).issues.filter(issue => issue.stage === 'review') : [];
  const corrections = errors.length ? callout(`<ul>${errors.map(issue => `<li>${esc(issue.message)} ${issue.field ? button('Popraw pole',issue.field === 'date' ? 'edit-review-date' : 'details',{style:'text',value:issue.field}) : ''}</li>`).join('')}</ul>`,'warning') : '';
  const current = state.user.role;
  const entry = (key,label) => `<div><h3>${label}</h3><p>${esc(signName(record.signatures?.[key]))}</p>${record.stage === 'sign' && key === current && !record.signatures?.[key] ? button(key === 'manager' ? 'Potwierdź podpisanie' : 'Potwierdź zapoznanie','sign',{style:'secondary',value:key}) : ''}</div>`;
  return `<section class="surface stack"><h2>Podpisanie i zapoznanie z oceną</h2>${corrections}${callout('Potwierdzenie w aplikacji zapisuje datę i osobę. Podpis formalny złóż w obiegu dokumentów przyjętym w urzędzie.') }<div class="signatures">${entry('manager','Oceniający')}${entry('employee','Oceniany')}</div><div>${button('Otwórz arkusz do podpisania','print',{style:'secondary',glyph:'printer'})}</div>${advance(record,'Zakończ ocenę')}</section>`;
}

function completedView(record) {
  if (record.stage !== 'complete') return `<section class="surface"><h2>Zakończenie</h2>${empty('Po potwierdzeniu obu stron oceniający będzie mógł zakończyć sprawę.')}</section>`;
  return `<section class="surface stack"><h2>Ocena zakończona</h2><p class="sub">Dokument jest dostępny do wydruku. Działanie rozwojowe można nadal zweryfikować w zakładce partnera HR.</p><div class="row">${button('Otwórz arkusz','print',{glyph:'printer'})}${button('Sprawdź działanie','panel',{style:'secondary',value:'partner'})}</div></section>`;
}

function eventsView(record) {
  const rules = stagesFor(record);
  const window = record.positionWindow ?? rules.positionWindow;
  const types = new Map(CASE_TYPES.map(item => [item.id,item.label]));
  const unlocked = !record.signatures?.manager && record.stage !== 'complete';
  const eventRows = (record.events ?? []).map(event => `<li><strong>${esc(types.get(event.type) ?? event.type)}</strong> · ${date(event.date)}${event.endDate ? `–${date(event.endDate)}` : ''}${event.note ? ` · ${esc(event.note)}` : ''}${event.noticeReference ? ` · Zawiadomienie ${esc(event.noticeReference)} (${date(event.noticeDate)})` : ''}${unlocked ? button('Edytuj zdarzenie','event',{style:'text',value:event.id}) : ''}</li>`).join('');
  return `<section class="surface stack"><div class="row between"><h2>Zdarzenia kadrowe i termin</h2><div class="row">${unlocked ? button('Dodaj zdarzenie','event',{style:'secondary',glyph:'plus'}) : ''}${unlocked && state.user.role === 'hr' ? button('Zmień oceniającego','transfer',{style:'secondary',glyph:'person'}) : ''}</div></div>${window ? `<p><strong>Okno sporządzenia oceny:</strong> ${date(window.from)} – ${date(window.to)}</p>` : ''}${eventRows ? `<ul class="source-list">${eventRows}</ul>` : empty('Brak zarejestrowanych zdarzeń kadrowych.')}${rules.notices.map(notice => callout(`${esc(notice.message)}${notice.source ? ` <small>${esc(notice.source)}</small>` : ''}`,'warning')).join('')}</section>`;
}

function partnerView(record) {
  const manager = state.user.role === 'manager';
  const analysis = analyzeEvidence(record);
  const action = record.action;
  const scored = [...analysis.items].sort((a,b) => b.observations.length-a.observations.length);
  const selected = scored.find(item => item.name === state.partnerCriterion) ?? scored[0];
  const options = scored.map(({name}) => ({value:name,label:name}));
  const observations = [...(selected?.observations ?? [])].sort((a,b) => b.date.localeCompare(a.date));
  const first = observations.find(item => item.tone === 'concern') ?? observations[0];
  const earlier = observations.find(item => item.tone === 'positive' && item.id !== first?.id);
  const answers = record.contexts.filter(reply => observations.some(item => item.id === reply.evidenceId));
  const link = item => button('Otwórz wpis','evidence-source',{style:'text',value:item.id});
  const source = item => `<li><strong>${date(item.date)}</strong> · ${esc(item.text)} ${link(item)}</li>`;
  const old = analysis.historical.filter(item => item.criterion === selected?.name);
  const gap = first && earlier ? 'Co różniło warunki pracy przy tych zdarzeniach?' : 'Jakie okoliczności lub wcześniejsze przykłady pomogą wyjaśnić zapis?';
  const evidence = `<section class="surface stack"><h2>Przygotuj rozmowę</h2>
    ${options.length ? field('partnerCriterion','Kryterium rozmowy',selected?.name,{type:'select',options}) : ''}
    ${selected?.gap ? callout('Brak obserwacji z tego okresu powiązanej z uzasadnieniem.','warning') : ''}
    ${selected?.recentOnly ? callout('Powiązane wpisy pochodzą z końca okresu. Sprawdź wcześniejsze zdarzenia.','warning') : ''}
    <div><h3>Zapisane obserwacje</h3>${first ? `<ul class="source-list">${source(first)}${state.juryDemo && record.id === 'demo-ocena' ? observations.filter(item => item.id !== first.id && item.tone === 'concern').map(source).join('') : ''}${earlier ? source(earlier) : ''}</ul>` : empty('Brak obserwacji w ocenianym okresie.')}</div>
    <div><h3>Głos pracownika</h3>${answers.length ? `<ul class="source-list">${answers.map(reply => `<li>${esc(reply.text)} ${link(observations.find(item => item.id === reply.evidenceId))}</li>`).join('')}</ul>` : empty('Pracownik nie dopisał jeszcze odpowiedzi do tych wpisów.')}</div>
    ${first && earlier ? callout('Wpisy opisują różne wyniki. Zmiana warunków pracy to hipoteza do sprawdzenia.','warning') : ''}
    <div class="context"><strong>Brakująca informacja</strong><p>${first && earlier ? 'Zakres i priorytet spraw w obu sytuacjach.' : 'Warunki pracy i przykłady opisane przez obie strony.'}</p><strong>Pytanie do rozmowy</strong><p>${esc(gap)}</p></div>
    ${old.length ? `<details><summary>Kontekst spoza okresu (${old.length})</summary><ul class="source-list">${old.map(source).join('')}</ul></details>` : ''}
    ${state.user.role !== 'hr' ? `<div>${meetingLink(record.id)}</div>` : ''}</section>`;
  const days = record.ruleSnapshot?.trialDays ?? RULESET.trialDays;
  const showForm = manager && ((!action && ['review','sign','complete'].includes(record.stage)) || state.repeatTrial);
  const jury = manager && state.juryDemo && record.id === 'demo-ocena';
  const plan = showForm ? trialForm({selected:state.selectedOption,start:state.repeatTrial && action.reviewDate > today() ? action.reviewDate : today(),previous:state.repeatTrial ? action : null,days}) : action ? actionView(record,action,manager) : `<section class="surface stack"><h2>Działanie na 30 dni</h2><p class="sub">Sprawdźcie, czy zmiana w pracy zespołu pomaga przed podjęciem decyzji o jej utrzymaniu.</p>${manager && record.stage === 'observations' ? `<div>${button('Otwórz rozmowę oceniającą','partner-advance',{glyph:'message'})}</div>` : empty('Kierownik nie ustalił jeszcze działania.')}</section>`;
  return `<div class="split equal">${evidence}<div class="stack">${jury ? juryTrialView(record.juryTrial) : ''}${plan}${trialHistory(record.actionHistory ?? [])}</div></div>`;
}

function juryTrialView(trial) {
  let body;
  if (!trial) {
    body = `<p>Wypróbuj cotygodniowe uzgadnianie priorytetów po rozmowie z Anną.</p>${button('Rozpocznij fikcyjną próbę','jury-trial',{value:'start'})}`;
  } else if (trial.status === 'active') {
    body = `<p>${esc(trial.label)} · od ${date(trial.startDate)}</p>${trialComparison(trial)}${button('Przejdź o 30 dni do wyniku','jury-trial',{value:'result'})}`;
  } else {
    body = `<p><strong>Po 30 dniach · ${date(trial.reviewDate)}</strong></p>${trialComparison(trial)}
      ${trial.nextTrial ? `<div class="context"><strong>Decyzja · zmienić działanie i sprawdzić ponownie</strong><p>${esc(trial.nextTrial.label)}</p><p>Pomiar bazowy 4 z 8 · następny przegląd ${date(trial.nextTrial.reviewDate)}</p></div>` : button('Zmień działanie i zaplanuj kolejną próbę','jury-trial',{value:'repeat'})}`;
  }
  return `<section class="surface stack trial-demo"><div class="row between"><h2>Próba w sprawie Anny</h2>${pill('Symulacja · dane fikcyjne','warning')}</div><div class="stack">${body}</div></section>`;
}

function actionView(record, action, manager) {
  const closed = action.status === 'complete' || action.status === 'completed' || action.followUp != null;
  const status = closed ? 'Zweryfikowane' : 'W toku';
  const employee = state.user.role === 'employee';
  const assessmentClosed = record.stage === 'complete' || Boolean(record.signatures?.manager);
  const editable = manager && !closed && today() >= action.reviewDate;
  const development = manager && record.stage === 'review' && action.development?.trim() ? button('Dodaj do wniosków rozwojowych','use-development',{style:'secondary',glyph:'plus'}) : '';
  return `<section class="surface stack"><div class="row between"><h2>Działanie na 30 dni</h2>${pill(status)}</div><div><h3>${esc(action.label)}</h3><p class="sub">${esc(action.description ?? '')}</p></div><dl class="definition"><dt>Odpowiada</dt><dd>${esc(action.owner)}</dd><dt>Miernik</dt><dd>${esc(action.metric)}</dd><dt>Weryfikacja</dt><dd>${date(action.reviewDate)}</dd>${closed ? `<dt>Wniosek</dt><dd>${esc(action.note || '—')}</dd><dt>Decyzja</dt><dd>${esc(action.decision || '—')}</dd>` : ''}</dl>${metricDefinitionView(action.metricDefinition)}${trialComparison(action)}${action.employeeComment ? `<div class="context"><strong>Opinia pracownika</strong><p>${esc(action.employeeComment)}</p></div>` : ''}${employee && assessmentClosed ? `<form data-form="action-comment" class="stack">${field('comment','Jak działa uzgodniona zmiana?',action.employeeComment,{type:'textarea',required:true})}<div>${submit('Zapisz opinię')}</div></form>` : ''}${editable ? trialFollowup(action) : manager && !closed ? `<p class="small sub">Wynik można zapisać od ${date(action.reviewDate)}.</p>` : ''}<div class="row">${development}${manager && closed ? button('Zmień i sprawdź ponownie','repeat-trial',{style:'secondary',glyph:'plus'}) : ''}</div></section>`;
}

function openingHistory(record) {
  const snapshots = [...(record.openingHistory ?? []),...(record.openingSnapshot ? [record.openingSnapshot] : [])];
  const missing = record.openingHistoryIncomplete || (record.startMeeting?.signedEmployee && !record.openingSnapshot);
  return `<section class="surface stack"><h2>Potwierdzone wersje części I</h2>
    ${missing ? callout('Brak zachowanej wersji części I dla tego historycznego potwierdzenia.','warning') : ''}
    ${snapshots.map((snapshot,index) => `<details><summary>Wersja ${index+1} · potwierdzona ${date(snapshot.startMeeting.signedEmployee?.date)}</summary>
      <p>Termin z części I · ${date(snapshot.dueDate)}</p><p>${esc(snapshot.position)} · ${esc(snapshot.managerName)}</p>
      <ul class="source-list">${snapshot.criteria.map(item=>`<li>${esc(item.name)}</li>`).join('')}</ul>
      ${button('Pobierz zapis części I','opening-download',{style:'secondary',value:index})}</details>`).join('') || (missing ? '' : empty('Wersja zapisze się po potwierdzeniu przez pracownika.'))}
    </section>`;
}

function historyDetails(entry) {
  const data = entry.details;
  if (!data) return '';
  if (entry.type === 'due-date-changed') return `<p>Termin ${date(data.previous)} → ${date(data.current)}</p>`;
  if (entry.type === 'delivery-corrected') return `<p>Doręczenie ${date(data.previous?.deliveredOn)} → ${date(data.current.deliveredOn)}</p><p>Zapoznanie ${date(data.previous?.acknowledgedOn)} → ${date(data.current.acknowledgedOn)}</p><p>Powód · ${esc(data.reason)}</p>`;
  return '';
}

function documentsView(record) {
  const delivery = record.delivery;
  const mayRecordDelivery = ['manager','hr'].includes(state.user.role) && record.signedFile;
  const notices = record.events.filter(item => item.noticeReference).map(item =>
    `<li>${date(item.noticeDate)} · ${esc(item.noticeReference)}${item.newDueDate ? ` · nowy termin ${date(item.newDueDate)}` : ''}</li>`).join('');
  const circulation = `<section class="surface stack"><h2>Obieg oceny</h2><dl class="definition">
    <dt>Potwierdzenie przełożonego w aplikacji</dt><dd>${esc(signName(record.signatures?.manager))}</dd>
    <dt>Potwierdzenie pracownika w aplikacji</dt><dd>${esc(signName(record.signatures?.employee))}</dd>
    <dt>Dołączenie podpisanego dokumentu</dt><dd>${record.signedFile ? 'Zapisano' : 'Oczekuje'}</dd>
    <dt>Przekazanie do akt</dt><dd>${record.handoffs?.length ? 'Zapisano' : 'Oczekuje'}</dd>
    <dt>Doręczenie kopii pracownikowi</dt><dd>${delivery ? date(delivery.deliveredOn) : 'Oczekuje'}</dd>
    <dt>Termin wniesienia sprzeciwu</dt><dd>${record.appealDeadline ? date(record.appealDeadline) : 'Po odnotowaniu zapoznania się z oceną'}</dd>
  </dl>${notices ? `<div><h3>Zawiadomienia o zmianie terminu</h3><ul class="source-list">${notices}</ul></div>` : ''}
  ${mayRecordDelivery ? `<div>${button(delivery ? 'Zmień dane doręczenia' : 'Zapisz doręczenie kopii','delivery',{style:'secondary'})}</div>` : ''}</section>`;
  const formType = record.formType ?? record.positionType;
  const history = (record.history ?? []).slice().reverse();
  const signed = record.signedFile;
  const mayHandoff = ['manager','hr'].includes(state.user.role);
  const link = (format,label,glyph = 'file') => `<a class="btn secondary" href="/api/cases/${encodeURIComponent(record.id)}/${format}" download>${icon(glyph)}${label}</a>`;
  const file = signed ? `<div class="context stack tight"><strong>PDF dołączony do zakończonej sprawy</strong><p>${esc(signed.name)} · ${date(signed.uploadedAt)}</p><div>${link('signed-file','Pobierz dołączony PDF')}</div></div>` : record.stage === 'complete' && mayHandoff ? `<div>${button('Dołącz podpisany PDF','attach-file',{style:'secondary',glyph:'plus'})}</div>` : '';
  const receipts = (record.handoffs ?? []).map(entry => `<li><strong>${entry.channel === 'ezd' ? 'EZD' : 'Poczta'}</strong> · ${esc(entry.reference)} · ${date(entry.at)}</li>`).join('');
  const archive = mayHandoff && signed ? `<section class="surface stack"><div><h2>Przekazanie do akt</h2><p class="sub">Pobierz paczkę do ręcznego przekazania w EZD lub szkic wiadomości z załącznikiem. Po przekazaniu zapisz sygnaturę lub identyfikator potwierdzenia.</p></div><div class="row">${link('handoff.zip','Paczka do akt ZIP')}${link('handoff.eml','Szkic wiadomości EML','message')}${button('Zapisz przekazanie','handoff',{style:'secondary',glyph:'check'})}</div>${receipts ? `<ul class="source-list">${receipts}</ul>` : empty('Brak zapisanych potwierdzeń przekazania.')}</section>` : '';
  return `<div class="split"><div class="stack"><section class="surface stack"><h2>Dokumenty sprawy</h2><p class="sub">Arkusz ${esc(formType)} i część dotycząca rozwoju zawodowego.</p><div class="row">${button('Podgląd i druk','print',{glyph:'printer'})}${state.user.role === 'manager' || record.signatures?.manager ? link('official-docx','Wzór urzędowy DOCX') : ''}${mayHandoff ? button('Pobierz dane arkusza JSON','exchange',{style:'secondary',glyph:'file'}) : ''}</div>${file}${canEdit() ? `<div>${button('Uzupełnij pola arkusza','details',{style:'secondary'})}</div>` : ''}<p class="small"><a href="https://www.gov.pl/web/sluzbacywilna/ocena-okresowa" target="_blank" rel="noreferrer">Urzędowe wzory i wskazówki</a></p></section>${circulation}${archive}${openingHistory(record)}</div><section class="surface stack"><h2>Historia sprawy</h2>${history.length ? `<ol class="timeline">${history.map(entry => `<li class="event-card"><span class="date">${date(entry.at ?? entry.date)}</span><strong>${esc(entry.label ?? entry.summary ?? entry.action ?? entry.type ?? 'Zapis sprawy')}</strong><span class="small sub">${esc(entry.name ?? entry.actorName ?? '')}</span>${historyDetails(entry)}</li>`).join('')}</ol>` : empty('Historia pojawi się po zapisaniu zmian.')}</section></div>`;
}

function render() {
  if (!state.user) app.innerHTML = loginView();
  else if (state.print && state.record) app.innerHTML = printView(state.record,stagesFor(state.record));
  else if (state.screen === 'record' && state.record) app.innerHTML = caseView(state.record);
  else if (state.screen === 'stats') app.innerHTML = statisticsView();
  else if (state.screen === 'queue') app.innerHTML = queueView();
  else if (state.screen === 'supervisors') app.innerHTML = supervisorsView();
  else if (state.screen === 'config') app.innerHTML = configView();
  else app.innerHTML = homeView();
}

async function login(username,password,{resume = false} = {}) {
  const oldRecord = state.record?.id;
  const oldPanel = state.panel;
  const oldStep = state.step;
  if (state.user) {
    await api('/logout','POST');
    state.user = null;
  }
  state.user = (await api('/login','POST',{username,password})).user;
  state.config = (await api('/config')).config;
  if (dialog.open) dialog.close();
  if (oldRecord && resume && state.user.role !== 'director') {
    try { await openRecord(oldRecord,{panel:oldPanel,step:oldStep}); return; }
    catch (error) { if (![403,404].includes(error.status)) throw error; }
  }
  await loadHome();
}

function download(name,payload,type = 'application/json') {
  const content = type === 'application/json' ? JSON.stringify(payload,null,2) : payload;
  const url = URL.createObjectURL(new Blob([content],{type}));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url),1000);
}

const clicks = {
  'demo-meeting': async () => {
    const account = state.demoAccounts.find(person => person.role === 'manager');
    if (!account) return;
    await login(account.username,account.password);
    await openRecord('demo-ocena',{panel:'partner'});
  },
  'demo-login': async username => { const account = state.demoAccounts.find(item => item.username === username); await login(account.username,account.password,{resume:true}); },
  roles: () => modal('Konta demonstracyjne',`<div class="stack">${demoAccountGroups(true)}</div>`),
  'insights-demo': () => { state.showDemoInsights = !state.showDemoInsights; render(); document.querySelector('[data-act="insights-demo"]')?.focus(); },
  logout: async () => { await api('/logout','POST'); Object.assign(state,{...initial, demoAccounts:state.demoAccounts}); render(); },
  close: () => dialog.close(),
  navigate: async screen => { if (screen === 'supervisors') { state.people = await api('/people'); state.screen = screen; render(); return; } if (screen === 'config') { state.config = (await api('/config')).config; state.screen = screen; render(); } else await loadHome(screen); },
  record: id => openRecord(id),
  'evidence-source': id => { state.panel = 'evidence'; render(); document.getElementById('observation-'+id)?.focus(); },
  'jury-trial': async step => {
    const {record} = await api('/cases/demo-ocena/jury-trial','POST',{version:state.record.version,step});
    state.record = record;
    render();
    const next = document.querySelector('[data-act=jury-trial]');
    if (next) next.focus();
    else announce('Zapisano fikcyjną decyzję o kolejnej próbie.');
  },
  'queue-task': value => {
    const [id,panel,step] = value.split('/');
    return openRecord(id,{panel:panel || undefined,step:step || undefined});
  },
  'queue-calendar': id => {
    const queue = buildWorkQueue(state.cases,state.user.role,today());
    const task = [...queue.tasks,...queue.waiting].find(item => item.id === id && item.dueDate);
    if (!task) throw new Error('Termin zadania nie jest już dostępny.');
    download('termin-zadania.ics',taskReminderCalendar(task),'text/calendar;charset=utf-8');
    announce('Pobrano przypomnienie do importu w kalendarzu.');
  },
  new: async () => {
    const {people} = await api('/people');
    const employees = people.filter(person => person.role === 'employee');
    modal('Nowa ocena okresowa', `<form class="stack" data-form="new">${field('employeeId','Pracownik','',{type:'select',required:true,options:[{value:'',label:'Wybierz pracownika'},...employees.map(person => ({value:person.id,label:person.name}))]})}${field('position','Stanowisko','',{required:true})}${field('positionType','Rodzaj stanowiska','C',{type:'select',options:Object.entries(FORM_META).map(([value,item]) => ({value,label:`${value} · ${item.position}`}))})}${field('startDate','Data rozpoczęcia',today(),{type:'date',required:true})}<div>${submit('Utwórz ocenę')}</div></form>`);
  },
  'edit-setup': () => {
    const record = state.record;
    modal('Dane i arkusz oceny',`<form class="stack" data-form="edit-setup">${field('position','Stanowisko',record.position,{required:true})}${field('positionType','Rodzaj stanowiska',record.positionType,{type:'select',options:Object.entries(FORM_META).map(([value,item]) => ({value,label:`${value} · ${item.position}`}))})}${field('startDate','Data rozpoczęcia',record.startDate,{type:'date',required:true})}<div>${submit('Zapisz dane')}</div></form>`);
  },
  step: step => { state.step = step; render(); },
  panel: panel => { state.panel = panel; render(); document.querySelector(`[data-act="panel"][data-value="${panel}"]`)?.focus(); },
  advance: async () => {
    const record = state.record;
    const issues = currentIssues(record);
    if (issues.length) { announce(issues[0].message,true); return; }
    const next = STAGES[stageIndex(record.stage)+1]?.id;
    if (next) await update({stage:next},'Zapisano kolejny etap.',{step:next});
  },
  'partner-advance': () => update({stage:'review'},'Otworzono rozmowę oceniającą.',{step:'review',panel:'partner'}),
  'use-development': () => {
    const outcome = state.record.outcome;
    const draft = state.record.action.development;
    const development = outcome.development.includes(draft) ? outcome.development : [outcome.development,draft].filter(Boolean).join('\n');
    return update({outcome:{...outcome,development}},'Dodano propozycję do wniosków rozwojowych.',{step:'review',panel:'process'});
  },
  'meeting-sign': key => update({startMeeting:{[key]:true}},'Zapisano potwierdzenie rozmowy.'),
  sign: key => update({signatures:{[key]:true}},'Zapisano potwierdzenie.'),
  'evidence-edit': id => {
    const entry = state.record.evidence.find(item => item.id === id) ?? {};
    modal(id ? 'Edytuj obserwację' : 'Dodaj obserwację', `<form class="stack" data-form="evidence"><input type="hidden" name="id" value="${esc(id)}">${field('date','Data zdarzenia',entry.date || today(),{type:'date',required:true})}${field('criterion','Kryterium',entry.criterion ?? '',{type:'select',options:[{value:'',label:'Bez przypisania'},...state.record.criteria.map(item => ({value:item.name,label:item.name}))]})}${field('tone','Rodzaj przykładu',entry.tone ?? 'neutral',{type:'select',options:[{value:'neutral',label:'Neutralny'},{value:'positive',label:'Mocna strona'},{value:'concern',label:'Do omówienia'}]})}${field('text','Co się wydarzyło i jaki był skutek?',entry.text,{type:'textarea',required:true})}<label class="check"><input type="checkbox" name="shared"${entry.shared ? ' checked' : ''}>Udostępnij pracownikowi</label><div>${submit('Zapisz obserwację')}</div></form>`);
  },
  context: id => modal('Kontekst do obserwacji', `<form class="stack" data-form="context"><input type="hidden" name="evidenceId" value="${esc(id)}">${field('text','Co kierownik powinien wiedzieć przed rozmową?', '',{type:'textarea',required:true})}<div>${submit('Udostępnij kontekst')}</div></form>`),
  event: id => {
    const event = state.record.events.find(item => item.id === id) ?? {};
    modal('Zdarzenie kadrowe', `<form class="stack" data-form="event">
      <input type="hidden" name="id" value="${esc(event.id)}">
      ${field('type','Rodzaj zdarzenia',event.type,{type:'select',required:true,options:[{value:'',label:'Wybierz typ'},...CASE_TYPES.map(item => ({value:item.id,label:item.label}))]})}
      <div class="form-grid">${field('date','Data od',event.date || today(),{type:'date',required:true})}${field('endDate','Data do (jeśli dotyczy)',event.endDate,{type:'date'})}</div>
      ${field('newDueDate','Indywidualnie ustalony termin',event.newDueDate,{type:'date',hint:'Dla wniosku, zmiany oceniającego lub przewidywanej nieobecności.'})}
      ${field('note','Uzasadnienie lub opis',event.note,{type:'textarea'})}
      <fieldset class="trial-fields stack tight"><legend>Zawiadomienie w obiegu urzędu</legend>
        ${field('noticeReference','Sygnatura zawiadomienia',event.noticeReference,{extra:'maxlength="160"',hint:'Identyfikator kopii zawiadomienia o nowym terminie.'})}
        ${field('noticeDate','Data zawiadomienia',event.noticeDate,{type:'date'})}
      </fieldset><div>${submit('Zapisz zdarzenie')}</div></form>`);
  },
  transfer: async () => {
    const {people,managers} = await api('/people');
    const assigned = people.find(person => person.id === state.record.employeeId)?.directManagerId;
    const options = managers.filter(person => person.id === assigned && person.id !== state.record.managerId).map(person => ({value:person.id,label:person.name}));
    modal('Zmiana osoby oceniającej', options.length ? `<form class="stack" data-form="transfer">${field('managerId','Nowa osoba oceniająca','',{type:'select',required:true,options:[{value:'',label:'Wybierz przełożonego'},...options]})}${field('managerChangeDate','Data przejęcia sprawy',today(),{type:'date',required:true})}<div>${submit('Przekaż ocenę')}</div></form>` : empty('Najpierw zatwierdź bezpośredniego przełożonego w widoku Podległość.'));
  },
  'edit-review-date': () => { state.step = 'review'; render(); document.querySelector('[data-form="review"] [name="date"]')?.focus(); },
  'opening-download': value => {
    const record = state.record;
    const snapshots = [...(record.openingHistory ?? []),...(record.openingSnapshot ? [record.openingSnapshot] : [])];
    if (snapshots[value]) download('czesc-I-'+(Number(value)+1)+'.json',snapshots[value]);
  },
  'review-date': () => document.querySelector('[data-form="review"] [name="date"]')?.focus(),
  details: key => {
    const details = state.record.formDetails ?? {};
    modal('Pola uzupełniające arkusza', `<form class="stack" data-form="details">${detailsFields(state.record).map(item => field(item.key,item.label,details[item.key],{type:item.type ?? 'text',options:item.options ?? []})).join('')}<div>${submit('Zapisz pola')}</div></form>`);
    if (key) dialog.querySelector('form').elements.namedItem(key)?.focus();
  },
  print: () => { state.print = true; render(); window.scrollTo(0,0); },
  'print-now': () => window.print(),
  'print-close': () => { state.print = false; render(); },
  calendar: id => {
    const record = state.cases.find(item => item.id === id) ?? state.record;
    download('termin-oceny.ics',reminderCalendar(record),'text/calendar;charset=utf-8');
    announce('Pobrano przypomnienie do importu w kalendarzu.');
  },
  'attach-file': () => modal('Dołącz podpisany PDF',`<p class="sub">Załącz plik podpisany w obiegu urzędu. System zachowa plik i historię dołączenia. Podpis sprawdź w narzędziu używanym przez urząd.</p><form class="stack" data-form="signed-file">${field('pdf','Dokument PDF','',{type:'file',required:true,extra:'accept="application/pdf,.pdf"'})}<div>${submit('Dołącz dokument')}</div></form>`),
  delivery: () => modal('Doręczenie kopii pracownikowi', `<form class="stack" data-form="delivery">
    ${field('deliveredOn','Data doręczenia kopii',state.record.delivery?.deliveredOn || today(),{type:'date',required:true})}
    ${field('acknowledgedOn','Data zapoznania się z oceną',state.record.delivery?.acknowledgedOn,{type:'date',hint:'Wprowadź odnotowaną datę zapoznania się z oceną.'})}
    ${state.record.delivery ? field('reason','Powód korekty','',{type:'textarea',required:true,extra:'maxlength="500"'}) : ''}
    <div>${submit('Zapisz doręczenie')}</div></form>`),
  handoff: () => modal('Zapisz przekazanie do akt',`<p class="sub">Dodaj potwierdzenie po przekazaniu dokumentu w swoim systemie.</p><form class="stack" data-form="handoff">${field('channel','Sposób przekazania','ezd',{type:'select',options:[{value:'ezd',label:'EZD'},{value:'mail',label:'Poczta służbowa'}]})}${field('reference','Sygnatura lub identyfikator potwierdzenia','',{required:true,extra:'maxlength="160"'})}<div>${submit('Zapisz potwierdzenie')}</div></form>`),
  exchange: () => {
    const {id,employeeName,managerName,office,position,stage:status,dueDate,criteria,outcome,signatures,formType,formDetails,startMeeting,reviewMeeting} = state.record;
    download(`ocena-${id}.json`,{format:'ocena-okresowa/1.0',id,employeeName,managerName,office,position,status,dueDate,criteria:criteria.map(({name,required,score,justification}) => ({name,required,score,justification})),outcome,signatures,formType,formDetails,startMeeting,reviewMeeting});
    announce('Pobrano dane arkusza. Przekaż je w przyjętym obiegu urzędu.');
  },
  'repeat-trial': () => { state.selectedOption = state.record.action.optionId; state.repeatTrial = true; render(); document.querySelector('input[name="option"]:checked')?.focus(); },
  'repeat-cancel': () => { state.repeatTrial = false; render(); document.querySelector('[data-act="repeat-trial"]')?.focus(); },

};

function supervisorsView() {
  const {people,managers} = state.people;
  const options = managers.map(person => ({value:person.id,label:person.name}));
  return shell(`<h1>Bezpośrednia podległość</h1><section class="surface stack">
    ${people.map(person => `<form data-form="supervisor" class="row between">
      <input type="hidden" name="employeeId" value="${esc(person.id)}">
      ${field('manager-'+person.id,person.name,person.directManagerId,{type:'select',required:true,options:[{value:'',label:'Wybierz przełożonego'},...options]})}
      ${submit('Zatwierdź podległość')}
    </form>`).join('') || empty('Brak kont pracowników.')}
  </section>`,'Podległość');
}

function detailsFields(record) {
  const defs = formsFor(record)[record.formType ?? record.positionType]?.fields ?? [];
  const selects = {
    serviceDegreeAttachment:[['not-applicable','Nie dotyczy'],['yes','Tak'],['no','Nie']],
    previousAssessmentResult:[['','Nie wprowadzono'],['pozytywna','Pozytywna'],['negatywna','Negatywna']],
  };
  return defs.map(({key,label}) => ({key,label,type:selects[key] ? 'select' : /Date$/.test(key) || key === 'periodEnd' ? 'date' : 'text',options:selects[key]?.map(([value,label]) => ({value,label}))}));
}

const forms = {
  supervisor: async data => {
    const employeeId = data.get('employeeId');
    await api('/people/supervisor','PATCH',{employeeId,managerId:data.get('manager-'+employeeId)});
    state.people = await api('/people');
    render();
    announce('Zatwierdzono bezpośrednią podległość.');
  },
  login: data => login(data.get('username'),data.get('password')),
  new: async data => { const {record} = await api('/cases','POST',Object.fromEntries(data)); dialog.close(); await openRecord(record.id); announce('Utworzono ocenę.'); },
  'edit-setup': data => update(Object.fromEntries(data),'Zapisano dane i arkusz.'),
  criteria: data => {
    const additions = data.getAll('optional');
    const maximum = state.record.ruleSnapshot?.maxAdditional ?? state.config.maxAdditional;
    if (additions.length > maximum) throw new Error(`Wybierz maksymalnie ${maximum} dodatkowe kryteria.`);
    const existing = state.record.criteria;
    const mandatory = formsFor(state.record)[selectedForm(state.record.positionType)].requiredCriteria;
    const next = [...mandatory,...additions].map(name => existing.find(item => item.name === name) ?? {name,required:mandatory.includes(name),score:null,justification:'',evidenceIds:[]});
    return update({criteria:next},'Zapisano kryteria.');
  },
  start: data => update({startMeeting:Object.fromEntries(data)},'Zapisano ustalenia rozmowy.'),
  evidence: data => {
    const old = state.record.evidence.find(item => item.id === data.get('id'));
    const evidence = {...old,id:old?.id ?? crypto.randomUUID(),date:data.get('date'),criterion:data.get('criterion'),tone:data.get('tone'),text:data.get('text').trim(),shared:data.has('shared'),authorId:old?.authorId ?? state.user.id};
    if (!evidence.text) throw new Error('Wpisz treść obserwacji.');
    const entries = old ? state.record.evidence.map(item => item.id === old.id ? evidence : item) : [...state.record.evidence,evidence];
    return update({evidence:entries},'Zapisano obserwację.');
  },
  context: data => update({contexts:[...state.record.contexts,{evidenceId:data.get('evidenceId'),text:data.get('text').trim()}]},'Kontekst zapisany do rozmowy.'),
  event: data => {
    const event = Object.fromEntries(data);
    if (event.type === 'absence' && !event.endDate) throw new Error('Dla nieobecności podaj ostatni dzień.');
    if (event.endDate && event.endDate < event.date) throw new Error('Data zakończenia jest wcześniejsza niż początek.');
    if (event.newDueDate && !['earlier-request','manager-change','expected-absence'].includes(event.type)) throw new Error('Ten rodzaj zdarzenia nie przyjmuje ręcznie ustalonego terminu.');
    const previous = state.record.events.find(item => item.id === event.id);
    const events = previous ? state.record.events.map(item => item.id === event.id ? {...item,...event} : item) : [...state.record.events,{...event,id:crypto.randomUUID()}];
    return update({events},'Zapisano zdarzenie i sprawdzono termin.');
  },
  review: data => {
    const criteria = state.record.criteria.map((item,index) => ({...item,score:data.get(`score-${index}`) ? Number(data.get(`score-${index}`)) : null,justification:data.get(`reason-${index}`).trim(),evidenceIds:data.getAll(`evidence-${index}`)}));
    const reviewMeeting = Object.fromEntries(['date','location','notes'].map(key => [key,data.get(key)]));
    const outcome = {...state.record.outcome,summary:data.get('summary').trim(),development:data.get('development').trim()};
    if (data.has('serviceDegree')) outcome.serviceDegree = data.get('serviceDegree').trim();
    return update({criteria,reviewMeeting,outcome},'Zapisano rozmowę i ocenę.');
  },
  action: data => {
    const optionId = data.get('option');
    const startDate = data.get('date');
    const action = {optionId,startDate,baseline:Number(data.get('baseline')),baselineTotal:Number(data.get('baselineTotal')),baselineFrom:data.get('baselineFrom'),baselineTo:data.get('baselineTo')};
    action.targetRate = data.get('targetRate') === '' ? null : Number(data.get('targetRate'));
    if (data.get('obstacle')) action.obstacle = data.get('obstacle');
    if (optionId === 'custom') for (const name of ['label','description','owner','metric','development']) {
      if (data.has(name)) action[name] = data.get(name).trim();
    }
    if (data.has('metricEvent')) action.metricDefinition = {event:data.get('metricEvent'),population:data.get('metricPopulation'),source:data.get('metricSource')};
    if (data.get('repeat')) action.repeat = true;
    if (action.baseline > action.baselineTotal) throw new Error('Liczba zdarzeń nie może przekraczać liczby wszystkich spraw.');
    return update({action},action.repeat ? 'Rozpoczęto kolejną próbę.' : 'Zapisano działanie i termin weryfikacji.',{repeatTrial:false});
  },
  followup: data => {
    const action = state.record.action;
    if (today() < action.reviewDate) throw new Error('Wynik zapisz po upływie terminu weryfikacji.');
    const draft = {optionId:action.optionId,followUp:Number(data.get('value')),note:data.get('note').trim(),decision:data.get('decision'),status:'completed'};
    if (data.get('total') !== '') draft.followUpTotal = Number(data.get('total'));
    if (draft.followUp > draft.followUpTotal) throw new Error('Liczba zdarzeń nie może przekraczać liczby wszystkich spraw.');
    return update({action:draft},'Zapisano wynik i wspólne ustalenia.');
  },
  'action-comment': data => update({action:{employeeComment:data.get('comment').trim()}},'Zapisano opinię.'),
  transfer: data => update(Object.fromEntries(data),'Przekazano sprawę nowemu oceniającemu.'),
  'signed-file': async data => {
    const file = data.get('pdf');
    if (!file?.size || file.size > 4 * 1024 * 1024) throw new Error('Wybierz dokument PDF do 4 MiB.');
    const content = await new Promise((resolve,reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',',2)[1]);
      reader.onerror = () => reject(new Error('Nie można odczytać dokumentu.'));
      reader.readAsDataURL(file);
    });
    const {record} = await api(`/cases/${encodeURIComponent(state.record.id)}/signed-file`,'POST',{name:file.name,content,version:state.record.version});
    state.record = record;
    dialog.close();
    render();
    announce('Dołączono dokument do oceny.');
  },
  handoff: async data => {
    const id = state.record.id;
    const {record} = await api(`/cases/${encodeURIComponent(id)}/handoffs`,'POST',{...Object.fromEntries(data),version:state.record.version});
    state.record = record;
    dialog.close();
    render();
    announce('Zapisano potwierdzenie przekazania.');
  },
  delivery: async data => {
    const {record} = await api(`/cases/${encodeURIComponent(state.record.id)}/delivery`,'POST',{...Object.fromEntries(data),version:state.record.version});
    state.record = record;
    dialog.close();
    render();
    announce('Zapisano doręczenie kopii.');
  },
  details: data => update({formDetails:Object.fromEntries(data)},'Zapisano pola arkusza.'),
  config: async data => { state.config = (await api('/config','PATCH',{config:{months:Number(data.get('months')),maxAdditional:Number(data.get('maxAdditional'))}})).config; render(); announce('Zapisano nową wersję reguł.'); },
};

async function run(operation,target) {
  if (busy) return;
  busy = true;
  if (target) target.setAttribute('aria-busy','true');
  try { await operation(); }
  catch (error) {
    const issue = Array.isArray(error.details) && error.details.find(item => item.field);
    const input = issue && target?.form?.elements.namedItem(issue.field);
    if (input?.setCustomValidity) {
      input.setCustomValidity(issue.message);
      input.reportValidity();
      input.addEventListener('input',() => input.setCustomValidity(''),{once:true});
    }
    announce(error.message,true);
  }
  finally { busy = false; if (target) target.removeAttribute('aria-busy'); }
}

document.addEventListener('click',event => {
  const target = event.target.closest('[data-act]');
  if (target && clicks[target.dataset.act]) void run(() => clicks[target.dataset.act](target.dataset.value),target);
});
document.addEventListener('submit',event => {
  const form = event.target;
  const handler = forms[form.dataset.form];
  if (!handler) return;
  event.preventDefault();
  void run(() => handler(readForm(form)),event.submitter);
});
document.addEventListener('change',event => {
  const target = event.target;
  if (target.name === 'partnerCriterion') { state.partnerCriterion = target.value; render(); document.querySelector('[name=partnerCriterion]')?.focus(); }
  if (target.name === 'option' && target.form?.dataset.form === 'action') {
    state.selectedOption = target.value;
    document.querySelector('#option-summary').innerHTML = optionSummary(state.selectedOption,state.repeatTrial ? state.record.action : null);
    const customFields = document.querySelector('#custom-trial-fields');
    customFields.hidden = customFields.disabled = state.selectedOption !== 'custom';
    const method = buildAction(state.selectedOption,{})?.metricDefinition;
    for (const [field,key] of [['metricEvent','event'],['metricPopulation','population'],['metricSource','source']]) {
      if (target.form.elements[field]) target.form.elements[field].value = method?.[key] ?? '';
    }
  }
  if (target.name === 'date' && target.form?.dataset.form === 'action' && target.value) {
    target.form.elements.baselineFrom.value = addDays(target.value,-Number(target.dataset.trialDays));
    target.form.elements.baselineTo.value = addDays(target.value,-1);
    const carried = document.querySelector('#baseline-carried');
    if (carried && !carried.hidden) {
      target.form.elements.baseline.value = '';
      target.form.elements.baselineTotal.value = '';
      carried.hidden = true;
    }
  }
});

document.addEventListener('input',event => {
  const target = event.target;
  if (target.form?.dataset.form !== 'followup' || !['value','total'].includes(target.name)) return;
  const form = target.form;
  const value = form.elements.value.value;
  const total = form.elements.total.value;
  const output = form.querySelector('#live-trial-comparison');
  output.hidden = !value || !total || Number(total) <= 0 || Number(value) > Number(total);
  if (!output.hidden) output.innerHTML = trialComparison({...state.record.action,followUp:Number(value),followUpTotal:Number(total)});
});

try {
  const data = await api('/session');
  Object.assign(state,data);
  const caseId = new URLSearchParams(location.search).get('sprawa');
  if (state.user && caseId) {
    try { await openRecord(caseId,{panel:'partner'}); }
    catch (error) {
      if (![403,404].includes(error.status)) throw error;
      await loadHome();
    }
  } else if (state.user) await loadHome();
  else render();
} catch (error) {
  app.innerHTML = `<main class="boot" id="main"><h1>Druga Strona Oceny</h1><p>Nie można połączyć się z aplikacją.</p><p class="small sub">${esc(error.message)}</p></main>`;
}

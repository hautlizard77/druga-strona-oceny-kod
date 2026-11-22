import { ACTION_OPTIONS, buildAction, RULESET, addDays } from './domain.mjs';
import { compareTrial, MIN_TRIAL_SAMPLE, OBSTACLES } from './trials.mjs';
import { button, callout, date, esc, field, pill, submit } from './ui.mjs';

const percent = new Intl.NumberFormat('pl-PL',{maximumFractionDigits:1});
const range = (from,to) => from && to ? `${date(from)} – ${date(to)}` : '';
const countAttrs = 'min="0" max="1000000" step="1"';
const totalAttrs = 'min="1" max="1000000" step="1"';
const custom = {id:'custom',label:'Własne działanie',description:'Ustal zmianę pasującą do sposobu pracy zespołu.'};

export function optionSummary(optionId, previous) {
  const option = ACTION_OPTIONS.find(item => item.id === optionId);
  if (previous) return `<dl class="definition"><dt>Wspólny miernik</dt><dd>${esc(previous.metric)}</dd><dt>Obszar zmiany</dt><dd>${esc(OBSTACLES.find(item => item.id === previous.obstacle)?.label ?? 'Organizacja pracy')}</dd>${option ? `<dt>Odpowiada</dt><dd>${esc(option.owner)}</dd>` : ''}</dl>`;
  if (!option) return '<p>Opisz działanie i zdarzenie, które będziecie liczyć. Ustal, które sprawy wchodzą do pomiaru.</p>';
  return `<dl class="definition"><dt>Odpowiada</dt><dd>${esc(option.owner)}</dd><dt>Miernik</dt><dd>${esc(option.metric)}</dd></dl><p class="small">${esc(option.development)}</p>`;
}

export function metricDefinitionView(definition) {
  return definition ? `<dl class="definition"><dt>Zdarzenie</dt><dd>${esc(definition.event)}</dd><dt>Zakres spraw</dt><dd>${esc(definition.population)}</dd><dt>Źródło danych</dt><dd>${esc(definition.source)}</dd></dl>` : '<p class="small sub">W archiwalnym pomiarze brakuje pełnej definicji miernika.</p>';
}

export function trialForm({ selected, start, previous, days = RULESET.trialDays }) {
  const current = previous ? (selected || previous.optionId) : selected;
  const isCustom = current === 'custom';
  const options = [...ACTION_OPTIONS,custom];
  const comparable = Boolean(previous?.metricDefinition && previous?.followUpTotal != null && previous.followUp != null);
  const sameWindow = comparable && previous.reviewDate === start;
  const previousCustom = previous?.optionId === 'custom' ? previous : null;
  const selector = options.map(item => `<label class="action-choice"><input type="radio" name="option" value="${esc(item.id)}"${current === item.id ? ' checked' : ''}><span><strong>${esc(item.label)}</strong><span>${esc(item.description)}</span></span></label>`).join('');
  const fields = `${field('label','Nazwa działania',previousCustom?.label,{required:true,extra:'maxlength="120"'})}${field('description','Co zmienicie w pracy?',previousCustom?.description,{required:true,type:'textarea',extra:'maxlength="1000"'})}${field('owner','Kto odpowiada za zmianę?',previousCustom?.owner,{required:true,extra:'maxlength="160"'})}${previous ? '' : field('metric','Jakie zdarzenie mierzycie?', '',{required:true,extra:'maxlength="160"',hint:'Np. zwroty sprawy z powodu brakujących danych. Mniej zdarzeń oznacza lepszy wynik.'})}${field('development','Wniosek do planu rozwojowego',previousCustom?.development,{type:'textarea',extra:'maxlength="1000"'})}`;
  const defaults = buildAction(current,{})?.metricDefinition ?? {};
  const method = previous?.metricDefinition ? metricDefinitionView(previous.metricDefinition) : `<fieldset class="trial-fields stack tight"><legend>Definicja miernika</legend>
    ${field('metricEvent','Co liczy się jako zdarzenie?',defaults.event,{required:true,extra:'maxlength="300"'})}
    ${field('metricPopulation','Jakie sprawy wchodzą do mianownika?',defaults.population,{required:true,extra:'maxlength="300"'})}
    ${field('metricSource','Skąd pochodzą dane?',defaults.source,{required:true,extra:'maxlength="300"'})}
  </fieldset>`;
  return `<section class="surface stack"><div><h2>${previous ? 'Zaplanuj kolejną próbę' : 'Ustal działanie na 30 dni'}</h2><p class="sub">${previous ? 'Zachowaj wspólny miernik i zmień sposób pracy. Poprzedni wynik zostanie w historii.' : 'Wybierz zmianę w pracy i ustal, jak sprawdzicie jej efekt.'}</p></div><form data-form="action" class="stack"><input type="hidden" name="repeat" value="${previous ? 'yes' : ''}"><fieldset class="checks"><legend>Działanie po rozmowie</legend>${selector}</fieldset><div id="option-summary" class="callout">${optionSummary(current,previous)}</div><fieldset id="custom-trial-fields" class="checks"${isCustom ? '' : ' hidden disabled'}><legend>Własne działanie</legend>${fields}</fieldset>${method}${previous ? '' : field('obstacle','Przeszkoda organizacyjna','',{type:'select',options:[{value:'',label:'Zgodnie z wybranym działaniem'},...OBSTACLES.map(item => ({value:item.id,label:item.label}))]})}${field('date','Początek działania',start,{type:'date',required:true,extra:`data-trial-days="${esc(days)}"${previous?.reviewDate ? ` min="${esc(previous.reviewDate)}"` : ''}`})}<fieldset class="trial-fields stack tight"><legend>Pomiar przed próbą</legend><div class="form-grid">${field('baseline','Liczba zdarzeń',sameWindow ? previous.followUp : '',{type:'number',required:true,extra:countAttrs})}${field('baselineTotal','Wszystkie sprawy w tym samym okresie',sameWindow ? previous.followUpTotal : '',{type:'number',required:true,extra:totalAttrs})}</div><div class="form-grid">${field('baselineFrom','Początek pomiaru',addDays(start,-days),{type:'date',required:true})}${field('baselineTo','Koniec pomiaru',addDays(start,-1),{type:'date',required:true})}</div>${sameWindow ? '<p id="baseline-carried" class="small sub">Wpisano wynik poprzedniej próby jako punkt odniesienia dla nowego okresu.</p>' : ''}</fieldset>${field('targetRate','Docelowy odsetek zdarzeń (%)',previous?.targetRate ?? '',{type:'number',extra:'min="0" max="100" step="0.1"',hint:'Opcjonalnie. Np. 25 oznacza cel nie więcej niż 25% spraw z mierzonym zdarzeniem.'})}<div class="row">${submit(previous ? 'Rozpocznij kolejną próbę' : 'Ustal działanie','calendar')}${previous ? button('Anuluj','repeat-cancel',{style:'text'}) : ''}</div></form></section>`;
}

function rateCard(label, count, total, rate, period, isAfter) {
  const available = rate != null;
  return `<div class="trial-rate ${isAfter ? 'trial-rate-after' : ''}"><span class="date">${label}</span><strong>${available ? `${percent.format(rate)}%` : count != null ? esc(count) : '—'}</strong><span class="small sub">${available ? `${esc(count)} z ${esc(total)} spraw` : count != null ? `${esc(count)} zdarzeń · brak łącznej liczby spraw` : 'Pomiar jeszcze nie jest dostępny'}</span>${period ? `<span class="date">${esc(period)}</span>` : ''}${available ? `<div class="trial-bar" aria-hidden="true"><span style="width:${Math.max(0,Math.min(100,rate))}%"></span></div>` : ''}</div>`;
}

export function trialComparison(action, {compact = false} = {}) {
  const comparison = compareTrial(action);
  const {beforeRate,afterRate,deltaPoints,smallSample,countDroppedButRateRose,targetReached} = comparison;
  const delta = deltaPoints == null ? '' : `${deltaPoints > 0 ? '+' : ''}${percent.format(deltaPoints)} pkt proc.`;
  const beforePeriod = range(action.baselineFrom,action.baselineTo);
  const afterPeriod = range(action.startDate,action.reviewDate ? addDays(action.reviewDate,-1) : null);
  const duration = (from,to) => (Date.parse(to) - Date.parse(from)) / 86400000;
  const differentWindows = beforePeriod && afterPeriod && duration(action.baselineFrom,addDays(action.baselineTo,1)) !== duration(action.startDate,action.reviewDate);
  const target = action.targetRate == null ? '' : pill(`Cel ≤ ${percent.format(action.targetRate)}%${targetReached == null ? '' : targetReached ? ' · osiągnięty' : ' · nieosiągnięty'}`,targetReached === false ? 'warning' : 'neutral');
  const warnings = compact ? '' : [
    countDroppedButRateRose ? callout('<strong>Mniej zdarzeń, wyższy odsetek</strong><p>Liczba wszystkich spraw była niższa. Przed decyzją sprawdźcie, czy ich zakres i obciążenie zespołu były porównywalne.</p>','warning') : '',
    smallSample ? `<p class="small sub">Co najmniej jeden okres ma mniej niż ${MIN_TRIAL_SAMPLE} spraw. Omówcie wynik i zbierzcie więcej danych przed wyciągnięciem wniosków.</p>` : '',
    differentWindows ? '<p class="small sub">Okresy mają różną długość. Przed porównaniem sprawdźcie, czy dobór spraw był taki sam.</p>' : '',
    action.followUp != null && (beforeRate == null || afterRate == null) ? '<p class="small sub">Do porównania odsetków potrzebna jest łączna liczba spraw z obu okresów.</p>' : '',
  ].join('');
  return `<div class="trial-comparison stack tight"><div class="row between"><h3>Pomiar przed i po</h3><div class="row">${delta ? pill(delta,deltaPoints > 0 ? 'warning' : 'neutral') : ''}${target}</div></div><div class="trial-rates">${rateCard('Przed próbą',action.baseline,action.baselineTotal,beforeRate,beforePeriod,false)}${rateCard('Podczas próby',action.followUp,action.followUpTotal,afterRate,afterPeriod,true)}</div>${warnings}</div>`;
}

export function trialHistory(items) {
  if (!items.length) return '';
  return `<section class="surface stack"><h2>Historia prób</h2>${items.slice().reverse().map((entry,index) => `<details><summary>Próba ${items.length-index} · ${esc(entry.label)} · ${date(entry.reviewDate)}</summary><div class="stack tight">${metricDefinitionView(entry.metricDefinition)}${trialComparison(entry,{compact:true})}${entry.decision ? `<p class="small"><strong>Decyzja</strong> · ${esc(entry.decision)}</p>` : ''}${entry.note ? `<p class="small sub">${esc(entry.note)}</p>` : ''}${entry.employeeComment ? `<p class="small"><strong>Opinia pracownika</strong> · ${esc(entry.employeeComment)}</p>` : ''}</div></details>`).join('')}</section>`;
}

export function trialFollowup(action) {
  return `<form data-form="followup" class="stack"><fieldset class="trial-fields stack tight"><legend>Pomiar za okres ${esc(range(action.startDate,addDays(action.reviewDate,-1)))}</legend><div class="form-grid">${field('value','Liczba zdarzeń','',{type:'number',required:true,extra:countAttrs})}${field('total','Wszystkie sprawy w tym samym okresie','',{type:'number',required:action.baselineTotal != null,extra:totalAttrs})}</div></fieldset><div id="live-trial-comparison" aria-live="polite" hidden></div>${field('note','Wniosek kierownika po rozmowie','',{type:'textarea',required:true})}${field('decision','Decyzja','Kontynuować',{type:'select',options:['Kontynuować','Zmienić','Zakończyć'].map(value => ({value,label:value}))})}<div>${submit('Zapisz weryfikację')}</div></form>`;
}

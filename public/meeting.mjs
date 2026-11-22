import { date, esc } from './ui.mjs';

const find = id => document.getElementById(id);
const id = location.hash.slice(1);
if (/^[a-zA-Z0-9_-]+$/.test(id)) find('return-to-case').href = '/?sprawa='+encodeURIComponent(id);
let meeting;
let entirePeriod = false;
let loading = false;
let fingerprint = '';
let epoch = 0;
let chosenCriterion;
let agentRequest;

function resetAnswer() {
  agentRequest?.abort();
  agentRequest = null;
  find('agent-result').replaceChildren();
  find('agent-result').removeAttribute('aria-busy');
}

async function askAgent(input) {
  resetAnswer();
  const request = new AbortController();
  agentRequest = request;
  const out = find('agent-result');
  out.setAttribute('aria-busy','true');
  out.textContent = input.question ? 'Model wybiera narzędzie…' : 'Sprawdzam udostępnione wpisy…';
  try {
    const response = await fetch(`/api/cases/${id}/meeting/agent`, {
      method:'POST',headers:{'Content-Type':'application/json'},signal:request.signal,
      body:JSON.stringify({...input,criterion:find('criterion').value}),
    });
    const data = await response.json();
    if (request.signal.aborted) return;
    if (!response.ok) throw new Error(data.error || 'Nie udało się pobrać odpowiedzi.');
    const {mode,title,summary,questions,sources} = data.answer;
    out.innerHTML = `<div><p class="eyebrow">${esc(mode)}</p><h3>${esc(title)}</h3></div><p>${esc(summary)}</p>
      ${questions.map(q => `<p class="context">${esc(q)}</p>`).join('')}
      ${sources.length ? `<details open><summary>Wpisy źródłowe (${sources.length})</summary><ul class="source-list">${sources.map((s,index) => `<li><strong>${date(s.date)}</strong> · ${esc(s.text)}${s.replies.map(r => `<p class="context">Głos pracownika · ${esc(r)}</p>`).join('')} <button type="button" class="btn text" data-source="${index}">Pokaż na osi</button></li>`).join('')}</ul></details>` : ''}`;
    for (const button of out.querySelectorAll('[data-source]')) {
      button.onclick = () => {
        const source = sources[Number(button.dataset.source)];
        const index = meeting.observations.filter(entry => (entry.criterion || '') === find('criterion').value)
          .findIndex(entry => entry.date === source.date && entry.text === source.text && JSON.stringify(entry.replies) === JSON.stringify(source.replies));
        if (index < 0) return;
        setPeriod(true);
        const item = find('entries').children[index];
        item.tabIndex = -1;
        item.focus();
      };
    }
  } catch (error) {
    if (!request.signal.aborted) out.textContent = error.message;
  } finally {
    if (agentRequest === request) out.removeAttribute('aria-busy');
  }
}

find('ask-agent').onclick = () => {
  const panel = find('agent');
  panel.hidden = !panel.hidden;
  find('ask-agent').setAttribute('aria-expanded', String(!panel.hidden));
  if (!panel.hidden) panel.querySelector(find('agent-form').hidden ? 'summary' : 'input').focus();
};
find('agent-form').onsubmit = event => {
  event.preventDefault();
  void askAgent({question:find('agent-input').value.trim()});
};
for (const button of document.querySelectorAll('[data-tool]')) button.onclick = () => void askAgent({tool:button.dataset.tool});

function paint() {
  const matching = meeting.observations.filter(entry => (entry.criterion || '') === find('criterion').value);
  const earlier = matching.filter(entry => entry.date < meeting.recentStart);
  const visible = entirePeriod ? matching : matching.filter(entry => entry.date >= meeting.recentStart);
  find('recent').textContent = `Ostatnie ${meeting.recentDays} dni`;
  find('recent').setAttribute('aria-pressed', String(!entirePeriod));
  find('full').setAttribute('aria-pressed', String(entirePeriod));
  const start = entirePeriod ? meeting.start : meeting.recentStart;
  find('range-caption').textContent = start > meeting.end ? 'Okres rozmowy jeszcze się nie rozpoczął.' : `${date(start)} – ${date(meeting.end)} · Liczba wpisów: ${visible.length}`;
  find('entries').innerHTML = visible.length ? visible.map(entry => `<li><time class="date" datetime="${esc(entry.date)}">${date(entry.date)}</time><div class="meeting-entry"><p>${esc(entry.text)}</p>${entry.replies.map(reply => `<div class="context"><strong>Głos pracownika</strong><p>${esc(reply)}</p></div>`).join('')}</div></li>`).join('') : '<li>Brak udostępnionych obserwacji w wybranym zakresie.</li>';
  const hasBoth = earlier.length > 0 && matching.length > earlier.length;
  find('question').textContent = entirePeriod && hasBoth
    ? `Wróćmy do wpisu z ${new Intl.DateTimeFormat('pl-PL', {day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(earlier[0].date))}. Co od tamtej pory zmieniło się w pracy?`
    : visible.length ? 'Jak wyglądały te sytuacje z Twojej perspektywy?' : 'Jaki konkretny przykład warto wspólnie omówić?';
  find('explanation').textContent = !entirePeriod && earlier.length
    ? `Wcześniejsze wpisy dla tego kryterium: ${earlier.length}. Możecie do nich wrócić przed sformułowaniem wniosku.`
    : 'Pracownik może dopisać kontekst w zakładce Obserwacje na swoim koncie. Odpowiedź pojawi się przy konkretnym wpisie.';
  find('expand').hidden = entirePeriod || !earlier.length;
}

function setPeriod(full) {
  entirePeriod = full;
  paint();
}

function clearBoard(message) {
  resetAnswer();
  find('agent-input').value = '';
  meeting = null;
  fingerprint = '';
  find('board').hidden = true;
  find('entries').replaceChildren();
  find('criterion').replaceChildren();
  find('person').textContent = 'Wspólny ekran rozmowy';
  find('period').textContent = '';
  find('demo').hidden = true;
  find('status').textContent = message;
}

async function refresh() {
  if (loading || document.hidden) return;
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return clearBoard('Otwórz wspólny ekran z wybranej sprawy.');
  const turn = epoch;
  loading = true;
  try {
    const response = await fetch(`/api/cases/${id}/meeting`, { cache:'no-store', signal:AbortSignal.timeout(8000) });
    const data = await response.json();
    if (turn !== epoch) return;
    if (!response.ok) return clearBoard(data.error || 'Otwórz rozmowę z konta uczestnika.');
    find('status').textContent = '';
    const next = JSON.stringify(data);
    if (next === fingerprint) return;
    resetAnswer();
    fingerprint = next;
    meeting = data.meeting;
    const counts = new Map();
    for (const entry of meeting.observations) {
      const criterion = entry.criterion || '';
      counts.set(criterion, (counts.get(criterion) ?? 0) + 1);
    }
    const labels = [...counts.keys()].sort((a,b) => counts.get(b) - counts.get(a) || a.localeCompare(b,'pl'));
    find('criterion').replaceChildren(...labels.map(label => new Option(label || 'Bez przypisanego kryterium', label)));
    if (counts.has(chosenCriterion)) find('criterion').value = chosenCriterion;
    find('criterion').disabled = !labels.length;
    find('person').textContent = meeting.employee;
    find('period').textContent = meeting.start > meeting.end ? `Początek okresu · ${date(meeting.start)}` : `Okres rozmowy · ${date(meeting.start)} – ${date(meeting.end)}`;
    find('board').hidden = false;
    find('demo').hidden = !data.demoMode;
    find('agent-form').hidden = !data.aiConfigured;
    find('agent-mode').textContent = data.aiConfigured ? 'Model na tym komputerze dobiera narzędzie do pytania. Odpowiedź korzysta z wpisów udostępnionych dla wybranego kryterium.' : 'Model jest wyłączony. Dostępne są gotowe polecenia.';
    paint();
  } catch {
    if (turn === epoch) clearBoard('Utracono połączenie. Ekran spróbuje ponownie połączyć się z urzędem.');
  } finally {
    loading = false;
    if (turn !== epoch && !document.hidden) void refresh();
  }
}

find('recent').onclick = () => setPeriod(false);
find('full').onclick = () => setPeriod(true);
find('expand').onclick = () => { setPeriod(true); find('full').focus(); };
find('criterion').onchange = () => { resetAnswer(); chosenCriterion = find('criterion').value; paint(); };
function suspend() {
  epoch++;
  clearBoard('');
}
document.addEventListener('visibilitychange', () => document.hidden ? suspend() : void refresh());
window.addEventListener('pagehide', suspend);
window.addEventListener('pageshow', refresh);
setInterval(refresh, 4000);
void refresh();

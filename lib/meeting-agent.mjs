import { problem } from './cases.mjs';

const tools = {
  porownaj_okresy:'Porównanie ostatnich i wcześniejszych wpisów',
  glos_pracownika:'Odpowiedzi pracownika przy obserwacjach',
  przygotuj_rozmowe:'Przygotowanie pytań do rozmowy',
};
const routes = [...Object.keys(tools), 'poza_zakresem'];
const instructions = `Choose a tool for the user's Polish question. Return the JSON object {"tool":"..."}.
porownaj_okresy: compare recent and earlier observations, older evidence, change over time.
glos_pracownika: find comments or perspective already provided by the employee.
przygotuj_rozmowe: prepare an agenda, questions to ask or identify missing context.
poza_zakresem: all other tasks, including giving a grade, judging a person, deciding promotion or dismissal.
Examples: "Co było wcześniej?" -> porownaj_okresy. "Co dopisała Anna?" -> glos_pracownika. "O co warto zapytać?" -> przygotuj_rozmowe. "Jaką ocenę jej dać?" -> poza_zakresem.`;

export function localPlanner(endpoint) {
  if (!endpoint) return null;
  const url = new URL(endpoint);
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1','[::1]','localhost'].includes(url.hostname) || url.username || url.password) {
    throw new Error('DSO_AI_URL musi wskazywać lokalny serwer modelu.');
  }
  let active = 0;
  return async question => {
    if (active >= 2) throw problem(429,'Model odpowiada na inne pytania. Spróbuj ponownie za chwilę.');
    active++;
    try {
      const response = await fetch(url, {
        method:'POST', redirect:'error', signal:AbortSignal.timeout(25000),
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          model:process.env.DSO_AI_MODEL || 'local', temperature:0, max_tokens:48, stream:false,
          messages:[{role:'system',content:instructions},{role:'user',content:question}],
          response_format:{type:'json_schema', json_schema:{name:'tool_selection',schema:{
            type:'object',properties:{tool:{type:'string',enum:routes}},required:['tool'],additionalProperties:false,
          }}},
        }),
      });
      if (!response.ok) throw new Error();
      const reply = await response.json();
      const {tool} = JSON.parse(reply.choices[0].message.content);
      if (!routes.includes(tool)) throw new Error();
      return tool;
    } catch {
      throw problem(503,'Model lokalny nie odpowiedział. Możesz użyć gotowych poleceń poniżej.');
    } finally { active--; }
  };
}

export async function answerMeeting(meeting, body, planner) {
  if (typeof body.criterion !== 'string' || body.criterion.length > 180) throw problem(400,'Wybierz kryterium rozmowy.');
  const entries = meeting.observations.filter(entry => (entry.criterion || '') === body.criterion);
  let tool;
  let mode;
  if (body.tool !== undefined) {
    if (typeof body.tool !== 'string' || !Object.hasOwn(tools,body.tool)) throw problem(400,'Wybierz dostępne polecenie.');
    tool = body.tool;
    mode = 'Gotowe polecenie';
  } else {
    if (typeof body.question !== 'string' || !body.question.trim() || body.question.length > 500) throw problem(400,'Wpisz pytanie do 500 znaków.');
    if (!planner) throw problem(503,'Na tym serwerze model jest wyłączony. Wybierz gotowe polecenie.');
    tool = await planner(body.question.trim());
    mode = 'Narzędzie wybrane przez lokalny model AI';
  }
  const result = {mode,title:tools[tool] || 'Zakres asystenta',summary:'',sources:[],questions:[]};
  if (!Object.hasOwn(tools,tool)) {
    result.summary = 'Mogę porównać wpisy, odszukać głos pracownika lub przygotować pytania. Ocenę ustala przełożony.';
    return result;
  }
  const recent = entries.filter(entry => entry.date >= meeting.recentStart);
  const earlier = entries.filter(entry => entry.date < meeting.recentStart);
  const withReplies = entries.filter(entry => entry.replies.length);
  if (!entries.length) {
    result.summary = 'Brak udostępnionych wpisów w okresie dla wybranego kryterium.';
    return result;
  }
  if (tool === 'glos_pracownika') {
    result.summary = `Liczba wpisów z odpowiedzią pracownika: ${withReplies.length} z ${entries.length}.`;
    result.sources = withReplies.slice(-3);
    if (!withReplies.length) result.questions.push('Który z opisanych przykładów chcesz uzupełnić o swoją perspektywę?');
  } else {
    result.summary = `Liczba obserwacji dla tego kryterium w ostatnich ${meeting.recentDays} dniach: ${recent.length}. We wcześniejszej części okresu: ${earlier.length}.`;
    result.sources = [...earlier.slice(-2), ...recent.slice(-3)];
    if (tool === 'przygotuj_rozmowe') {
      if (withReplies.length) result.sources = [...new Set([...result.sources,withReplies.at(-1)])];
      result.questions.push(withReplies.length ? 'Do którego z Twoich dopisków warto dziś wrócić?' : 'Jak te sytuacje wyglądały z Twojej perspektywy?');
      result.questions.push('Jakie jedno działanie możemy wspólnie sprawdzić do następnej rozmowy?');
    }
    if (earlier.length && recent.length) result.questions.unshift('Co zmieniło się w organizacji pracy między tymi przykładami?');
  }
  return result;
}

import { esc, pill } from './ui.mjs';

const directions = {
  decreased: 'Odsetek zdarzeń niższy po zmianie',
  increased: 'Odsetek zdarzeń wyższy po zmianie',
  stable: 'Zmiana odsetka bliska zeru',
};

function groupView(group) {
  const value = group.medianDeltaPoints;
  const points = `${value > 0 ? '+' : value < 0 ? '−' : '≈ '}${Math.abs(value)} p.p.`;
  return `<article class="surface stack tight"><div class="row between"><h3>${esc(group.label)}</h3>${pill(`${group.caseRange} osób`, 'neutral')}</div><p class="small sub">${esc(group.metricLabel)}</p><p class="trial-insight-delta"><strong>${esc(points)}</strong></p><p class="small sub">${esc(directions[group.direction] ?? '')}</p></article>`;
}

export function trialInsightsView(insights, {demo = false} = {}) {
  if (!insights) return '';
  const title = demo ? 'Przykład dla kadr' : 'Przeszkody organizacyjne i efekty zmian';
  const intro = demo ? 'Dane fikcyjne pokazujące, jak wygląda zestawienie po zebraniu pomiarów.' : 'Zestawienie zmian odsetka zdarzeń w zakończonych próbach organizacyjnych.';
  const details = `Próg publikacji to ${insights.minimumCases} osób dla tej samej kategorii i miernika. Mierniki porównujemy według definicji zdarzenia, zakresu spraw w mianowniku i źródła danych. Dla każdej osoby liczy się jej ostatnia próba w grupie. Pokazujemy medianę zmiany odsetka, zaokrągloną do 5 punktów procentowych. Wynik może zależeć też od innych zmian w organizacji pracy.`;
  return `<section class="surface stack" aria-label="${esc(title)}"><div class="stack tight"><div class="row between"><h2>${esc(title)}</h2>${demo ? pill('Dane demonstracyjne','warning') : ''}</div><p class="sub">${esc(intro)}</p></div>${insights.groups.length ? `<div class="grid-stat">${insights.groups.map(groupView).join('')}</div>` : `<p class="callout">Zestawienie pojawi się, gdy co najmniej ${esc(insights.minimumCases)} osób dla tej samej kategorii i miernika zakończy porównywalną próbę.</p>`}${insights.suppressed && insights.groups.length ? '<p class="small sub">Grupy poniżej progu publikacji są ukryte.</p>' : ''}<details><summary>Jak liczymy wyniki</summary><p class="small sub">${esc(details)}</p></details></section>`;
}

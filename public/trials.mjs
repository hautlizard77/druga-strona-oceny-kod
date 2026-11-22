import { addDays } from './domain.mjs';

export const OBSTACLES = Object.freeze([
  { id: 'priorities', label: 'Konflikt priorytetów' },
  { id: 'workload', label: 'Rozkład obciążenia' },
  { id: 'handoff', label: 'Przekazywanie spraw' },
  { id: 'skills', label: 'Potrzeba szkolenia lub wsparcia' },
  { id: 'tools', label: 'Narzędzia lub procedura' },
  { id: 'other', label: 'Inna przeszkoda organizacyjna' },
]);

export const MIN_TRIAL_SAMPLE = 10;

export function baselineWindow(startDate, days = 30) {
  return { baselineFrom: addDays(startDate, -days), baselineTo: addDays(startDate, -1) };
}

function rate(count, total) {
  if (!Number.isSafeInteger(count) || !Number.isSafeInteger(total) || total <= 0 || count < 0 || count > total) return null;
  return (count / total) * 100;
}

export function compareTrial(action = {}) {
  const { baseline, baselineTotal, followUp, followUpTotal, targetRate } = action ?? {};
  const beforeRate = rate(baseline, baselineTotal);
  const afterRate = rate(followUp, followUpTotal);
  const deltaPoints = beforeRate === null || afterRate === null ? null : afterRate - beforeRate;
  return {
    beforeRate,
    afterRate,
    deltaPoints,
    smallSample: (beforeRate !== null && baselineTotal < MIN_TRIAL_SAMPLE) || (afterRate !== null && followUpTotal < MIN_TRIAL_SAMPLE),
    countDroppedButRateRose: deltaPoints > 0 && followUp < baseline,
    targetReached: afterRate === null || !Number.isFinite(targetRate) || targetRate < 0 || targetRate > 100 ? null : afterRate <= targetRate,
  };
}

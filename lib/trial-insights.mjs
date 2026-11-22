import { createHash } from 'node:crypto';
import { ACTION_OPTIONS, addDays, buildAction } from '../public/domain.mjs';
import { compareTrial, OBSTACLES } from '../public/trials.mjs';

const minimumGroupSize = 5;
const obstacleIds = new Set(OBSTACLES.map(({id}) => id));
const publishedStatuses = new Set(['complete', 'completed']);

function obstacleKey(action) {
  if (obstacleIds.has(action.obstacle)) return action.obstacle;
  if (action.optionId === 'priorities' || action.optionId === 'workload') return action.optionId;
  return 'other';
}

function metricKey(action) {
  const definition = ['event','population','source'].map(key => action.metricDefinition?.[key]);
  if (!definition.every(value => typeof value === 'string' && value.trim())) return null;
  return JSON.stringify(definition.map(value => value.normalize('NFC').trim().replace(/\s+/g,' ').toLocaleLowerCase('pl-PL')));
}

function completionDate(action) {
  const completed = typeof action.completedAt === 'string' ? Date.parse(action.completedAt) : NaN;
  if (Number.isFinite(completed)) return new Date(completed).toISOString();
  const review = addDays(action.reviewDate, 0);
  return review ? `${review}T00:00:00.000Z` : '';
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const center = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[center] : (sorted[center - 1] + sorted[center]) / 2;
}

function band(count, minimumCases) {
  const cutoffs = [10, 20, 50, 100];
  const ceiling = cutoffs.find(limit => count < limit);
  const floor = Math.max(minimumCases, ...cutoffs.filter(limit => count >= limit));
  return ceiling === undefined ? `${floor}+` : `${floor}–${ceiling - 1}`;
}

function publicGroup(key, label, staffTrials, minimumCases) {
  const measuredDelta = median([...staffTrials.values()].map(({deltaPoints}) => deltaPoints));
  const medianDeltaPoints = Math.sign(measuredDelta) * Math.round(Math.abs(measuredDelta) / 5) * 5 || 0;
  return {
    key,
    label,
    caseRange: band(staffTrials.size, minimumCases),
    medianDeltaPoints,
    direction: medianDeltaPoints < 0 ? 'decreased' : medianDeltaPoints > 0 ? 'increased' : 'stable',
  };
}

export function buildTrialInsights(records, {minimumCases = minimumGroupSize} = {}) {
  const threshold = Number.isInteger(minimumCases) ? Math.max(minimumCases, minimumGroupSize) : minimumGroupSize;
  const grouped = new Map();
  for (const record of records) {
    if (typeof record.employeeId !== 'string' || !record.employeeId.trim()) continue;
    for (const action of [...(Array.isArray(record.actionHistory) ? record.actionHistory : []), record.action]) {
      if (!action || !publishedStatuses.has(action.status)) continue;
      const {deltaPoints} = compareTrial(action);
      if (!Number.isFinite(deltaPoints)) continue;
      const date = completionDate(action);
      if (!date) continue;

      const obstacle = obstacleKey(action);
      const metric = metricKey(action);
      if (!metric) continue;
      const key = JSON.stringify([obstacle,metric]);
      if (!grouped.has(key)) grouped.set(key,{obstacle,metric,staffTrials:new Map()});
      const {staffTrials} = grouped.get(key);
      const previous = staffTrials.get(record.employeeId);
      if (!previous || date >= previous.date) staffTrials.set(record.employeeId, {date, deltaPoints});
    }
  }

  const groups = [];
  let suppressed = false;
  for (const {obstacle,metric,staffTrials} of grouped.values()) {
    const label = OBSTACLES.find(item => item.id === obstacle).label;
    const preset = ACTION_OPTIONS.find(item => metricKey(buildAction(item.id,{})) === metric);
    const fingerprint = createHash('sha256').update(metric).digest('hex').slice(0,12);
    if (staffTrials.size < threshold) suppressed = true;
    else groups.push({...publicGroup(`${obstacle}/${fingerprint}`,label,staffTrials,threshold),
      metricLabel:preset?.metric || `Własny miernik · ${fingerprint}`});
  }
  return {minimumCases: threshold, groups, suppressed};
}

export function buildDemoTrialInsights() {
  const examples = [
    {obstacle:'priorities', pairs:[[8,20,4,8],[4,20,5,20],[10,25,6,12],[5,30,7,30],[12,40,8,20],[4,24,5,30],[7,28,7,24]]},
    {obstacle:'workload', pairs:[[10,20,6,20],[8,20,4,20],[8,20,3,20],[12,30,6,30],[5,20,4,20],[9,25,4,25]]},
    {obstacle:'handoff', pairs:[[2,20,1,12]]},
  ];
  return buildTrialInsights(examples.flatMap(({obstacle,pairs}) => pairs.map(([baseline,baselineTotal,followUp,followUpTotal], index) => ({
    employeeId: `demo-${obstacle}-${index}`,
    action: {...buildAction(obstacle === 'workload' ? 'workload' : 'priorities',{}), status:'completed', optionId:obstacle, obstacle, baseline, baselineTotal, followUp, followUpTotal, baselineFrom:'2026-09-01', baselineTo:'2026-09-30', startDate:'2026-10-01', reviewDate:'2026-10-31'},
  }))));
}

import { addDays, observationInPeriod, observationPeriod, RULESET } from '../public/domain.mjs';

export function sharedMeeting(record, today) {
  const period = observationPeriod(record,today);
  const {start,end} = period;
  const recentDays = record.ruleSnapshot?.recentDays || RULESET.recentDays;
  const recentStart = [start, addDays(end, 1 - recentDays)].sort().at(-1);
  const observations = (record.evidence ?? [])
    .filter(entry => entry.shared === true && observationInPeriod(entry,period))
    .map(({ id, date, criterion, text }) => ({
      date, criterion, text,
      replies: (record.contexts ?? []).filter(reply => reply.evidenceId === id).map(reply => reply.text),
    }))
    .sort((left, right) => left.date.localeCompare(right.date));
  return { employee:record.employeeName, start, end, recentStart, recentDays, observations };
}

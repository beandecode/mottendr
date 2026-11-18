import { describe, expect, it } from 'vitest';
import { initialState } from '../src/domain/seed';
import { addSampleProgress } from '../src/domain/sample-progress';
import { dailyCounts, stats } from '../src/domain/learning';
import { validateBackup } from '../src/domain/import-export';

// The demo's "sample progress" replays a month of study through the real session functions.
const now = new Date('2026-11-15T12:00:00Z').getTime();
const history = () => {
  const state = initialState(now);
  addSampleProgress(state, now);
  return state;
};

describe('sample progress', () => {
  it('fills a month of history and leaves the day and the preferences free', () => {
    const state = history();
    const before = initialState(now);
    expect(state.events.length).toBeGreaterThan(50);
    expect(state.session).toBeNull();
    expect(state.prefs.newLimit).toBe(before.prefs.newLimit);
    expect(state.prefs.sessionLimit).toBe(before.prefs.sessionLimit);
    expect(dailyCounts(state).size).toBeGreaterThanOrEqual(10);
    expect(stats(state, now).reviews).toBe(0);
    expect(state.tasks.some((t) => t.learnedAt)).toBe(true);
    expect(state.events.every((e) => !e.rating || [1, 2, 3, 4].includes(e.rating))).toBe(true);
    expect(state.events.every((e) => e.at < now)).toBe(true);
  });
  it('is deterministic', () => {
    const shape = (s: ReturnType<typeof history>) =>
      s.events.map((e) => [e.id, e.taskId, e.at, e.rating, e.after.card.due]);
    expect(shape(history())).toEqual(shape(history()));
  });
  it('produces a state the backup validator accepts', () => {
    const state = history();
    expect(() => validateBackup(JSON.parse(JSON.stringify(state)))).not.toThrow();
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { initialState } from '../src/domain/seed';
import {
  activeLearningCount,
  beginSession,
  buildQueue,
  commitAnswer,
  ensureTasks,
  refreshSession,
  sessionNeedsRefresh,
  skipTask,
  stats,
  undoLast,
} from '../src/domain/learning';
import { continuousOptions } from '../src/domain/study-preferences';
import { validateBackup } from '../src/domain/import-export';
import { preview } from '../src/scheduler';
import type { AppState } from '../src/domain/types';

const at = new Date('2026-10-06T14:00:00Z').getTime();
let state: AppState, sequence: number;
beforeEach(() => {
  state = initialState(at);
  sequence = 0;
  Object.assign(state.prefs, {
    continuousLearning: true,
    activeTaskLimit: 3,
    refillLimit: 2,
    newLimit: 10,
  });
});
function expose(time = at) {
  const id = state.session!.queue[0];
  commitAnswer(state, id, `event-${sequence++}`, time, 1000);
  return id;
}
function rate(rating: 1 | 2 | 3 | 4, time: number) {
  const id = state.session!.queue[0],
    task = state.tasks.find((t) => t.id === id)!;
  const outcomes = preview(task.card, time, state.prefs.retention);
  commitAnswer(state, id, `event-${sequence++}`, time, 1000, rating, outcomes, time);
  return id;
}
describe('continuous learning admission and scheduling', () => {
  it('starts with a bounded refill and continues beyond the fixed session count', () => {
    state.prefs.sessionLimit = 1;
    beginSession(state, 'recognition', at);
    expect(state.session!.queue).toHaveLength(2);
    expose();
    expose();
    expect(state.session!.queue).toHaveLength(1);
    expect(activeLearningCount(state, 'recognition')).toBe(3);
    expose();
    expect(state.session!.queue).toEqual([]);
    expect(state.session!.pending).toHaveLength(3);
    expect(state.session!.completed).toBe(3);
    expect(stats(state, at).introductions).toBe(3);
    expect(sessionNeedsRefresh(state, at + 59_999)).toBe(false);
    expect(sessionNeedsRefresh(state, at + 60_000)).toBe(true);
  });
  it('prioritizes due work after an answer without replacing a live card or revealing its answer', () => {
    beginSession(state, 'recognition', at);
    const first = expose(),
      live = state.session!.queue[0];
    refreshSession(state, at + 60_000);
    expect(state.session!.queue).toEqual([live, first]);
    const other = state.tasks.at(-1)!;
    other.learnedAt = at - 86400000;
    other.card.state = 2;
    other.card.due = at + 1;
    refreshSession(state, at + 60_000);
    expect(state.session!.queue[0]).toBe(live);
    expose(at + 60_000);
    expect(state.session!.queue[0]).toBe(other.id);
    expect(state.session!.queue).toContain(first);
  });
  it('keeps failed tasks in capacity, then admits new work after graduation', () => {
    state.prefs.activeTaskLimit = 1;
    state.prefs.refillLimit = 1;
    beginSession(state, 'recognition', at);
    const id = expose();
    refreshSession(state, at + 60_000);
    rate(1, at + 60_000);
    expect(state.tasks.find((t) => t.id === id)!.card.state).toBe(1);
    expect(state.session!.queue).toEqual([]);
    expect(activeLearningCount(state, 'recognition')).toBe(1);
    const due = state.tasks.find((t) => t.id === id)!.card.due;
    refreshSession(state, due);
    rate(4, due);
    expect(state.tasks.find((t) => t.id === id)!.card.state).toBe(2);
    expect(state.session!.queue).toHaveLength(1);
    expect(state.session!.queue[0]).not.toBe(id);
  });
  it('does not use the learning cap to hide existing due reviews', () => {
    state.prefs.activeTaskLimit = 1;
    for (const task of state.tasks.slice(0, 4)) {
      task.learnedAt = at - 1000;
      task.card.state = 3;
      task.card.due = at;
    }
    beginSession(state, 'recognition', at);
    expect(state.session!.queue).toHaveLength(4);
    expect(
      state.session!.queue.every((id) => state.tasks.find((t) => t.id === id)!.learnedAt),
    ).toBe(true);
  });
  it('enforces the daily unique-word budget across scopes and lets a known word acquire another direction', () => {
    state.prefs.newLimit = 1;
    state.entries.forEach((e, i) => (e.tags = [i === 0 ? 'first' : 'second']));
    beginSession(state, 'recognition', at, 'first');
    const id = expose();
    beginSession(state, 'recognition', at, 'second');
    expect(state.session!.queue).toEqual([]);
    ensureTasks(state, 'production', at);
    beginSession(state, 'production', at, 'first');
    expect(state.session!.queue).toHaveLength(1);
    expose();
    expect(stats(state, at).introductions).toBe(1);
    expect(state.tasks.find((t) => t.id === id)!.learnedAt).toBe(at);
  });
  it('recovers waiting tasks on restart and persists settings, progress and queues in backups', () => {
    state.prefs.activeTaskLimit = 1;
    beginSession(state, 'recognition', at);
    const id = expose();
    state.session = null;
    beginSession(state, 'recognition', at + 10_000);
    expect(state.session!.queue).toEqual([]);
    expect(state.session!.pending).toEqual([id]);
    const restored = validateBackup(JSON.parse(JSON.stringify(state)));
    expect(restored.session).toEqual(state.session);
    expect(restored.prefs).toEqual(state.prefs);
    expect(restored.events).toEqual(state.events);
    refreshSession(restored, at + 60_000);
    expect(restored.session!.queue).toEqual([id]);
  });
  it('retains queued work after lowering limits and stops adding until capacity is available', () => {
    beginSession(state, 'recognition', at);
    const queue = [...state.session!.queue];
    state.prefs.activeTaskLimit = 1;
    state.prefs.refillLimit = 1;
    refreshSession(state, at);
    expect(state.session!.queue).toEqual(queue);
    expose();
    expose();
    expect(state.session!.queue).toEqual([]);
    expect(activeLearningCount(state, 'recognition')).toBe(2);
  });
  it('undo restores the pre-refill queue and daily budget; duplicate submission does not refill again', () => {
    state.prefs.refillLimit = 1;
    beginSession(state, 'recognition', at);
    const session = structuredClone(state.session),
      id = expose();
    const after = structuredClone(state);
    commitAnswer(state, id, 'event-0', at, 1000);
    expect(state).toEqual(after);
    undoLast(state, at + 1);
    expect(state.session).toEqual(session);
    expect(stats(state, at).introductions).toBe(0);
    expect(state.tasks.find((t) => t.id === id)!.learnedAt).toBeUndefined();
    expect(sessionNeedsRefresh(state, at + 2)).toBe(false);
  });
  it('skips a task for this session without immediately selecting it again', () => {
    state.prefs.refillLimit = 1;
    beginSession(state, 'recognition', at);
    const first = state.session!.queue[0];
    skipTask(state, at);
    expect(state.session!.queue[0]).not.toBe(first);
    expect(state.session!.skipped).toEqual([first]);
    expect(state.events).toHaveLength(0);
    expect(sessionNeedsRefresh(state, at)).toBe(false);
  });
  it('keeps fixed sessions unchanged while off, and stops refilling when switched off live', () => {
    state.prefs.continuousLearning = false;
    state.prefs.sessionLimit = 2;
    beginSession(state, 'recognition', at);
    expose();
    expose();
    expect(state.session!.queue).toEqual([]);
    expect(sessionNeedsRefresh(state, at + 1)).toBe(false);
    state.prefs.continuousLearning = true;
    refreshSession(state, at + 1);
    expect(state.session!.queue).toHaveLength(1);
    state.prefs.continuousLearning = false;
    expose(at + 1);
    expect(state.session!.queue).toEqual([]);
  });
  it('samples from the full new pool and leaves preview planning side-effect free', () => {
    state.prefs.newWordOrder = 'shuffle';
    state.prefs.newLimit = 2;
    const before = structuredClone(state);
    expect(buildQueue(state, 'recognition', at, '', () => 0)).toEqual([
      state.tasks[1].id,
      state.tasks[2].id,
    ]);
    expect(state).toEqual(before);
  });
  it('does not refill an existing production session with a different prompt language', () => {
    beginSession(state, 'production', at);
    state.session!.queue = [];
    state.prefs.mode = 'enOnly';
    ensureTasks(state, 'production', at);
    refreshSession(state, at);
    expect(state.session!.queue).toEqual([]);
  });
});
describe('continuous learning preferences and compatibility', () => {
  it('supports older backups with disabled defaults without rewriting queues or learning records', () => {
    beginSession(state, 'recognition', at);
    expose();
    delete state.prefs.continuousLearning;
    delete state.prefs.activeTaskLimit;
    delete state.prefs.refillLimit;
    const old = structuredClone(state),
      restored = validateBackup(state);
    expect(continuousOptions(restored.prefs)).toEqual({
      enabled: false,
      activeLimit: 6,
      refillLimit: 1,
    });
    expect(restored.tasks).toEqual(old.tasks);
    expect(restored.events).toEqual(old.events);
    expect(restored.session).toEqual(old.session);
  });
  it('rejects malformed settings and preserves supported values including a refill larger than capacity', () => {
    for (const key of ['activeTaskLimit', 'refillLimit'] as const)
      for (const value of [0, 201, 1.5, null, '6', Infinity]) {
        const bad = structuredClone(state);
        Object.assign(bad.prefs, { [key]: value });
        expect(() => validateBackup(bad)).toThrow();
      }
    Object.assign(state.prefs, { continuousLearning: 'true' });
    expect(() => validateBackup(state)).toThrow();
    Object.assign(state.prefs, { continuousLearning: true, activeTaskLimit: 1, refillLimit: 200 });
    expect(validateBackup(state).prefs.refillLimit).toBe(200);
    beginSession(state, 'recognition', at);
    expect(state.session!.queue).toHaveLength(1);
  });
});

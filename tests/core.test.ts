import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { initialState } from '../src/domain/seed';
import {
  beginSession,
  buildQueue,
  commitAnswer,
  ensureTasks,
  entryProgress,
  entryProgresses,
  entryTag,
  setEntryFlag,
  streak,
  weekStats,
  progressBreakdown,
  addDays,
  weekStart,
  MATURE_DAYS,
  newRemainingToday,
  promotePending,
  skipTask,
  stats,
  undoLast,
} from '../src/domain/learning';
import { preview, recall } from '../src/scheduler';
import { IndexedDbStorage, ConflictError } from '../src/platform/storage';
import {
  commitImport,
  exportTsv,
  mergeBackup,
  parseEntries,
  validateBackup,
} from '../src/domain/import-export';
import type { AppState, Entry, LearningEvent } from '../src/domain/types';

const at = new Date('2026-10-04T14:00:00Z').getTime();
let state: AppState;
beforeEach(() => {
  state = initialState(at);
});
const expose = () => {
  beginSession(state, 'recognition', at);
  const id = state.session!.queue[0];
  commitAnswer(state, id, 'exposure-1', at, 1000);
  return id;
};
const review = (id: string, rating: 1 | 2 | 3 | 4, time = at + 60_001) => {
  state.session!.queue = [];
  promotePending(state, time);
  const task = state.tasks.find((t) => t.id === id)!;
  const outcomes = preview(task.card, time, state.prefs.retention);
  commitAnswer(state, id, `review-${time}`, time, 1500, rating, outcomes, time);
  return outcomes;
};
const entryStatus = (s: AppState, e: Entry, at: number) => entryTag(entryProgress(s, e, at));
describe('retrieval and scheduling', () => {
  it('prioritizes overdue tasks before new cards and respects session limits', () => {
    const old = state.tasks.at(-1)!;
    old.learnedAt = at - 86400000;
    old.card.due = at - 1000;
    state.prefs.sessionLimit = 2;
    expect(buildQueue(state, 'recognition', at)).toEqual([old.id, state.tasks[0].id]);
  });
  it('first exposure is not a successful review and waits one minute', () => {
    const id = expose(),
      task = state.tasks.find((t) => t.id === id)!;
    expect(task.card.reps).toBe(0);
    expect(state.events[0].rating).toBeUndefined();
    expect(stats(state, at).reviews).toBe(0);
    state.session!.queue = [];
    promotePending(state, at + 59_999);
    expect(state.session!.queue).toEqual([]);
    promotePending(state, at + 60_000);
    expect(state.session!.queue).toEqual([id]);
  });
  it('prevents rating an initial read', () => {
    beginSession(state, 'recognition', at);
    const id = state.session!.queue[0];
    expect(() => commitAnswer(state, id, 'bad', at, 100, 3)).toThrow('EXPOSURE_CANNOT_BE_RATED');
    expect(state.events).toEqual([]);
  });
  it('stores exactly the previewed schedule and idempotent review events', () => {
    const id = expose(),
      outcomes = review(id, 3),
      task = state.tasks.find((t) => t.id === id)!;
    expect(task.card).toEqual(outcomes[3]);
    expect(task.card.reps).toBe(1);
    commitAnswer(state, id, `review-${at + 60_001}`, at + 60_001, 100, 3, outcomes, at + 60_001);
    expect(state.events.length).toBe(2);
    expect(stats(state, at + 60_001).reviews).toBe(1);
  });
  it('undo restores the card, queue, event validity and statistics', () => {
    const id = expose(),
      before = structuredClone(state.tasks.find((t) => t.id === id)!);
    review(id, 1);
    undoLast(state, at + 70_000);
    expect(state.tasks.find((t) => t.id === id)).toEqual(before);
    expect(state.session!.queue[0]).toBe(id);
    expect(stats(state, at + 70_000).reviews).toBe(0);
    expect(state.events.at(-1)!.voidedAt).toBe(at + 70_000);
  });
  it('undoing exposure restores a genuinely unintroduced card', () => {
    const id = expose();
    undoLast(state, at + 1);
    expect(state.tasks.find((t) => t.id === id)!.learnedAt).toBeUndefined();
    expect(stats(state, at).introductions).toBe(0);
  });
  it('separates Chinese and English production while retaining recognition history', () => {
    const id = expose();
    ensureTasks(state, 'production', at);
    state.prefs.mode = 'enOnly';
    ensureTasks(state, 'production', at);
    expect(
      state.tasks.filter((t) => t.entryId === 'sample-1').map((t) => t.promptLanguage),
    ).toEqual(['fr', 'zh', 'en']);
    expect(state.tasks.find((t) => t.id === id)!.learnedAt).toBe(at);
  });
  it('introducing another task for a known word does not double-count new words', () => {
    expose();
    state.prefs.newLimit = 0;
    ensureTasks(state, 'production', at);
    const queue = buildQueue(state, 'production', at);
    expect(queue).toHaveLength(1);
    beginSession(state, 'production', at);
    commitAnswer(state, queue[0], 'new-direction', at + 100, 1000);
    expect(stats(state, at).introductions).toBe(1);
  });
  it('counts the new words left today across the whole library and never below zero', () => {
    state.prefs.newLimit = 3;
    expect(newRemainingToday(state, at)).toBe(3);
    expose();
    expect(newRemainingToday(state, at)).toBe(2);
    expect(newRemainingToday(state, at + 86_400_000)).toBe(3);
    state.prefs.newLimit = 0;
    expect(newRemainingToday(state, at)).toBe(0);
  });
  it('shares the daily new-word limit between study scopes without continuous learning', () => {
    Object.assign(state.prefs, { continuousLearning: false, newLimit: 3, sessionLimit: 50 });
    const freshIn = (scope: string) =>
      buildQueue(state, 'recognition', at, scope).filter(
        (id) => !state.tasks.find((t) => t.id === id)!.learnedAt,
      ).length;
    expect(freshIn('Verbs')).toBe(3);
    // A new word learned in another scope uses up today's allowance here too.
    beginSession(state, 'recognition', at, 'Essentials');
    commitAnswer(state, state.session!.queue[0], 'exposure-essentials', at, 1000);
    state.session = null;
    expect(newRemainingToday(state, at)).toBe(2);
    expect(freshIn('Verbs')).toBe(2);
  });
  it('reports where an entry stands: new, learning, due, mature or paused', () => {
    const id = expose();
    const task = state.tasks.find((t) => t.id === id)!;
    const entry = state.entries.find((e) => e.id === task.entryId)!;
    const other = state.entries.find(
      (e) => !state.tasks.some((t) => t.entryId === e.id && t.learnedAt !== undefined),
    )!;
    expect(entryStatus(state, other, at)).toBe('new');
    // Read once, never rated: seen, and due again a minute later.
    expect(entryProgress(state, entry, at).stage).toBe('seen');
    task.card = { ...task.card, due: at + 3 * 86_400_000, stability: 4, reps: 1, lapses: 4 };
    expect(entryProgress(state, entry, at)).toMatchObject({ stage: 'learning', lapses: 4 });
    expect(entryStatus(state, entry, at)).toBe('learning');
    expect(entryStatus(state, entry, at + 3 * 86_400_000)).toBe('due');
    task.card = { ...task.card, stability: MATURE_DAYS };
    expect(entryStatus(state, entry, at)).toBe('mature');
    // Due is a flag: a due mature word is still mature.
    expect(entryProgress(state, entry, at + 40 * 86_400_000)).toMatchObject({
      stage: 'mature',
      due: true,
    });
    entry.suspended = true;
    expect(entryStatus(state, entry, at)).toBe('paused');
    entry.suspended = false;
    entry.archived = true;
    expect(entryStatus(state, entry, at)).toBe('archived');
    expect(entryProgress(state, entry, at)).toMatchObject({
      stage: 'mature',
      paused: false,
      archived: true,
    });
    entry.archived = false;
    const all = entryProgresses(state, at);
    expect(state.entries.every((e) => entryTag(all.get(e.id)!) === entryStatus(state, e, at))).toBe(
      true,
    );
  });
  it('pausing or archiving entries takes their tasks out of the running session', () => {
    beginSession(state, 'recognition', at);
    const id = state.session!.queue[0];
    const entryId = state.tasks.find((t) => t.id === id)!.entryId;
    setEntryFlag(state, [entryId], 'favorite', true);
    expect(state.session!.queue).toContain(id);
    setEntryFlag(state, [entryId], 'suspended', true);
    expect(state.entries.find((e) => e.id === entryId)!.suspended).toBe(true);
    expect(state.session!.queue).not.toContain(id);
    setEntryFlag(state, [entryId], 'suspended', false);
    expect(state.entries.find((e) => e.id === entryId)!.suspended).toBe(false);
  });
  it('counts the practice streak, week totals and progress for the activity page', () => {
    // Synthetic events: only the fields these summaries read.
    const event = (time: number, rating?: 1 | 2 | 3 | 4, extra: Partial<LearningEvent> = {}) =>
      ({
        id: `e${time}`,
        at: time,
        kind: rating ? 'review' : 'exposure',
        rating,
        durationMs: 10_000,
        assisted: false,
        ...extra,
      }) as LearningEvent;
    const day = (n: number) => addDays(at, n) + 12 * 3_600_000;
    state.events = [
      event(day(-10)),
      event(day(-9), 3),
      event(day(-8), 3),
      // A gap on day -7, then a run up to yesterday.
      event(day(-6), 1),
      event(day(-5), 3),
      event(day(-4), 3),
      event(day(-3), 4),
      event(day(-2), 3),
      event(day(-1), 2, { assisted: true }),
      event(day(0), 3, { voidedAt: at }),
    ];
    // Today's only answer was undone, so the run up to yesterday counts.
    expect(streak(state, at)).toEqual({ current: 6, longest: 6 });
    state.events.push(event(day(0), 3));
    expect(streak(state, at).current).toBe(7);
    const thisWeek = weekStats(state, at);
    const inWeek = state.events.filter(
      (e) =>
        !e.voidedAt &&
        e.kind === 'review' &&
        !e.assisted &&
        e.at >= weekStart(at) &&
        e.at < addDays(weekStart(at), 7),
    );
    expect(thisWeek.reviews).toBe(inWeek.length);
    expect(weekStats(state, at, 1).reviews + thisWeek.reviews).toBeLessThanOrEqual(8);
    const counts = progressBreakdown(state, at);
    expect(
      counts.mature + counts.learning + counts.seen + counts.new + counts.paused + counts.archived,
    ).toBe(state.entries.length);
  });
  it('skipping an incomprehensible prompt writes no forgetting rating', () => {
    beginSession(state, 'production', at);
    skipTask(state);
    expect(state.session!.skipped.length).toBe(1);
    expect(state.events.length).toBe(0);
  });
  it('every rating has a finite schedule and recall declines over elapsed time', () => {
    const id = expose();
    const task = state.tasks.find((t) => t.id === id)!;
    const outcomes = preview(task.card, at + 60_000, 0.9);
    for (const rating of [1, 2, 3, 4] as const)
      expect(Number.isFinite(outcomes[rating].due) && outcomes[rating].due > at).toBe(true);
    const easy = outcomes[4];
    expect(recall(easy, at + 86_400_000, 0.9)!).toBeGreaterThan(
      recall(easy, at + 10 * 86_400_000, 0.9)!,
    );
  });
  it('suspended, archived and untranslated entries stay out of the queue', () => {
    state.entries[0].suspended = true;
    state.entries[1].archived = true;
    state.entries[2].groups[0].senses[0].definitions.en.short = '';
    state.prefs.mode = 'enOnly';
    const queue = buildQueue(state, 'recognition', at);
    expect(queue).not.toContain(state.tasks[0].id);
    expect(queue).not.toContain(state.tasks[1].id);
    expect(queue).not.toContain(state.tasks[2].id);
  });
  it('uses actual elapsed review times rather than synthetic daily successes', () => {
    const id = expose();
    review(id, 4);
    const task = state.tasks.find((t) => t.id === id)!;
    const late = at + 20 * 86400000;
    state.session!.queue = [id];
    state.session!.pending = [];
    const outcomes = preview(task.card, late, 0.9);
    commitAnswer(state, id, 'late', late, 1500, 3, outcomes, late);
    expect(state.events.length).toBe(3);
    expect(task.card.last_review).toBe(late);
    expect(task.card.elapsed_days).toBeGreaterThan(15);
  });
});
describe('IndexedDB transactional persistence', () => {
  it('round trips full backups, including undo snapshots and resumable sessions', async () => {
    const db = new IndexedDbStorage(`roundtrip-${crypto.randomUUID()}`);
    const id = expose();
    review(id, 3);
    const saved = await db.save(state, null);
    const loaded = await db.read();
    expect(validateBackup(JSON.parse(JSON.stringify(loaded)))).toEqual(saved);
  });
  it('rejects stale concurrent writes without changing persisted data', async () => {
    const name = `conflict-${crypto.randomUUID()}`,
      a = new IndexedDbStorage(name),
      b = new IndexedDbStorage(name);
    const initial = await a.save(state, null);
    const one = structuredClone(initial),
      two = structuredClone(initial);
    one.prefs.newLimit = 9;
    two.prefs.newLimit = 20;
    const results = await Promise.allSettled([
      a.save(one, initial.revision),
      b.save(two, initial.revision),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictError);
    expect((await a.read())!.prefs.newLimit).toBe(9);
  });
  it('storage failure leaves original state and session untouched', async () => {
    expose();
    const db = new IndexedDbStorage(`failure-${crypto.randomUUID()}`),
      saved = await db.save(state, null),
      draft = structuredClone(saved);
    undoLast(draft, at + 1);
    await expect(db.save(draft, saved.revision - 1)).rejects.toBeInstanceOf(ConflictError);
    expect(await db.read()).toEqual(saved);
  });
});
describe('content import and backup boundaries', () => {
  it('handles quoted tabs, newlines and apostrophes with lossless TSV round trips', () => {
    state.entries[0].groups[0].senses[0].definitions.zh.detail = '第一个\n第二个\t"说明"';
    const imported = parseEntries(exportTsv(state.entries), 'tsv', []);
    expect(imported.errors).toHaveLength(0);
    expect(imported.entries[0].groups[0].senses[0].definitions.zh).toEqual(
      state.entries[0].groups[0].senses[0].definitions.zh,
    );
    expect(imported.entries.length).toBe(30);
  });
  it('keeps accented words separate and deduplicates NFC equivalents', () => {
    const p = parseEntries(
      JSON.stringify([
        { word: 'ou', zh: '或' },
        { word: 'où', zh: '哪里' },
        { word: 'ou\u0300', zh: '哪里' },
      ]),
      'json',
      [],
    );
    expect(p.entries.length).toBe(2);
    expect(p.duplicates).toBe(1);
  });
  it('supports partial import, preserving existing progress and recording batches', () => {
    expose();
    const before = structuredClone(state.tasks[0]);
    const p = parseEntries(
      '[{"word":"salut","en":"hi"},{"word":"","en":"bad"}]',
      'json',
      state.entries,
    );
    expect(p.errors[0].row).toBe(2);
    commitImport(state, p.entries);
    expect(state.tasks[0]).toEqual(before);
    expect(state.importBatches.at(-1)!.entryIds.length).toBe(1);
  });
  it('rejects corrupt, future-schema and invalid enum backups before mutation', () => {
    for (const change of [
      (d: AppState) => {
        d.schemaVersion = 3 as 2;
      },
      (d: AppState) => {
        d.tasks[0].card.due = Infinity;
      },
      (d: AppState) => {
        d.prefs.swipeMap = [1, 1, 2, 3];
      },
      (d: AppState) => {
        d.tasks[0].entryId = 'missing';
      },
    ]) {
      const draft = structuredClone(state);
      change(draft);
      expect(() => validateBackup(draft)).toThrow();
    }
  });
  it('merges nonconflicting entries without overwriting current learning', () => {
    const incoming = initialState(at + 1);
    incoming.entries[0].id = 'remote-1';
    incoming.entries[0].word = 'salut';
    incoming.entries[0].groups[0].senses[0].definitions.en.short = 'hi';
    incoming.tasks = [];
    incoming.events = [];
    incoming.session = null;
    ensureTasks(incoming, 'recognition', at);
    expose();
    const oldTask = structuredClone(state.tasks[0]);
    mergeBackup(state, incoming);
    expect(state.entries.length).toBe(31);
    expect(state.tasks[0]).toEqual(oldTask);
    expect(() => validateBackup(state)).not.toThrow();
  });
});

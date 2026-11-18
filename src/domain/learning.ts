import type { AppState, Direction, Entry, LearningEvent, Session, Task } from './types';
import { localeFor } from './types';
import { hasExplanation } from './lexicon';
import { emptyCard, preview, schedulerParameters, SCHEDULER_VERSION } from '../scheduler';
export { newId as uid } from './id';
import { newId as uid } from './id';
import { snapshot } from './draft';
import { collectionOf, inScope } from './collections';
import { frequencyRank } from './pack';
import { continuousOptions } from './study-preferences';
export const dayKey = (at: number) => {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const taskId = (entryId: string, direction: Direction, locale: 'zh' | 'en') =>
  `${entryId}:${direction === 'recognition' ? 'recognition:fr' : `production:${locale}`}`;
function introducedEntries(state: AppState) {
  const first = new Map<string, number>();
  for (const event of state.events)
    if (!event.voidedAt && event.kind === 'exposure')
      first.set(event.entryId, Math.min(first.get(event.entryId) ?? Infinity, event.at));
  return first;
}
// New words still allowed today. The daily limit covers the whole library, whatever the study
// scope, with or without continuous learning: switching scopes cannot add more new words.
export function newRemainingToday(state: AppState, at: number) {
  const introduced = [...introducedEntries(state).values()].filter(
    (time) => dayKey(time) === dayKey(at),
  ).length;
  return Math.max(0, state.prefs.newLimit - introduced);
}
export function ensureTasks(state: AppState, direction: Direction, at = Date.now()) {
  const locale = localeFor(state.prefs.mode);
  const existingIds = new Set(state.tasks.map((t) => t.id));
  for (const entry of state.entries) {
    if (entry.archived || !hasExplanation(entry, locale)) continue;
    const id = taskId(entry.id, direction, locale);
    if (!existingIds.has(id))
      state.tasks.push({
        id,
        entryId: entry.id,
        target: { kind: 'entry' },
        direction,
        promptLanguage: direction === 'recognition' ? 'fr' : locale,
        card: emptyCard(at),
        enabled: true,
      });
  }
}
// The scope limits only new words: words already learned keep coming back for review in
// every scope, so narrowing the scope never strands them.
export function availableTasks(state: AppState, direction: Direction, scope = '') {
  const locale = localeFor(state.prefs.mode);
  const byId = new Map(state.entries.map((e) => [e.id, e]));
  return state.tasks.filter((t) => {
    const e = byId.get(t.entryId);
    return (
      e &&
      !e.suspended &&
      !e.archived &&
      t.enabled &&
      t.target.kind === 'entry' &&
      hasExplanation(e, locale) &&
      t.direction === direction &&
      (direction === 'recognition' || t.promptLanguage === locale) &&
      (t.learnedAt !== undefined || inScope(e, scope))
    );
  });
}
export function shuffled<T>(items: T[], random: () => number = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
// Order of new words (prefs.newWordOrder). Only new words are ordered; due reviews,
// the daily new-word limit and words already introduced are unaffected. By frequency, the
// learner's own entries (created or added from the dictionary) come first in their own
// order, then built-in entries by content/word-list/frequency.json, loosened by a fixed offset
// of at most FREQUENCY_JITTER places per entry (from its ID, so stable between sessions); a
// built-in entry missing from it (retired) goes last.
export const FREQUENCY_JITTER = 30;
export function frequencyJitter(entryId: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < entryId.length; i++) h = Math.imul(h ^ entryId.charCodeAt(i), 0x01000193);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h ^= h >>> 16;
  return ((h >>> 0) % (2 * FREQUENCY_JITTER + 1)) - FREQUENCY_JITTER;
}
export function orderNewTasks(
  state: AppState,
  tasks: Task[],
  random: () => number = Math.random,
): Task[] {
  const order = state.prefs.newWordOrder;
  if (order === 'shuffle') return shuffled(tasks, random);
  if (order !== 'frequency') return tasks;
  const rank = (t: Task) =>
    collectionOf({ id: t.entryId }) === 'word-list' ? (frequencyRank(t.entryId) ?? Infinity) : 0;
  const key = (t: Task) => {
    const r = rank(t);
    return [
      r === 0 || r === Infinity ? r : Math.max(1, r + frequencyJitter(t.entryId)),
      r,
    ] as const;
  };
  const keys = new Map(tasks.map((t) => [t, key(t)]));
  return [...tasks].sort((a, b) => {
    const [ka, ra] = keys.get(a)!,
      [kb, rb] = keys.get(b)!;
    return ka - kb || ra - rb || 0;
  });
}
export function buildQueue(
  state: AppState,
  direction: Direction,
  at: number,
  scope = '',
  random: () => number = Math.random,
): string[] {
  if (continuousOptions(state.prefs).enabled) {
    const session: Session = {
      id: 'preview',
      direction,
      promptLanguage: direction === 'recognition' ? 'fr' : localeFor(state.prefs.mode),
      queue: [],
      pending: [],
      startedAt: at,
      completed: 0,
      scope,
      skipped: [],
    };
    return planSessionQueue(state, session, at, true, random).queue;
  }
  const candidates = availableTasks(state, direction, scope);
  const known = introducedEntries(state);
  const freshLimit = newRemainingToday(state, at);
  const due = candidates
    .filter((t) => t.learnedAt && t.card.due <= at)
    .sort((a, b) => a.card.due - b.card.due);
  const freshTasks = candidates.filter((t) => !t.learnedAt);
  const order = (tasks: Task[]) => orderNewTasks(state, tasks, random);
  const fresh = [
    ...order(freshTasks.filter((t) => known.has(t.entryId))),
    ...order(freshTasks.filter((t) => !known.has(t.entryId))).slice(0, freshLimit),
  ];
  return [...due, ...fresh].slice(0, state.prefs.sessionLimit).map((t) => t.id);
}
export function beginSession(state: AppState, direction: Direction, at: number, scope = '') {
  ensureTasks(state, direction, at);
  state.prefs.direction = direction;
  state.session = {
    id: uid(),
    direction,
    promptLanguage: direction === 'recognition' ? 'fr' : localeFor(state.prefs.mode),
    queue: buildQueue(state, direction, at, scope),
    pending: [],
    startedAt: at,
    completed: 0,
    scope,
    skipped: [],
  };
  if (continuousOptions(state.prefs).enabled) refreshSession(state, at);
}
const shortTerm = (task: Task) =>
  task.learnedAt !== undefined && [0, 1, 3].includes(task.card.state);
export function activeLearningCount(
  state: AppState,
  direction: Direction,
  scope = '',
  queue: string[] = state.session?.queue ?? [],
) {
  const queued = new Set(queue);
  return availableTasks(state, direction, scope).filter(
    (task) => shortTerm(task) || (task.learnedAt === undefined && queued.has(task.id)),
  ).length;
}
// Pure planning lets the UI detect work without saving an unchanged state every second.
// A live card stays at the front; due priority is applied at answer/skip boundaries.
function planSessionQueue(
  state: AppState,
  s: Session,
  at: number,
  boundary = false,
  random: () => number = Math.random,
): Pick<Session, 'queue' | 'pending'> {
  const tasks = new Map(state.tasks.map((task) => [task.id, task]));
  const ready = s.pending.filter((id) => tasks.get(id)!.card.due <= at);
  let queue = [...s.queue, ...ready.filter((id) => !s.queue.includes(id))];
  let pending = s.pending.filter((id) => !ready.includes(id));
  const options = continuousOptions(state.prefs);
  if (!options.enabled) return { queue, pending };
  // Changing the explanation language cannot introduce tasks into an old-language session.
  if (s.direction === 'production' && s.promptLanguage !== localeFor(state.prefs.mode))
    return { queue, pending };
  const candidates = availableTasks(state, s.direction, s.scope),
    skipped = new Set(s.skipped),
    queued = new Set(queue);
  const due = candidates
    .filter(
      (task) =>
        task.learnedAt !== undefined &&
        task.card.due <= at &&
        !queued.has(task.id) &&
        !skipped.has(task.id),
    )
    .sort((a, b) => a.card.due - b.card.due);
  queue.push(...due.map((task) => task.id));
  const head = boundary ? undefined : s.queue[0];
  const overdue = (id: string) =>
    tasks.get(id)!.learnedAt !== undefined && tasks.get(id)!.card.due <= at;
  const rest = queue.filter((id) => id !== head);
  queue = [
    ...(head ? [head] : []),
    ...rest.filter(overdue).sort((a, b) => tasks.get(a)!.card.due - tasks.get(b)!.card.due),
    ...rest.filter((id) => !overdue(id)),
  ];
  const occupied = new Set(queue);
  pending = [
    ...new Set([
      ...pending,
      ...candidates
        .filter((task) => shortTerm(task) && task.card.due > at && !skipped.has(task.id))
        .map((task) => task.id),
    ]),
  ].filter((id) => !occupied.has(id));
  // Refill only when no task is immediately available. Waiting tasks still occupy capacity.
  if (queue.length) return { queue, pending };
  const capacity = Math.max(
    0,
    options.activeLimit - activeLearningCount(state, s.direction, s.scope, queue),
  );
  if (!capacity) return { queue, pending };
  const known = introducedEntries(state);
  const dailyRemaining = newRemainingToday(state, at);
  const fresh = candidates.filter((task) => task.learnedAt === undefined && !skipped.has(task.id));
  const order = (items: Task[]) => orderNewTasks(state, items, random);
  const eligible = [
    ...order(fresh.filter((task) => known.has(task.entryId))),
    ...order(fresh.filter((task) => !known.has(task.entryId))).slice(0, dailyRemaining),
  ];
  queue = eligible.slice(0, Math.min(capacity, options.refillLimit)).map((task) => task.id);
  return { queue, pending };
}
export function sessionNeedsRefresh(state: AppState, at: number) {
  if (!state.session) return false;
  const next = planSessionQueue(state, state.session, at);
  return (['queue', 'pending'] as const).some(
    (key) =>
      next[key].length !== state.session![key].length ||
      next[key].some((id, i) => id !== state.session![key][i]),
  );
}
export function refreshSession(state: AppState, at: number, boundary = false) {
  if (state.session)
    Object.assign(state.session, planSessionQueue(state, state.session, at, boundary));
}
export const promotePending = refreshSession;
export function commitAnswer(
  state: AppState,
  expectedTaskId: string,
  eventId: string,
  at: number,
  durationMs: number,
  rating?: 1 | 2 | 3 | 4,
  expectedPreview?: ReturnType<typeof preview>,
  previewAt?: number,
) {
  if (state.events.some((e) => e.id === eventId)) return;
  if (!state.session || state.session.queue[0] !== expectedTaskId)
    throw new Error('SESSION_CHANGED');
  const task = state.tasks.find((t) => t.id === expectedTaskId)!;
  const entry = state.entries.find((e) => e.id === task.entryId)!;
  const before = snapshot(task),
    sessionBefore = snapshot(state.session);
  if (!task.learnedAt) {
    if (rating !== undefined) throw new Error('EXPOSURE_CANNOT_BE_RATED');
    task.learnedAt = at;
    task.card.due = at + 60_000;
  } else {
    if (!rating || !expectedPreview || previewAt === undefined) throw new Error('RATING_REQUIRED');
    const validPreview = preview(before.card, previewAt, state.prefs.retention)[rating];
    if (JSON.stringify(validPreview) !== JSON.stringify(expectedPreview[rating]))
      throw new Error('PREVIEW_CHANGED');
    task.card = structuredClone(expectedPreview[rating]);
  }
  const event: LearningEvent = {
    id: eventId,
    taskId: task.id,
    entryId: entry.id,
    at: rating ? previewAt! : at,
    kind: rating ? 'review' : 'exposure',
    rating,
    before,
    after: snapshot(task),
    sessionBefore,
    explanationLocale: localeFor(state.prefs.mode),
    contentVersion: entry.contentVersion,
    schedulerVersion: SCHEDULER_VERSION,
    schedulerParameters: schedulerParameters(state.prefs.retention),
    durationMs,
    assisted: false,
  };
  state.events.push(event);
  state.session.queue.shift();
  state.session.completed++;
  if (!rating || task.card.state === 1 || task.card.state === 3)
    state.session.pending.push(task.id);
  if (continuousOptions(state.prefs).enabled) refreshSession(state, at, true);
}
export function undoLast(state: AppState, at: number) {
  const event = [...state.events]
    .reverse()
    .find((e) => !e.voidedAt && state.session?.id === e.sessionBefore.id);
  if (!event) throw new Error('NOTHING_TO_UNDO');
  const i = state.tasks.findIndex((t) => t.id === event.taskId);
  state.tasks[i] = snapshot(event.before);
  state.session = snapshot(event.sessionBefore);
  event.voidedAt = at;
}
export function skipTask(state: AppState, at = Date.now()) {
  if (!state.session?.queue.length) return;
  state.session.skipped.push(state.session.queue.shift()!);
  if (continuousOptions(state.prefs).enabled) refreshSession(state, at, true);
}
// An entry counts as mature once its memory would last this many days (FSRS stability).
export const MATURE_DAYS = 21;
// Where a word stands, as two independent things: its stage (how far the learner has got with it) and
// flags (due now, paused, archived). A due word keeps its stage, so "due" no longer hides learning or mature.
export type EntryStage = 'new' | 'seen' | 'learning' | 'mature';
export interface EntryProgress {
  stage: EntryStage;
  due: boolean;
  paused: boolean;
  archived: boolean;
  lapses: number;
}
// A word forgotten this many times counts as "often forgotten".
export const LEECH_LAPSES = 3;
// The recognition task that carries an entry's progress, as shown in its details: the learned
// one when there is one (tasks exist per prompt language), the most recently reviewed first.
const carriesProgress = (a: Task, b: Task) =>
  (a.learnedAt !== undefined) !== (b.learnedAt !== undefined)
    ? a.learnedAt !== undefined
    : (a.card.last_review ?? 0) > (b.card.last_review ?? 0);
export function entryTask(state: AppState, entryId: string): Task | undefined {
  let best: Task | undefined;
  for (const t of state.tasks)
    if (
      t.entryId === entryId &&
      t.direction === 'recognition' &&
      (!best || carriesProgress(t, best))
    )
      best = t;
  return best;
}
// Progress is read from the recognition task. `seen`: read once, never rated (no reviews yet).
function progressOf(entry: Entry, task: Task | undefined, at: number): EntryProgress {
  const learned = task !== undefined && task.learnedAt !== undefined;
  const stage: EntryStage = !learned
    ? 'new'
    : task.card.reps === 0
      ? 'seen'
      : task.card.stability >= MATURE_DAYS
        ? 'mature'
        : 'learning';
  return {
    stage,
    due: learned && task.card.due <= at,
    paused: entry.suspended,
    archived: entry.archived,
    lapses: task?.card.lapses ?? 0,
  };
}
export function entryProgress(state: AppState, entry: Entry, at: number): EntryProgress {
  return progressOf(entry, entryTask(state, entry.id), at);
}
// Every entry's progress in one pass over the tasks, for lists.
export function entryProgresses(state: AppState, at: number): Map<string, EntryProgress> {
  const best = new Map<string, Task>();
  for (const t of state.tasks) {
    if (t.direction !== 'recognition') continue;
    const current = best.get(t.entryId);
    if (!current || carriesProgress(t, current)) best.set(t.entryId, t);
  }
  return new Map(state.entries.map((e) => [e.id, progressOf(e, best.get(e.id), at)]));
}
// The one label a list row shows: archived and paused first, then due, else the stage.
export type EntryTag = EntryStage | 'due' | 'paused' | 'archived';
export const entryTag = (p: EntryProgress): EntryTag =>
  p.archived ? 'archived' : p.paused ? 'paused' : p.due ? 'due' : p.stage;
// Favorite, pause or archive entries, or undo it. Pausing or archiving also takes their tasks
// out of a running session.
export function setEntryFlag(
  state: AppState,
  ids: Iterable<string>,
  flag: 'favorite' | 'suspended' | 'archived',
  value: boolean,
) {
  const chosen = new Set(ids);
  for (const e of state.entries) if (chosen.has(e.id)) e[flag] = value;
  if (!value || flag === 'favorite' || !state.session) return;
  const taken = new Set(state.tasks.filter((t) => chosen.has(t.entryId)).map((t) => t.id));
  state.session.queue = state.session.queue.filter((id) => !taken.has(id));
  state.session.pending = state.session.pending.filter((id) => !taken.has(id));
}
// Counts for a set of events: unassisted retrievals, their success rate and time spent (each
// answer counts at most five minutes).
function summarize(events: LearningEvent[]) {
  const reviews = events.filter((e) => e.kind === 'review' && !e.assisted);
  return {
    reviews: reviews.length,
    success: reviews.length ? reviews.filter((e) => e.rating! > 1).length / reviews.length : null,
    seconds: Math.round(events.reduce((n, e) => n + Math.min(e.durationMs, 300_000), 0) / 1000),
  };
}
export function stats(state: AppState, at = Date.now(), scope = '') {
  const ids = scope
    ? new Set(state.entries.filter((e) => inScope(e, scope)).map((e) => e.id))
    : null;
  const events = state.events.filter(
    (e) => !e.voidedAt && dayKey(e.at) === dayKey(at) && (!ids || ids.has(e.entryId)),
  );
  return {
    introductions: [...introducedEntries(state).entries()].filter(
      ([id, time]) => (!ids || ids.has(id)) && dayKey(time) === dayKey(at),
    ).length,
    ...summarize(events),
  };
}
const startOfDay = (at: number) => {
  const d = new Date(at);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
// Local midnight `n` days after the day of `at` (calendar days, so daylight-saving changes
// do not shift it).
export const addDays = (at: number, n: number) => {
  const d = new Date(startOfDay(at));
  d.setDate(d.getDate() + n);
  return d.getTime();
};
// Monday 00:00 of the week containing `at`.
export const weekStart = (at: number) => addDays(at, -((new Date(at).getDay() + 6) % 7));
// How many events (answers, first encounters) each day had, by dayKey; undone ones excluded.
export function dailyCounts(state: AppState): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of state.events)
    if (!e.voidedAt) counts.set(dayKey(e.at), (counts.get(dayKey(e.at)) ?? 0) + 1);
  return counts;
}
// Days in a row with any practice, up to today; if today has none yet, the run up to yesterday
// still counts. `longest` is the longest run ever.
export function streak(state: AppState, at: number) {
  const days = dailyCounts(state);
  let current = 0;
  let day = days.has(dayKey(at)) ? startOfDay(at) : addDays(at, -1);
  while (days.has(dayKey(day))) {
    current++;
    day = addDays(day, -1);
  }
  let longest = 0,
    run = 0,
    previous: number | null = null;
  for (const key of [...days.keys()].sort()) {
    const [y, m, d] = key.split('-').map(Number),
      time = new Date(y, m - 1, d).getTime();
    run = previous !== null && addDays(previous, 1) === time ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = time;
  }
  return { current, longest };
}
// The week containing `at`, or `weeksAgo` weeks before it (Monday to Sunday).
export function weekStats(state: AppState, at: number, weeksAgo = 0) {
  const start = addDays(weekStart(at), -7 * weeksAgo),
    end = addDays(start, 7);
  return summarize(state.events.filter((e) => !e.voidedAt && e.at >= start && e.at < end));
}
// Reviews coming up on each of the next `days` days (the first counts everything already due), for entries that
// are neither paused nor archived.
export function dueForecast(state: AppState, at: number, days = 7) {
  const active = new Set(state.entries.filter((e) => !e.suspended && !e.archived).map((e) => e.id));
  return Array.from({ length: days }, (_, i) => {
    const start = addDays(at, i),
      end = addDays(at, i + 1);
    return {
      at: start,
      count: state.tasks.filter(
        (task) =>
          task.learnedAt &&
          task.card.due < end &&
          (i === 0 || task.card.due >= start) &&
          active.has(task.entryId),
      ).length,
    };
  });
}
// Active entries by stage, with the ones due now counted apart (they are also in their stage); paused and archived
// entries are counted apart too.
export function progressBreakdown(state: AppState, at: number) {
  const counts = { new: 0, seen: 0, learning: 0, mature: 0, paused: 0, archived: 0, due: 0 };
  for (const p of entryProgresses(state, at).values()) {
    if (p.archived) counts.archived++;
    else if (p.paused) counts.paused++;
    else {
      counts[p.stage]++;
      if (p.due) counts.due++;
    }
  }
  return counts;
}

import type {
  LegacyState as AppState,
  LegacyEntry as Entry,
  StoredCard,
  LegacyTask as Task,
  Session,
} from './types';
const obj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const integer = (v: unknown, lo = 0, hi = Number.MAX_SAFE_INTEGER) =>
  num(v) && Number.isInteger(v) && Number(v) >= lo && Number(v) <= hi;
const str = (v: unknown, max = 20_000) => typeof v === 'string' && v.length <= max;
const assert = (v: unknown): void => {
  if (!v) throw new Error('INVALID_FILE');
};
export function validateLegacyEntry(v: unknown): asserts v is Entry {
  assert(obj(v));
  const e = v as Entry;
  for (const k of ['id', 'word', 'ipa', 'pos', 'example', 'source', 'note'] as const)
    assert(str(e[k]));
  assert(e.id.trim() && e.word.trim() && e.word.length <= 500 && ['', 'm', 'f'].includes(e.gender));
  for (const locale of ['zh', 'en'] as const) {
    assert(obj(e[locale]));
    for (const k of ['short', 'detail', 'exampleTranslation', 'irregularNote'] as const)
      assert(str(e[locale][k]));
  }
  assert(e.zh.short.trim() || e.en.short.trim());
  assert(Array.isArray(e.tags) && e.tags.length <= 100 && e.tags.every((t) => str(t, 200)));
  for (const k of ['favorite', 'suspended', 'archived', 'irregular'] as const)
    assert(typeof e[k] === 'boolean');
  assert(
    ['zh', 'en'].includes(e.noteLanguage) &&
      ['sample', 'user', 'imported'].includes(e.sourceStatus),
  );
  assert(integer(e.createdAt) && integer(e.contentVersion, 1));
  if (e.importBatchId !== undefined) assert(str(e.importBatchId));
  if (e.localizedNotes !== undefined) {
    assert(obj(e.localizedNotes));
    for (const key of Object.keys(e.localizedNotes))
      assert(['zh', 'en'].includes(key) && str(e.localizedNotes[key as 'zh' | 'en']));
  }
}
function validateCard(v: unknown): asserts v is StoredCard {
  assert(obj(v));
  const c = v as StoredCard;
  assert(integer(c.due) && c.due < 8.64e15 && integer(c.state, 0, 3));
  for (const key of [
    'stability',
    'difficulty',
    'elapsed_days',
    'scheduled_days',
    'reps',
    'lapses',
    'learning_steps',
  ] as const)
    assert(num(c[key]) && c[key] >= 0);
  assert(c.difficulty <= 10 && integer(c.reps) && integer(c.lapses));
  if (c.last_review !== undefined) assert(integer(c.last_review) && c.last_review < 8.64e15);
}
function validateTask(v: unknown, entryIds: Set<string>): asserts v is Task {
  assert(obj(v));
  const t = v as Task;
  assert(
    str(t.id) && entryIds.has(t.entryId) && ['recognition', 'production'].includes(t.direction),
  );
  assert(
    t.direction === 'recognition'
      ? t.promptLanguage === 'fr'
      : ['zh', 'en'].includes(t.promptLanguage),
  );
  assert(typeof t.enabled === 'boolean');
  if (t.learnedAt !== undefined) assert(integer(t.learnedAt));
  validateCard(t.card);
}
function validateSession(v: unknown, taskIds: Set<string>): asserts v is Session {
  assert(obj(v));
  const s = v as Session;
  assert(
    str(s.id) &&
      ['recognition', 'production'].includes(s.direction) &&
      ['fr', 'zh', 'en'].includes(s.promptLanguage),
  );
  for (const k of ['queue', 'pending', 'skipped'] as const)
    assert(Array.isArray(s[k]) && s[k].every((id) => taskIds.has(id)));
  assert(new Set([...s.queue, ...s.pending]).size === s.queue.length + s.pending.length);
  assert(integer(s.startedAt) && integer(s.completed) && str(s.scope));
}
export function validateLegacyState(v: unknown): AppState {
  assert(obj(v));
  const s = v as unknown as AppState;
  assert(s.schemaVersion === 1 && integer(s.revision));
  for (const k of ['entries', 'tasks', 'events', 'importBatches'] as const)
    assert(Array.isArray(s[k]) && s[k].length <= 100_000);
  s.entries.forEach(validateLegacyEntry);
  const entries = new Set(s.entries.map((e) => e.id));
  assert(entries.size === s.entries.length);
  s.tasks.forEach((t) => validateTask(t, entries));
  const tasks = new Set(s.tasks.map((t) => t.id));
  assert(tasks.size === s.tasks.length);
  assert(obj(s.prefs));
  const p = s.prefs;
  assert(
    ['zhOnly', 'zhEnAssist', 'enOnly'].includes(p.mode) &&
      integer(p.newLimit, 0, 100) &&
      integer(p.sessionLimit, 1, 200),
  );
  assert(
    num(p.retention) &&
      p.retention >= 0.8 &&
      p.retention <= 0.97 &&
      num(p.speechRate) &&
      p.speechRate >= 0.5 &&
      p.speechRate <= 1.5,
  );
  assert(
    ['mac', 'browser'].includes(p.speechEngine) &&
      str(p.voice, 500) &&
      ['recognition', 'production'].includes(p.direction),
  );
  assert(
    Array.isArray(p.swipeMap) &&
      p.swipeMap.length === 4 &&
      new Set(p.swipeMap).size === 4 &&
      p.swipeMap.every((n) => integer(n, 1, 4)),
  );
  if (s.session !== null) validateSession(s.session, tasks);
  const eventIds = new Set<string>();
  for (const e of s.events) {
    assert(obj(e) && str(e.id) && !eventIds.has(e.id));
    eventIds.add(e.id);
    assert(
      tasks.has(e.taskId) &&
        entries.has(e.entryId) &&
        integer(e.at) &&
        ['review', 'exposure'].includes(e.kind),
    );
    assert(e.kind === 'review' ? integer(e.rating, 1, 4) : e.rating === undefined);
    validateTask(e.before, entries);
    validateTask(e.after, entries);
    validateSession(e.sessionBefore, tasks);
    assert(
      e.before.id === e.taskId &&
        e.after.id === e.taskId &&
        e.before.entryId === e.entryId &&
        e.after.entryId === e.entryId,
    );
    assert(
      ['zh', 'en'].includes(e.explanationLocale) &&
        integer(e.contentVersion, 1) &&
        str(e.schedulerVersion) &&
        num(e.durationMs) &&
        e.durationMs >= 0 &&
        typeof e.assisted === 'boolean',
    );
    if (e.voidedAt !== undefined) assert(integer(e.voidedAt));
    if (e.schedulerParameters !== undefined) {
      const p = e.schedulerParameters;
      assert(
        obj(p) &&
          num(p.request_retention) &&
          p.request_retention >= 0.8 &&
          p.request_retention <= 0.97 &&
          integer(p.maximum_interval, 1),
      );
      assert(
        Array.isArray(p.w) &&
          p.w.length === 21 &&
          p.w.every(num) &&
          typeof p.enable_fuzz === 'boolean' &&
          typeof p.enable_short_term === 'boolean',
      );
      assert(
        Array.isArray(p.learning_steps) &&
          Array.isArray(p.relearning_steps) &&
          [...p.learning_steps, ...p.relearning_steps].every(
            (step) => typeof step === 'string' && /^\d+(\.\d+)?[smhd]$/.test(step),
          ),
      );
    }
  }
  for (const b of s.importBatches)
    assert(
      obj(b) &&
        str(b.id) &&
        integer(b.at) &&
        Array.isArray(b.entryIds) &&
        b.entryIds.every((id) => entries.has(id)),
    );
  return structuredClone(s);
}

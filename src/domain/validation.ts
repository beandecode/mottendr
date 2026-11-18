import type {
  AppState,
  Entry,
  LearningEvent,
  Preferences,
  StoredCard,
  Task,
  Session,
} from './types';
import type { StateChanges } from './changes';
import Ajv2020 from 'ajv/dist/2020';
import { EntrySchema } from './entry-schema';
import { validateIssue, validateLogRecord, validateReviewItem } from './user-layer';
export const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
export const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
export const integer = (v: unknown, lo = 0, hi = Number.MAX_SAFE_INTEGER) =>
  finite(v) && Number.isInteger(v) && Number(v) >= lo && Number(v) <= hi;
export const string = (v: unknown, max = 20_000) => typeof v === 'string' && v.length <= max;
export const assert: (v: unknown) => asserts v = (v: unknown) => {
  if (!v) throw new Error('INVALID_FILE');
};
const list = (v: unknown, max = 1000): v is unknown[] => Array.isArray(v) && v.length <= max;
const url = (v: unknown) =>
  typeof v === 'string' &&
  (v === '' ||
    (/^https?:\/\//i.test(v) &&
      (() => {
        try {
          new URL(v);
          return true;
        } catch {
          return false;
        }
      })()));
// Structure (types, allowed values, lengths, non-blank text) comes from entry-schema.ts;
// the rules below are the ones a schema cannot express.
const checkEntryShape = new Ajv2020({ strict: false }).compile(EntrySchema);
export function validateEntry(v: unknown): asserts v is Entry {
  assert(checkEntryShape(v));
  const e = v as Entry;
  // IDs are unique across all parts of the entry.
  const ids = new Set<string>(),
    senseIds = new Set<string>();
  const id = (s: string) => {
    assert(!ids.has(s));
    ids.add(s);
  };
  for (const g of e.groups) {
    id(g.id);
    for (const s of g.senses) {
      id(s.id);
      senseIds.add(s.id);
      assert(s.definitions.zh.short.trim() || s.definitions.en.short.trim());
      s.examples.forEach((x) => id(x.id));
      s.collocations.forEach((x) => id(x.id));
    }
    g.forms.forEach((f) => id(f.id));
    if (g.verb === undefined) continue;
    assert(g.pos === 'verb');
    const slots = new Set<string>();
    for (const t of g.verb.conjugations) {
      id(t.id);
      const slot = `${t.mood}:${t.tense}`;
      assert(!slots.has(slot) && url(t.source));
      slots.add(slot);
      assert(t.status === 'provided' ? t.rows.length > 0 : t.rows.length === 0);
      const persons = new Set<string>();
      for (const r of t.rows) {
        assert(!persons.has(r.person));
        persons.add(r.person);
      }
      if (t.status === 'provided') {
        const required =
          t.mood === 'imperative'
            ? ['2s', '1p', '2p']
            : ['infinitive', 'participle', 'gerund'].includes(t.mood)
              ? ['none']
              : ['1s', '2s', '3s', '1p', '2p', '3p'];
        // A defective verb lists only the persons that exist.
        assert(
          g.features.includes('defective')
            ? t.rows.every((r) => required.includes(r.person))
            : required.length === t.rows.length && required.every((p) => persons.has(p)),
        );
      }
    }
  }
  if (e.kind === 'pronominal') assert(e.groups.some((g) => g.pos === 'verb'));
  const senses = e.groups.flatMap((g) => g.senses);
  for (const s of senses)
    if (s.derivedFromSenseId !== undefined)
      assert(senseIds.has(s.derivedFromSenseId) && s.derivedFromSenseId !== s.id);
  // Reject derivation cycles; a meaning cannot ultimately derive from itself.
  for (const s of senses) {
    const seen = new Set<string>();
    let current = s;
    while (current.derivedFromSenseId) {
      assert(!seen.has(current.id));
      seen.add(current.id);
      current = senses.find((x) => x.id === current.derivedFromSenseId)!;
    }
  }
  const links = new Set<string>();
  for (const r of e.relations) {
    id(r.id);
    const key = `${r.type}:${r.targetId}`;
    assert(!links.has(key) && r.targetId !== e.id);
    links.add(key);
  }
  assert(e.relations.filter((r) => r.type === 'pronominal-of').length <= 1);
  if (e.kind === 'lexical') assert(!e.relations.some((r) => r.type === 'pronominal-of'));
  const families = new Set<string>();
  for (const f of e.families) {
    assert(!families.has(f.key));
    families.add(f.key);
  }
  for (const s of e.sources) assert(url(s.url));
  const shown = e.cardDisplay?.senseIds;
  if (shown) assert(new Set(shown).size === shown.length && shown.every((id) => senseIds.has(id)));
}
export function validateLinks(entries: Entry[]) {
  entries.forEach(validateEntry);
  checkLinks(entries, new Map(entries.map((e) => [e.id, e])));
}
function checkLinks(entries: Entry[], map: Map<string, Entry>) {
  for (const e of entries)
    for (const r of e.relations) {
      const target = map.get(r.targetId);
      assert(target);
      if (r.type === 'pronominal-of')
        assert(
          e.kind === 'pronominal' &&
            e.groups.some((g) => g.pos === 'verb') &&
            target!.kind === 'lexical' &&
            target!.groups.some((g) => g.pos === 'verb'),
        );
    }
  const done = new Set<string>(),
    active = new Set<string>();
  const visit = (id: string) => {
    if (done.has(id)) return;
    assert(!active.has(id));
    active.add(id);
    for (const r of map.get(id)!.relations) if (r.type === 'derived-from') visit(r.targetId);
    active.delete(id);
    done.add(id);
  };
  for (const e of entries) visit(e.id);
}
function validateCard(v: unknown): asserts v is StoredCard {
  assert(object(v));
  const c = v as unknown as StoredCard;
  assert(integer(c.due) && c.due < 8.64e15 && integer(c.state, 0, 3));
  for (const k of [
    'stability',
    'difficulty',
    'elapsed_days',
    'scheduled_days',
    'reps',
    'lapses',
    'learning_steps',
  ] as const)
    assert(finite(c[k]) && c[k] >= 0);
  assert(c.difficulty <= 10 && integer(c.reps) && integer(c.lapses));
  if (c.last_review !== undefined) assert(integer(c.last_review) && c.last_review < 8.64e15);
}
function validateTask(v: unknown, entries: Map<string, Entry>): asserts v is Task {
  assert(object(v));
  const t = v as unknown as Task;
  assert(
    string(t.id) &&
      entries.has(t.entryId) &&
      ['recognition', 'production'].includes(t.direction) &&
      (t.direction === 'recognition'
        ? t.promptLanguage === 'fr'
        : ['zh', 'en'].includes(t.promptLanguage)) &&
      typeof t.enabled === 'boolean',
  );
  if (t.learnedAt !== undefined) assert(integer(t.learnedAt));
  validateCard(t.card);
  assert(object(t.target));
  const e = entries.get(t.entryId)!;
  if (t.target.kind === 'sense') {
    const target = t.target;
    assert(e.groups.flatMap((g) => g.senses).some((s) => s.id === target.senseId));
  } else if (t.target.kind === 'conjugation') {
    const target = t.target;
    assert(
      e.groups.some((g) => g.id === target.groupId && g.pos === 'verb') &&
        string(target.tense) &&
        [
          'indicative',
          'conditional',
          'subjunctive',
          'imperative',
          'infinitive',
          'participle',
          'gerund',
        ].includes(target.mood),
    );
    if (target.person !== undefined)
      assert(['1s', '2s', '3s', '1p', '2p', '3p', 'none'].includes(target.person));
  } else assert(t.target.kind === 'entry');
}
function validateSession(v: unknown, ids: Set<string>): asserts v is Session {
  assert(object(v));
  const s = v as unknown as Session;
  assert(
    string(s.id) &&
      ['recognition', 'production'].includes(s.direction) &&
      ['fr', 'zh', 'en'].includes(s.promptLanguage),
  );
  for (const k of ['queue', 'pending', 'skipped'] as const)
    assert(list(s[k], 100_000) && s[k].every((id) => ids.has(id)));
  assert(
    new Set([...s.queue, ...s.pending]).size === s.queue.length + s.pending.length &&
      integer(s.startedAt) &&
      integer(s.completed) &&
      string(s.scope),
  );
}
function validatePrefs(p: Preferences) {
  assert(object(p));
  assert(
    ['zhOnly', 'zhEnAssist', 'enOnly'].includes(p.mode) &&
      integer(p.newLimit, 0, 100) &&
      integer(p.sessionLimit, 1, 200) &&
      finite(p.retention) &&
      p.retention >= 0.8 &&
      p.retention <= 0.97 &&
      finite(p.speechRate) &&
      p.speechRate >= 0.5 &&
      p.speechRate <= 1.5 &&
      ['mac', 'browser'].includes(p.speechEngine) &&
      string(p.voice, 500) &&
      ['recognition', 'production'].includes(p.direction) &&
      list(p.swipeMap, 4) &&
      p.swipeMap.length === 4 &&
      new Set(p.swipeMap).size === 4 &&
      p.swipeMap.every((n) => integer(n, 1, 4)),
  );
  assert(
    p.fontScale === undefined || (finite(p.fontScale) && p.fontScale >= 0.85 && p.fontScale <= 1.5),
  );
  assert(
    p.typographyVersion === undefined || p.typographyVersion === 2 || p.typographyVersion === 3,
  );
  assert(p.continuousLearning === undefined || typeof p.continuousLearning === 'boolean');
  assert(p.newWordOrder === undefined || ['list', 'frequency', 'shuffle'].includes(p.newWordOrder));
  for (const key of ['activeTaskLimit', 'refillLimit'] as const)
    assert(p[key] === undefined || integer(p[key], 1, 200));
  for (const key of [
    'showGender',
    'showArticles',
    'shuffleNewWords',
    'autoSpeakQuestion',
    'autoSpeakRecognitionAnswer',
    'autoSpeakProductionAnswer',
    'swipeEnabled',
    'gridEnabled',
    'buttonsEnabled',
  ] as const)
    assert(p[key] === undefined || typeof p[key] === 'boolean');
  assert(!(p.swipeEnabled === false && p.gridEnabled === false && p.buttonsEnabled === false));
}
function validateEvent(e: LearningEvent, entries: Map<string, Entry>, taskIds: Set<string>) {
  assert(object(e) && string(e.id));
  assert(
    taskIds.has(e.taskId) &&
      entries.has(e.entryId) &&
      integer(e.at) &&
      ['review', 'exposure'].includes(e.kind),
  );
  assert(e.kind === 'review' ? integer(e.rating, 1, 4) : e.rating === undefined);
  validateTask(e.before, entries);
  validateTask(e.after, entries);
  validateSession(e.sessionBefore, taskIds);
  assert(
    e.before.id === e.taskId &&
      e.after.id === e.taskId &&
      e.before.entryId === e.entryId &&
      e.after.entryId === e.entryId &&
      ['zh', 'en'].includes(e.explanationLocale) &&
      integer(e.contentVersion, 1) &&
      string(e.schedulerVersion) &&
      finite(e.durationMs) &&
      e.durationMs >= 0 &&
      typeof e.assisted === 'boolean',
  );
  if (e.voidedAt !== undefined) assert(integer(e.voidedAt));
  if (e.schedulerParameters !== undefined) {
    const p = e.schedulerParameters;
    assert(
      object(p) &&
        finite(p.request_retention) &&
        p.request_retention >= 0.8 &&
        p.request_retention <= 0.97 &&
        integer(p.maximum_interval, 1) &&
        list(p.w, 21) &&
        p.w.length === 21 &&
        p.w.every(finite) &&
        typeof p.enable_fuzz === 'boolean' &&
        typeof p.enable_short_term === 'boolean' &&
        list(p.learning_steps) &&
        list(p.relearning_steps) &&
        [...p.learning_steps, ...p.relearning_steps].every(
          (step) => typeof step === 'string' && /^\d+(\.\d+)?[smhd]$/.test(step),
        ),
    );
  }
}
function validateImportBatches(s: AppState, entries: Map<string, Entry>) {
  for (const b of s.importBatches)
    assert(
      object(b) &&
        string(b.id) &&
        integer(b.at) &&
        list(b.entryIds, 100_000) &&
        b.entryIds.every((id) => entries.has(id)),
    );
}
function validateInstalledCollections(s: AppState, taskIds: Set<string>) {
  if (s.installedCollections === undefined) return;
  assert(list(s.installedCollections, 100));
  const installed = new Set<string>();
  for (const c of s.installedCollections) {
    assert(
      object(c) &&
        string(c.id, 500) &&
        c.id.trim() &&
        !installed.has(c.id) &&
        integer(c.version, 1) &&
        integer(c.at),
    );
    installed.add(c.id);
    if (c.previousSession !== null) validateSession(c.previousSession, taskIds);
  }
}
function validateContentReview(s: AppState, entries: Map<string, Entry>) {
  if (s.contentReview === undefined) return;
  assert(list(s.contentReview, 100_000));
  for (const item of s.contentReview) {
    validateReviewItem(item);
    assert(entries.has(item.entryId));
  }
}
function validateIssues(s: AppState, entries: Map<string, Entry>, indexes?: number[]) {
  if (s.issues === undefined) return;
  assert(list(s.issues, 100_000));
  for (const i of indexes ?? s.issues.keys()) {
    validateIssue(s.issues[i]);
    assert(entries.has(s.issues[i].entryId));
  }
  if (!indexes || indexes.length)
    assert(new Set(s.issues.map((x) => x.id)).size === s.issues.length);
}
function validateContentLog(s: AppState, entries: Map<string, Entry>, indexes?: number[]) {
  if (s.contentLog === undefined) return;
  assert(list(s.contentLog, 100_000));
  for (const i of indexes ?? s.contentLog.keys()) {
    validateLogRecord(s.contentLog[i]);
    assert(entries.has(s.contentLog[i].entryId));
  }
}
function assertStateV2(v: unknown): asserts v is AppState {
  assert(object(v));
  const s = v as unknown as AppState;
  assert(s.schemaVersion === 2 && integer(s.revision));
  for (const k of ['entries', 'tasks', 'events', 'importBatches'] as const)
    assert(list(s[k], 100_000));
  s.entries.forEach(validateEntry);
  const entries = new Map(s.entries.map((e) => [e.id, e]));
  assert(entries.size === s.entries.length);
  checkLinks(s.entries, entries);
  s.tasks.forEach((t) => validateTask(t, entries));
  const taskIds = new Set(s.tasks.map((t) => t.id));
  assert(taskIds.size === s.tasks.length);
  validatePrefs(s.prefs);
  if (s.session !== null) validateSession(s.session, taskIds);
  const eventIds = new Set<string>();
  for (const e of s.events) {
    validateEvent(e, entries, taskIds);
    assert(!eventIds.has(e.id));
    eventIds.add(e.id);
  }
  validateImportBatches(s, entries);
  validateInstalledCollections(s, taskIds);
  validateContentReview(s, entries);
  validateIssues(s, entries);
  validateContentLog(s, entries);
}
export function validateStateV2(v: unknown): AppState {
  assertStateV2(v);
  return structuredClone(v);
}
// Validates only what a mutation changed; the rest was validated when it was written.
// Reordered or shortened lists fall back to validating the whole state.
export function validateChanges(before: AppState, after: AppState, changes: StateChanges) {
  if (
    changes.entries.rewrite ||
    changes.tasks.rewrite ||
    changes.events.rewrite ||
    changes.issues.rewrite ||
    changes.contentLog.rewrite
  ) {
    assertStateV2(after);
    return;
  }
  assert(after.schemaVersion === 2 && integer(after.revision));
  for (const k of ['entries', 'tasks', 'events', 'importBatches'] as const)
    assert(list(after[k], 100_000));
  const entries = new Map(after.entries.map((e) => [e.id, e]));
  const changedEntries = new Set<string>();
  if (changes.entries.indexes.length) {
    for (const i of changes.entries.indexes) {
      validateEntry(after.entries[i]);
      changedEntries.add(after.entries[i].id);
    }
    assert(entries.size === after.entries.length);
    checkLinks(after.entries, entries);
  }
  const taskIds = new Set(after.tasks.map((t) => t.id));
  if (changes.tasks.indexes.length) assert(taskIds.size === after.tasks.length);
  const changedTasks = new Set(changes.tasks.indexes);
  after.tasks.forEach((t, i) => {
    // A task also depends on its entry (sense and conjugation targets).
    if (changedTasks.has(i) || changedEntries.has(t.entryId)) validateTask(t, entries);
  });
  if (after.prefs !== before.prefs) validatePrefs(after.prefs);
  if (after.session !== null && (after.session !== before.session || changes.tasks.indexes.length))
    validateSession(after.session, taskIds);
  if (changes.events.indexes.length) {
    for (const i of changes.events.indexes) validateEvent(after.events[i], entries, taskIds);
    assert(new Set(after.events.map((e) => e.id)).size === after.events.length);
  }
  if (after.importBatches !== before.importBatches || changes.entries.indexes.length)
    validateImportBatches(after, entries);
  if (after.installedCollections !== before.installedCollections || changes.tasks.indexes.length)
    validateInstalledCollections(after, taskIds);
  if (after.contentReview !== before.contentReview) validateContentReview(after, entries);
  if (changes.issues.indexes.length) validateIssues(after, entries, changes.issues.indexes);
  if (changes.contentLog.indexes.length)
    validateContentLog(after, entries, changes.contentLog.indexes);
}

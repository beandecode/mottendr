import type { Entry, LearningEvent, Session, Task } from '../src/domain/types';
import { migrateState } from '../src/domain/migration';
import { validateBackupShape } from '../src/domain/user-layer';
import { ensureTasks } from '../src/domain/learning';

// The reference for the native app's `Migration.importProgress` (N7): what the first release of the native
// app takes from a PWA backup. It lives in the tests, not in src/, so the PWA stays untouched. The native app
// carries a smaller word pack than the PWA, and the learner's own content stays behind, so the backup is cut
// down to progress that still has a place: the built-in entries of the pack, their tasks and events, the markers
// (favorite, paused, archived), notes, own tags and card choices, and the preferences.
//
// Takes: schema 3 backups made against a pack that is not newer than the app's.
// Drops (and counts): content patches, own entries (`dict:` ones apart), retired entries, entries the pack does not
// have, issues, the content log, review items, import batches and the open session; tasks whose entry or target
// is gone, events of dropped tasks. Pack entries the backup lacks are added as new words (`addMissing`).

export interface ProgressReport {
  entries: {
    kept: number;
    droppedDict: number;
    droppedOwn: number;
    droppedRetired: number;
    droppedMissing: number;
    added: number;
  };
  tasks: { kept: number; droppedEntry: number; droppedTarget: number };
  events: { kept: number; dropped: number; sessionsRewritten: number };
  annotations: { kept: number; dropped: number };
  dropped: {
    patchedEntries: number;
    issues: number;
    contentLog: number;
    contentReview: number;
    importBatches: number;
    session: boolean;
  };
}

type Layer = {
  meta: Record<string, unknown>;
  entryOrder: string[];
  tasks: Task[];
  events: LearningEvent[];
  contentPatches: { id: string }[];
  annotations: { id: string }[];
  userEntries: Entry[];
  issues?: unknown[];
  contentLog?: unknown[];
};

const targetResolves = (task: Task, entry: Entry) => {
  const t = task.target;
  if (t.kind === 'sense') return entry.groups.some((g) => g.senses.some((s) => s.id === t.senseId));
  if (t.kind === 'conjugation')
    return entry.groups.some((g) => g.id === t.groupId && g.pos === 'verb');
  return true;
};

export function importProgressReference(
  backup: unknown,
  pack: ReadonlyMap<string, Entry>,
  retiredIds: ReadonlySet<string>,
  packVersion: number,
  at: number,
  addMissing = true,
) {
  validateBackupShape(backup);
  const value = structuredClone(backup) as unknown as Layer & {
    schemaVersion: number;
    packVersion: number;
  };
  if (value.schemaVersion !== 3) throw new Error('UNSUPPORTED_VERSION');
  if (value.packVersion > packVersion) throw new Error('PACK_TOO_NEW');

  const own = new Map(value.userEntries.map((e) => [e.id, e]));
  const kept: string[] = [];
  const entries = {
    kept: 0,
    droppedDict: 0,
    droppedOwn: 0,
    droppedRetired: 0,
    droppedMissing: 0,
    added: 0,
  };
  for (const id of value.entryOrder) {
    if (own.has(id)) {
      if (id.startsWith('dict:')) entries.droppedDict++;
      else if (retiredIds.has(id)) entries.droppedRetired++;
      else entries.droppedOwn++;
    } else if (pack.has(id)) kept.push(id);
    else if (retiredIds.has(id)) entries.droppedRetired++;
    else entries.droppedMissing++;
  }
  entries.kept = kept.length;
  const keptSet = new Set(kept);

  const notes = value.annotations.filter((a) => keptSet.has(a.id));
  const tasks = { kept: 0, droppedEntry: 0, droppedTarget: 0 };
  const keptTasks: Task[] = [];
  for (const task of value.tasks) {
    if (!keptSet.has(task.entryId)) tasks.droppedEntry++;
    else if (!targetResolves(task, pack.get(task.entryId)!)) tasks.droppedTarget++;
    else keptTasks.push(task);
  }
  tasks.kept = keptTasks.length;
  const taskIds = new Set(keptTasks.map((t) => t.id));

  const events = { kept: 0, dropped: 0, sessionsRewritten: 0 };
  const keptEvents: LearningEvent[] = [];
  for (const event of value.events) {
    if (!taskIds.has(event.taskId)) {
      events.dropped++;
      continue;
    }
    // The session as it was before the answer names tasks; the dropped ones are taken out of it.
    const session = event.sessionBefore as Session | null;
    if (session) {
      let changed = false;
      for (const key of ['queue', 'pending', 'skipped'] as const) {
        const next = session[key].filter((id) => taskIds.has(id));
        if (next.length !== session[key].length) changed = true;
        session[key] = next;
      }
      if (changed) events.sessionsRewritten++;
    }
    keptEvents.push(event);
  }
  events.kept = keptEvents.length;

  const meta = value.meta as Record<string, unknown> & {
    contentReview?: unknown[];
    importBatches?: unknown[];
    session?: unknown;
  };
  const dropped = {
    patchedEntries: value.contentPatches.filter((d) => keptSet.has(d.id)).length,
    issues: value.issues?.length ?? 0,
    contentLog: value.contentLog?.length ?? 0,
    contentReview: meta.contentReview?.length ?? 0,
    importBatches: meta.importBatches?.length ?? 0,
    session: Boolean(meta.session),
  };
  meta.session = null;
  meta.importBatches = [];
  delete meta.contentReview;
  meta.installedCollections = [
    { id: 'word-list', version: packVersion, at, previousSession: null },
  ];

  const next = {
    schemaVersion: 3,
    packVersion,
    meta,
    entryOrder: kept,
    tasks: keptTasks,
    events: keptEvents,
    contentPatches: [],
    annotations: notes,
    userEntries: [],
    issues: [],
    contentLog: [],
  };
  const state = migrateState(next);

  const annotations = { kept: notes.length, dropped: value.annotations.length - notes.length };
  if (addMissing) {
    // Pack entries the backup never had arrive as new words, in pack order, with the tasks a fresh install makes.
    const have = new Set(state.entries.map((e) => e.id));
    for (const [id, entry] of pack)
      if (!have.has(id)) {
        state.entries.push(structuredClone(entry) as Entry);
        entries.added++;
      }
    ensureTasks(state, state.prefs.direction, at);
  }
  const report: ProgressReport = { entries, tasks, events, annotations, dropped };
  return { state, report };
}

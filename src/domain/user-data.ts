import type { AppState, Entry, LearningEvent, Task } from './types';
import { reviewPatches, resolveEntry, setAtPath, splitEntry } from './layers';
import { newId } from './id';
import { packVersion, retiredContent } from './pack';
import {
  validateAnnotation,
  validateBackupShape,
  validatePatchDoc,
  type Annotation,
  type ContentPatchDoc,
  type Issue,
  type ContentLogRecord,
} from './user-layer';

// Everything the learner owns. Built-in entries appear only as differences from the pack.
export type Meta = Omit<AppState, 'entries' | 'tasks' | 'events' | 'issues' | 'contentLog'>;
export interface UserLayer {
  meta: Meta;
  entryOrder: string[];
  tasks: Task[];
  events: LearningEvent[];
  contentPatches: ContentPatchDoc[];
  annotations: Annotation[];
  userEntries: Entry[];
  issues: Issue[];
  contentLog: ContentLogRecord[];
}
export const metaOf = ({
  entries: _e,
  tasks: _t,
  events: _v,
  issues: _i,
  contentLog: _l,
  ...meta
}: AppState): Meta => meta;

type Retired = ReturnType<typeof retiredContent>;
// Retired sense ids in stored references move to their first replacement.
function remapSenses(layer: UserLayer, senses: Retired['senses']): boolean {
  const next = (id: string) => senses[id]?.[0];
  let moved = false;
  for (const doc of layer.contentPatches)
    for (const patch of doc.patches)
      patch.path = patch.path.map((segment) => {
        if (typeof segment === 'string' || !next(segment.id)) return segment;
        moved = true;
        return { id: next(segment.id)! };
      });
  for (const note of layer.annotations) {
    const ids = note.cardDisplay?.senseIds;
    if (ids?.some(next)) {
      note.cardDisplay!.senseIds = ids.map((id) => next(id) ?? id);
      moved = true;
    }
  }
  for (const issue of layer.issues)
    if (issue.senseId && next(issue.senseId)) {
      issue.senseId = next(issue.senseId);
      moved = true;
    }
  return moved;
}

// Builds the state the app works with. Edits written against an older pack are compared
// with the current one: conflicts become contentReview items, and `stale` asks the caller
// to rewrite the layer so every edit is based on the current pack again. A retired
// built-in entry is resolved from its last content and becomes the learner's own entry.
export function assembleLayer(
  layer: UserLayer,
  pack: ReadonlyMap<string, Entry>,
  at = Date.now(),
  retired: Retired = retiredContent(),
): { state: AppState; stale: boolean } {
  layer.contentPatches.forEach(validatePatchDoc);
  layer.annotations.forEach(validateAnnotation);
  let stale = remapSenses(layer, retired.senses);
  const own = new Map(layer.userEntries.map((e) => [e.id, e])),
    docs = new Map(layer.contentPatches.map((d) => [d.id, d])),
    notes = new Map(layer.annotations.map((a) => [a.id, a]));
  const review = [...(layer.meta.contentReview ?? [])];
  const entries = layer.entryOrder.map((id) => {
    const mine = own.get(id);
    if (mine) return mine;
    const gone = pack.has(id) ? undefined : retired.entries[id];
    const builtIn = pack.get(id) ?? gone?.entry;
    if (!builtIn) throw new Error('MISSING_BUILTIN_ENTRY');
    if (gone) {
      stale = true;
      review.push({
        id: newId(),
        entryId: id,
        word: builtIn.word,
        kind: 'retired',
        path: [],
        pack: gone.replacedBy,
        at,
      });
    }
    const doc = docs.get(id);
    const { entry } = resolveEntry(builtIn, doc, notes.get(id));
    if (doc && !gone) {
      const result = reviewPatches(builtIn, doc);
      stale ||= result.stale;
      for (const item of result.items)
        review.push({ ...item, id: newId(), entryId: id, word: entry.word, at });
    }
    return entry === builtIn ? structuredClone(builtIn) : entry;
  });
  const state = { ...layer.meta, entries, tasks: layer.tasks, events: layer.events } as AppState;
  if (review.length) state.contentReview = review;
  if (layer.issues.length) state.issues = layer.issues;
  if (layer.contentLog.length) state.contentLog = layer.contentLog;
  return { state, stale };
}

export function layerOf(state: AppState, pack: ReadonlyMap<string, Entry>): UserLayer {
  const layer: UserLayer = {
    meta: metaOf(state),
    entryOrder: state.entries.map((e) => e.id),
    tasks: state.tasks,
    events: state.events,
    contentPatches: [],
    annotations: [],
    userEntries: [],
    issues: state.issues ?? [],
    contentLog: state.contentLog ?? [],
  };
  for (const entry of state.entries) {
    const builtIn = pack.get(entry.id);
    if (!builtIn) {
      layer.userEntries.push(entry);
      continue;
    }
    const { doc, annotation } = splitEntry(builtIn, entry);
    if (doc) layer.contentPatches.push(doc);
    if (annotation) layer.annotations.push(annotation);
  }
  return layer;
}

export const backupOf = (state: AppState, pack: ReadonlyMap<string, Entry>) => ({
  schemaVersion: 3 as const,
  packVersion: packVersion(),
  ...layerOf(state, pack),
});

// The result still goes through the full state validation in migrateState.
export function stateFromBackup(value: unknown, pack: ReadonlyMap<string, Entry>): AppState {
  validateBackupShape(value);
  const { schemaVersion: _s, packVersion: _p, ...layer } = structuredClone(value);
  return assembleLayer({ issues: [], contentLog: [], ...layer } as unknown as UserLayer, pack)
    .state;
}

// "Use the pack's": put the current built-in value back. "Keep mine" (or, for a removed
// target, "noted"): the edit stays as it is. Either way the item is closed.
export function resolveReview(state: AppState, itemId: string, choice: 'pack' | 'mine') {
  const item = state.contentReview?.find((i) => i.id === itemId);
  if (!item) return;
  if (choice === 'pack' && item.kind === 'changed') {
    const entry = state.entries.find((e) => e.id === item.entryId);
    if (entry) setAtPath(entry, item.path, item.pack);
  }
  state.contentReview = state.contentReview!.filter((i) => i.id !== itemId);
  if (!state.contentReview.length) delete state.contentReview;
}

import type { AppState } from './types';
import type { ContentLogRecord } from './user-layer';
import { applyPatches, canRevert, diffContent, inversePatches } from './layers';
import { ensureTasks } from './learning';
import { newId } from './id';
import { snapshot } from './draft';

// Content changes made by one operation, as log records. New, removed or reordered
// entries are not logged (imports and restores); entries the operation logged itself
// (an undo) are skipped.
export function journal(before: AppState, after: AppState, at = Date.now()): ContentLogRecord[] {
  if (before.entries === after.entries || after.entries.length < before.entries.length) return [];
  const logged = new Set(
    (after.contentLog ?? []).slice(before.contentLog?.length ?? 0).map((r) => r.entryId),
  );
  const records: ContentLogRecord[] = [];
  before.entries.forEach((old, i) => {
    const next = after.entries[i];
    if (next === old || next.id !== old.id || logged.has(next.id)) return;
    const changes = diffContent(old, next);
    if (changes.length)
      records.push({ id: newId(), entryId: next.id, word: next.word, at, kind: 'edit', changes });
  });
  return records;
}

export const entryLog = (state: Pick<AppState, 'contentLog'>, entryId: string) =>
  (state.contentLog ?? []).filter((r) => r.entryId === entryId);

// Only the latest change of an entry can be undone, and only while it is still in place.
export function undoable(state: AppState, entryId: string) {
  const record = entryLog(state, entryId).at(-1);
  const entry = state.entries.find((e) => e.id === entryId);
  return record && !record.undoneBy && entry && canRevert(entry, record.changes)
    ? record
    : undefined;
}

export function undoContentChange(state: AppState, recordId: string, at = Date.now()) {
  const record = state.contentLog?.find((r) => r.id === recordId);
  const entry = state.entries.find((e) => e.id === record?.entryId);
  if (!record || !entry || record.undoneBy || !canRevert(entry, record.changes))
    throw new Error('CANNOT_UNDO');
  // The record is part of the draft; copy its patches out before reusing their values.
  const changes = inversePatches(snapshot(record.changes));
  if (!applyPatches(entry, changes)) throw new Error('CANNOT_UNDO');
  entry.contentVersion++;
  entry.updatedAt = at;
  const undo: ContentLogRecord = {
    id: newId(),
    entryId: entry.id,
    word: entry.word,
    at,
    kind: 'undo',
    changes,
    undoOf: record.id,
  };
  record.undoneBy = undo.id;
  state.contentLog!.push(undo);
  // Restored senses may make the entry learnable again in the current language.
  ensureTasks(state, 'recognition', at);
}

import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { freshLearningState } from '../src/domain/builtin';
import { packEntries } from '../src/domain/pack';
import { applyOperation } from '../src/domain/mutation';
import { snapshot } from '../src/domain/draft';
import { entryLog, undoable, undoContentChange } from '../src/domain/content-log';
import { migrateState } from '../src/domain/migration';
import { backupOf } from '../src/domain/user-data';
import { IndexedDbStorage } from '../src/platform/storage';
import type { AppState, Entry } from '../src/domain/types';

const at = new Date('2026-10-15T10:00:00Z').getTime();
const base = freshLearningState(at);
const index = base.entries.findIndex(
  (e) => e.word === 'apprendre' && e.groups[0].senses[0].examples.length,
);
const id = base.entries[index].id;
// What undo must restore: content, not the edit metadata.
const content = ({ contentVersion: _c, updatedAt: _u, ...rest }: Entry) => rest;
const run = (s: AppState, op: (d: AppState) => unknown) => applyOperation(s, op, at)!.next;
const editShort = (s: AppState, value: string) =>
  run(s, (d) => {
    d.entries[index].groups[0].senses[0].definitions.zh.short = value;
    d.entries[index].contentVersion++;
  });

describe('content log', () => {
  it('records content changes, not personal data or new entries', () => {
    let s = editShort(base, '学；学会');
    expect(entryLog(s, id)).toEqual([
      expect.objectContaining({ kind: 'edit', word: 'apprendre', changes: [expect.anything()] }),
    ]);
    s = run(s, (d) => void (d.entries[index].favorite = true));
    s = run(s, (d) => void d.entries.push({ ...snapshot(d.entries[0]), id: 'own-1' }));
    expect(s.contentLog).toHaveLength(1);
  });
  it('undoes the latest edit exactly, records the undo, and can undo the undo', () => {
    const edited = editShort(base, '学；学会');
    const record = undoable(edited, id)!;
    const undone = run(edited, (d) => undoContentChange(d, record.id, at));
    expect(content(undone.entries[index])).toEqual(content(base.entries[index]));
    expect(undone.contentLog).toEqual([
      expect.objectContaining({ id: record.id, undoneBy: expect.any(String) }),
      expect.objectContaining({ kind: 'undo', undoOf: record.id }),
    ]);
    const redone = run(undone, (d) => undoContentChange(d, undoable(undone, id)!.id, at));
    expect(content(redone.entries[index])).toEqual(content(edited.entries[index]));
  });
  it('puts a removed example back in its place', () => {
    const before = run(base, (d) => {
      const senses = d.entries[index].groups[0].senses;
      senses[0].examples.push({ ...snapshot(senses[0].examples[0]), id: 'ex-2' });
    });
    const removed = run(before, (d) => void d.entries[index].groups[0].senses[0].examples.shift());
    const undone = run(removed, (d) => undoContentChange(d, undoable(removed, id)!.id, at));
    expect(undone.entries[index].groups[0].senses[0].examples.map((e) => e.id)).toEqual(
      before.entries[index].groups[0].senses[0].examples.map((e) => e.id),
    );
  });
  it('only offers the latest change, and only while it is still in place', () => {
    const first = editShort(base, 'A');
    const second = editShort(first, 'B');
    expect(undoable(second, id)!.id).toBe(second.contentLog![1].id);
    expect(() => run(second, (d) => undoContentChange(d, second.contentLog![0].id, at))).toThrow(
      'CANNOT_UNDO',
    );
  });
});

describe('storing and backing up the content log', () => {
  it('keeps the log across reloads and in backups', async () => {
    const name = `log-${crypto.randomUUID()}`,
      db = new IndexedDbStorage(name);
    const saved = await db.save(structuredClone(base), null);
    const r = applyOperation(saved, (d) => {
      d.entries[index].groups[0].senses[0].definitions.zh.short = '学；学会';
    })!;
    expect(r.changes.contentLog.indexes).toEqual([0]);
    const stored = await db.save(r.next, saved.revision, r.changes);
    expect(await new IndexedDbStorage(name).read()).toEqual(stored);
    const backup = JSON.parse(JSON.stringify(backupOf(stored, packEntries())));
    expect(migrateState(backup).contentLog).toEqual(stored.contentLog);
  });
});

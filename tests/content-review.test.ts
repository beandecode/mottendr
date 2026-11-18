import { describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { freshLearningState } from '../src/domain/builtin';
import { packEntries } from '../src/domain/pack';
import { reviewPatches, splitEntry } from '../src/domain/layers';
import { applyOperation } from '../src/domain/mutation';
import { migrateState } from '../src/domain/migration';
import { backupOf, resolveReview, stateFromBackup } from '../src/domain/user-data';
import { IndexedDbStorage } from '../src/platform/storage';
import type { AppState, Entry } from '../src/domain/types';

// These tests write the whole collection to IndexedDB. Alone they take about 2 s, but in a full
// parallel run they can pass vitest's 5 s default, so this file allows 20 s.
vi.setConfig({ testTimeout: 20_000 });

const at = new Date('2026-10-15T10:00:00Z').getTime();
const packA = packEntries();
const word = [...packA.values()].find((e) => e.word === 'apprendre')!;
const short = (e: Entry) => e.groups[0].senses[0].definitions.zh.short;
// A newer pack in which the built-in entry was changed by `edit`.
const newerPack = (edit: (e: Entry) => void) => {
  const copy = structuredClone(word);
  edit(copy);
  return new Map([...packA, [word.id, copy]]) as ReadonlyMap<string, Entry>;
};
const edited = (value = '学；学会；得知') => {
  const e = structuredClone(word);
  e.groups[0].senses[0].definitions.zh.short = value;
  return e;
};

describe('reviewing edits against a newer pack', () => {
  const doc = splitEntry(word, edited()).doc!;
  it('keeps an edit quietly when the pack did not touch that field', () => {
    expect(reviewPatches(word, doc)).toEqual({ stale: false, items: [] });
    const other = structuredClone(word);
    other.groups[0].senses[0].definitions.en.short = 'to learn';
    expect(reviewPatches(other, doc)).toEqual({ stale: false, items: [] });
  });
  it('asks the learner when the pack changed the same field differently', () => {
    const next = structuredClone(word);
    next.groups[0].senses[0].definitions.zh.short = '学习；学会；学到';
    expect(reviewPatches(next, doc)).toEqual({
      stale: true,
      items: [
        expect.objectContaining({
          kind: 'changed',
          base: short(word),
          pack: '学习；学会；学到',
          mine: '学；学会；得知',
        }),
      ],
    });
  });
  it('drops an edit the pack has caught up with', () => {
    expect(reviewPatches(edited(), doc)).toEqual({ stale: true, items: [] });
  });
  it('reports an edit whose sense was removed', () => {
    const next = structuredClone(word);
    next.groups[0].senses.shift();
    expect(reviewPatches(next, doc).items).toEqual([
      expect.objectContaining({ kind: 'removed', mine: '学；学会；得知' }),
    ]);
  });
});

describe('content review through storage and backups', () => {
  const setup = async () => {
    const name = `review-${crypto.randomUUID()}`;
    const a = new IndexedDbStorage(name, packA);
    let state = await a.save(freshLearningState(at), null);
    const i = state.entries.findIndex((e) => e.id === word.id);
    const r = applyOperation(state, (d) => {
      d.entries[i].groups[0].senses[0].definitions.zh.short = '学；学会；得知';
    })!;
    state = await a.save(r.next, state.revision, r.changes);
    return { name, state, i };
  };
  it('records a conflict once, keeps the learner’s version, and resolves to the pack', async () => {
    const { name, i } = await setup();
    const packB = newerPack((e) => (e.groups[0].senses[0].definitions.zh.short = '学习；学到'));
    const b = new IndexedDbStorage(name, packB);
    const loaded = (await b.read()) as AppState;
    expect(b.needsFullSave).toBe(true);
    expect(short(loaded.entries[i])).toBe('学；学会；得知');
    expect(loaded.contentReview).toHaveLength(1);
    const saved = await b.save(loaded, loaded.revision);
    const again = new IndexedDbStorage(name, packB);
    expect(await again.read()).toEqual(saved);
    expect(again.needsFullSave).toBe(false);
    const r = applyOperation(saved, (d) => resolveReview(d, saved.contentReview![0].id, 'pack'))!;
    const resolved = await again.save(r.next, saved.revision, r.changes);
    expect(short(resolved.entries[i])).toBe('学习；学到');
    expect(resolved.contentReview).toBeUndefined();
    expect(await new IndexedDbStorage(name, packB).read()).toEqual(resolved);
  });
  it('lets the pack take over silently once it contains the same edit', async () => {
    const { name, i } = await setup();
    const b = new IndexedDbStorage(
      name,
      newerPack((e) => Object.assign(e, edited())),
    );
    const loaded = (await b.read()) as AppState;
    expect(loaded.contentReview).toBeUndefined();
    const saved = await b.save(loaded, loaded.revision);
    expect(short(saved.entries[i])).toBe('学；学会；得知');
  });
  it('backs up only the learner’s data and restores it, also onto a newer pack', async () => {
    const { state, i } = await setup();
    const backup = JSON.parse(JSON.stringify(backupOf(state, packA)));
    expect(JSON.stringify(backup).length).toBeLessThan(JSON.stringify(state).length / 5);
    expect(backup.contentPatches).toHaveLength(1);
    expect(migrateState(backup)).toEqual(migrateState(structuredClone(state)));
    const packB = newerPack((e) => (e.groups[0].senses[0].definitions.zh.short = '学习；学到'));
    const restored = stateFromBackup(backup, packB);
    expect(short(restored.entries[i])).toBe('学；学会；得知');
    expect(restored.contentReview).toHaveLength(1);
  });
});

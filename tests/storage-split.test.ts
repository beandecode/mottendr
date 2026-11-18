import { afterEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { freshLearningState } from '../src/domain/builtin';
import {
  beginSession,
  commitAnswer,
  ensureTasks,
  promotePending,
  skipTask,
  undoLast,
} from '../src/domain/learning';
import { mergeBackup } from '../src/domain/import-export';
import { diffState } from '../src/domain/changes';
import { applyOperation } from '../src/domain/mutation';
import { migrateState } from '../src/domain/migration';
import { packEntries } from '../src/domain/pack';
import { ConflictError, IndexedDbStorage } from '../src/platform/storage';
import type { AppState } from '../src/domain/types';

// These tests write the whole collection to IndexedDB. Alone they take about 2 s, but in a full
// parallel run they can pass vitest's 5 s default, so this file allows 20 s.
vi.setConfig({ testTimeout: 20_000 });

const at = new Date('2026-10-14T10:00:00Z').getTime();
const base = freshLearningState(at);
const fresh = () => structuredClone(base);
const started = () => {
  const s = fresh();
  beginSession(s, 'recognition', at);
  return s;
};
const legacyDb = (name: string, value: unknown) =>
  new Promise<void>((resolve, reject) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('state');
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const tx = r.result.transaction('state', 'readwrite');
      tx.objectStore('state').put(value, 'current');
      tx.oncomplete = () => {
        r.result.close();
        resolve();
      };
    };
  });
afterEach(() => vi.restoreAllMocks());

describe('change detection', () => {
  it('lists changed and appended records and asks for a rewrite when a list is reordered', () => {
    const s = started();
    const id = s.session!.queue[0];
    const result = applyOperation(s, (d) => commitAnswer(d, id, 'e1', at, 1000))!;
    const taskIndex = s.tasks.findIndex((t) => t.id === id);
    expect(result.changes.tasks).toEqual({ rewrite: false, indexes: [taskIndex] });
    expect(result.changes.events).toEqual({ rewrite: false, indexes: [0] });
    expect(result.changes.entries).toEqual({ rewrite: false, indexes: [] });
    const reordered = { ...s, tasks: [...s.tasks].reverse() };
    expect(diffState(s, reordered).tasks.rewrite).toBe(true);
  });
  it('returns null when an operation changes nothing', () => {
    const s = fresh();
    expect(applyOperation(s, () => {})).toBeNull();
    expect(applyOperation(s, (d) => ensureTasks(d, 'recognition', at))).toBeNull();
  });
});

describe('operations on immer drafts', () => {
  // Domain code was written for plain copies; the draft path must give identical results.
  const both = (s: AppState, op: (d: AppState) => unknown) => {
    const plain = structuredClone(s);
    op(plain);
    return { plain, draft: applyOperation(s, op)?.next ?? s };
  };
  it('matches the plain-copy results for learning operations', () => {
    const s = started();
    const id = s.session!.queue[0];
    let r = both(s, (d) => commitAnswer(d, id, 'e1', at, 1000));
    expect(r.draft).toEqual(r.plain);
    r = both(r.draft, (d) => undoLast(d, at + 1));
    expect(r.draft).toEqual(r.plain);
    r = both(r.draft, (d) => skipTask(d, at + 2));
    expect(r.draft).toEqual(r.plain);
    r = both(r.draft, (d) => promotePending(d, at + 120_000));
    expect(r.draft).toEqual(r.plain);
    r = both(r.draft, (d) => {
      d.prefs.direction = 'production';
      ensureTasks(d, 'production', at);
    });
    expect(r.draft).toEqual(r.plain);
    expect(r.draft.tasks.length).toBe(s.tasks.length * 2);
  });
  it('matches the plain-copy result when merging a backup', () => {
    const s = fresh(),
      incoming = started();
    const id = incoming.session!.queue[0];
    commitAnswer(incoming, id, 'e1', at, 1000);
    const r = both(s, (d) => mergeBackup(d, incoming));
    expect(r.draft).toEqual(r.plain);
  });
  it('rejects an invalid change and leaves the original state untouched', () => {
    const s = fresh(),
      before = structuredClone(s);
    expect(() =>
      applyOperation(s, (d) => {
        d.tasks[0].card.due = -1;
      }),
    ).toThrow('INVALID_FILE');
    expect(s).toEqual(before);
  });
});

describe('split IndexedDB storage', () => {
  it('moves the single-record layout into separate stores and keeps the old record', async () => {
    const name = `split-${crypto.randomUUID()}`,
      old = { ...started(), revision: 7 };
    await legacyDb(name, old);
    const db = new IndexedDbStorage(name);
    expect(await db.read()).toEqual(old);
    expect(db.needsFullSave).toBe(true);
    const saved = await db.save(old, 7);
    expect(saved.revision).toBe(8);
    expect(db.needsFullSave).toBe(false);
    expect(await db.readStorageSplitBackup()).toEqual(old);
    const reopened = new IndexedDbStorage(name);
    expect(await reopened.read()).toEqual(saved);
    expect(reopened.needsFullSave).toBe(false);
  });
  it('writes only the changed records and reads back the same state', async () => {
    const db = new IndexedDbStorage(`incremental-${crypto.randomUUID()}`);
    const saved = await db.save(started(), null);
    const id = saved.session!.queue[0];
    const result = applyOperation(saved, (d) => commitAnswer(d, id, 'e1', at, 1000))!;
    const put = vi.spyOn(IDBObjectStore.prototype, 'put');
    const next = await db.save(result.next, saved.revision, result.changes);
    // meta + one task + one event, instead of thousands of entries and tasks
    expect(put).toHaveBeenCalledTimes(3);
    expect(next.revision).toBe(saved.revision + 1);
    expect(await db.read()).toEqual(next);
  });
  it('rewrites a list completely when it was shortened', async () => {
    const db = new IndexedDbStorage(`rewrite-${crypto.randomUUID()}`);
    const saved = await db.save(fresh(), null);
    const result = applyOperation(saved, (d) => {
      d.tasks.splice(0, d.tasks.length);
      d.session = null;
    })!;
    expect(result.changes.tasks.rewrite).toBe(true);
    const next = await db.save(result.next, saved.revision, result.changes);
    expect((await db.read())!.tasks).toEqual([]);
    expect(next.tasks).toEqual([]);
  });
  it('rejects an incremental save from a stale writer', async () => {
    const name = `stale-${crypto.randomUUID()}`;
    const a = new IndexedDbStorage(name),
      b = new IndexedDbStorage(name);
    const saved = await a.save(started(), null);
    const id = saved.session!.queue[0];
    const first = applyOperation(saved, (d) => commitAnswer(d, id, 'e1', at, 1000))!;
    await a.save(first.next, saved.revision, first.changes);
    const second = applyOperation(saved, (d) => skipTask(d, at))!;
    await expect(b.save(second.next, saved.revision, second.changes)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
  it('keeps the previous complete state when a content upgrade raises the collection version', async () => {
    const db = new IndexedDbStorage(`content-${crypto.randomUUID()}`);
    const old = fresh();
    old.installedCollections![0].version = 2;
    const saved = await db.save(old, null);
    const result = applyOperation(saved, (d) => {
      d.installedCollections![0].version = 3;
    })!;
    await db.save(result.next, saved.revision, result.changes);
    expect(await db.readContentBackup()).toEqual(saved);
  });
});

describe('layered storage of built-in entries', () => {
  const count = (name: string) =>
    new Promise<Record<string, number>>((resolve, reject) => {
      const r = indexedDB.open(name);
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        const db = r.result,
          names = [...db.objectStoreNames],
          tx = db.transaction(names, 'readonly'),
          counts: Record<string, number> = {};
        for (const n of names) {
          const c = tx.objectStore(n).count();
          c.onsuccess = () => (counts[n] = c.result);
        }
        tx.oncomplete = () => {
          db.close();
          resolve(counts);
        };
      };
    });
  it('stores no built-in content for a fresh install, only what the learner changes', async () => {
    const name = `layers-${crypto.randomUUID()}`,
      db = new IndexedDbStorage(name);
    const saved = await db.save(fresh(), null);
    expect(await count(name)).toMatchObject({
      contentPatches: 0,
      annotations: 0,
      userEntries: 0,
      tasks: packEntries().size,
    });
    const target = saved.entries.findIndex((e) => e.word === 'apprendre');
    let state = saved;
    for (const op of [
      (d: AppState) => void (d.entries[target].favorite = true),
      (d: AppState) => {
        d.entries[target].groups[0].senses[0].definitions.zh.short = '学；学会；得知';
        d.entries[target].contentVersion++;
      },
      (d: AppState) =>
        void d.entries.push({
          ...structuredClone(saved.entries[target]),
          id: 'own-1',
          tags: ['考试'],
        }),
    ]) {
      const r = applyOperation(state, op)!;
      state = await db.save(r.next, state.revision, r.changes);
    }
    expect(await count(name)).toMatchObject({ contentPatches: 1, annotations: 1, userEntries: 1 });
    expect(await new IndexedDbStorage(name).read()).toEqual(state);
  });
  it('migrates realistic old data: only real edits are kept, collection tags are dropped', async () => {
    const name = `old-${crypto.randomUUID()}`;
    const old = { ...fresh(), revision: 3 };
    // What 0.6.x stored: collection tags, metadata bumped by earlier content upgrades.
    old.entries.forEach((e) => {
      e.tags = ['word-list'];
      e.updatedAt = at;
      e.contentVersion += 2;
    });
    old.entries[0].groups[0].senses[0].definitions.zh.short = '我的释义';
    old.entries[1].favorite = true;
    old.entries.push({ ...structuredClone(old.entries[2]), id: 'dict:abc', tags: ['dictionary'] });
    await legacyDb(name, old);
    const db = new IndexedDbStorage(name);
    const loaded = migrateState(await db.read(), true);
    expect(loaded.entries.every((e) => e.tags.length === 0)).toBe(true);
    const saved = await db.save(loaded, 3);
    expect(await count(name)).toMatchObject({ contentPatches: 1, annotations: 1, userEntries: 1 });
    expect(saved.entries[0].groups[0].senses[0].definitions.zh.short).toBe('我的释义');
    expect(saved.entries[0].contentVersion).toBe(old.entries[0].contentVersion);
    // Unedited entries now follow the built-in pack, including its metadata.
    expect(saved.entries[5]).toEqual(packEntries().get(saved.entries[5].id));
    expect(await new IndexedDbStorage(name).read()).toEqual(saved);
    expect(await db.readStorageSplitBackup()).toEqual(old);
  });
  it('converts the 0.7 pre-release layout with one record per entry', async () => {
    const name = `pre-${crypto.randomUUID()}`,
      state = { ...started(), revision: 4 };
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open(name, 2);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('state');
        r.result.createObjectStore('meta');
        for (const n of ['entries', 'tasks', 'events'])
          r.result.createObjectStore(n, { keyPath: 'id' });
      };
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        const tx = r.result.transaction(['meta', 'entries', 'tasks', 'events'], 'readwrite');
        const { entries, tasks, events, ...meta } = state;
        tx.objectStore('meta').put(meta, 'current');
        for (const [n, list] of [
          ['entries', entries],
          ['tasks', tasks],
          ['events', events],
        ] as const)
          list.forEach((v, seq) => tx.objectStore(n).put({ id: v.id, seq, value: v }));
        tx.oncomplete = () => {
          r.result.close();
          resolve();
        };
      };
    });
    const db = new IndexedDbStorage(name);
    expect(await db.read()).toEqual(state);
    expect(db.needsFullSave).toBe(true);
    const saved = await db.save(state, 4);
    expect((await count(name)).entries).toBe(0);
    expect(await new IndexedDbStorage(name).read()).toEqual(saved);
  });
});

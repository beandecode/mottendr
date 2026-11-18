import { describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { freshLearningState, replaceWithBackup } from '../src/domain/builtin';
import { beginSession } from '../src/domain/learning';
import { applyOperation } from '../src/domain/mutation';
import { migrateState } from '../src/domain/migration';
import { IndexedDbStorage } from '../src/platform/storage';
import type { AppState } from '../src/domain/types';

// These tests write the whole collection to IndexedDB. Alone they take about 2 s, but in a full
// parallel run they can pass vitest's 5 s default, so this file allows 20 s.
vi.setConfig({ testTimeout: 20_000 });

const at = new Date('2026-10-15T10:00:00Z').getTime();

// A 0.6.3 full backup (schemaVersion 2) with a study session in progress, restored with
// "replace" into a newly installed app.
describe('replace restore', () => {
  const oldApp = freshLearningState(at);
  beginSession(oldApp, 'recognition', at);
  const backupFile = JSON.parse(JSON.stringify(oldApp));

  it('restores the backup and keeps the replaced data in storage', async () => {
    const db = new IndexedDbStorage('restore-replace');
    const before = await db.save(freshLearningState(at + 1), null);
    const data = migrateState(backupFile);
    const result = applyOperation(before, (d) => replaceWithBackup(d, data))!;
    await db.save(result.next, before.revision, result.changes, 'before-restore');
    const read = migrateState(await db.read()) as AppState;
    expect(read.session).toEqual(oldApp.session);
    expect(read.tasks.map((t) => t.id)).toEqual(oldApp.tasks.map((t) => t.id));
    const kept = (await db.readRestoreBackup())!;
    expect(kept.revision).toBe(before.revision);
    expect(kept.session).toEqual(before.session);
  });
  it('keeps no restore backup for ordinary saves', async () => {
    const db = new IndexedDbStorage('restore-none');
    const first = await db.save(freshLearningState(at), null);
    const next = applyOperation(first, (d) => {
      d.prefs.newLimit = 7;
    })!;
    await db.save(next.next, first.revision, next.changes);
    expect(await db.readRestoreBackup()).toBeFalsy();
  });
});

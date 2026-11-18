import { afterEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { freshLearningState } from '../src/domain/builtin';
import { packEntries } from '../src/domain/pack';
import { addIssue, closeIssue, exportIssues, maybeFixed, openIssues } from '../src/domain/issues';
import { applyOperation } from '../src/domain/mutation';
import { migrateState } from '../src/domain/migration';
import { backupOf } from '../src/domain/user-data';
import { IndexedDbStorage } from '../src/platform/storage';
import type { AppState, Entry } from '../src/domain/types';

const at = new Date('2026-10-15T10:00:00Z').getTime();
const pack = packEntries();
const base = freshLearningState(at);
const word = base.entries.find((e) => e.word === 'apprendre')!;
const sense = word.groups[0].senses[0];
const flag = (s: AppState) =>
  applyOperation(s, (d) =>
    addIssue(
      d,
      { entryId: word.id, senseId: sense.id, kind: 'meaning', note: ' 少了“教” ', context: '' },
      pack,
      at,
    ),
  )!;
afterEach(() => vi.restoreAllMocks());

describe('flagging problems', () => {
  it('records the problem without touching tasks, events or the session', () => {
    const input = structuredClone(base);
    const { next, changes } = flag(input);
    expect(next.issues).toEqual([
      expect.objectContaining({
        entryId: word.id,
        senseId: sense.id,
        kind: 'meaning',
        note: '少了“教”',
        status: 'open',
        packVersion: pack.get(word.id)!.contentVersion,
      }),
    ]);
    expect(next.tasks).toBe(input.tasks);
    expect(next.events).toBe(input.events);
    expect(next.session).toBe(input.session);
    expect(changes.tasks.indexes).toEqual([]);
    expect(changes.issues.indexes).toEqual([0]);
  });
  it('closes a problem once, and lists only open ones', () => {
    const { next } = flag(structuredClone(base));
    const id = next.issues![0].id;
    const closed = applyOperation(next, (d) => closeIssue(d, id, 'resolved', at + 1))!.next;
    expect(closed.issues![0]).toMatchObject({ status: 'resolved', closedAt: at + 1 });
    expect(openIssues(closed)).toEqual([]);
    expect(applyOperation(closed, (d) => closeIssue(d, id, 'dismissed'))).toBeNull();
  });
  it('notices when a newer pack changed the flagged entry', () => {
    const issue = flag(structuredClone(base)).next.issues![0];
    expect(maybeFixed(issue, pack)).toBe(false);
    const newer = structuredClone(pack.get(word.id)!) as Entry;
    newer.contentVersion++;
    expect(maybeFixed(issue, new Map([[word.id, newer]]))).toBe(true);
  });
  it('exports problems with what the entry says now', () => {
    const state = flag(structuredClone(base)).next;
    const [row] = JSON.parse(exportIssues(state, 'json'));
    expect(row).toMatchObject({
      word: 'apprendre',
      collection: 'word-list',
      kind: 'meaning',
      currentZh: sense.definitions.zh.short,
    });
    const tsv = exportIssues(state, 'tsv').split('\n');
    expect(tsv[0].split('\t')).toContain('currentZh');
    expect(tsv).toHaveLength(2);
  });
  it('rejects a problem attached to an unknown entry', () => {
    expect(() =>
      applyOperation(structuredClone(base), (d) =>
        addIssue(d, { entryId: 'nope', kind: 'other', note: '', context: '' }, pack),
      ),
    ).toThrow('INVALID_FILE');
  });
});

describe('storing and backing up problems', () => {
  it('writes one record per problem and reads them back', async () => {
    const name = `issues-${crypto.randomUUID()}`,
      db = new IndexedDbStorage(name);
    const saved = await db.save(structuredClone(base), null);
    expect((await db.read()) as AppState).not.toHaveProperty('issues');
    const { next, changes } = flag(saved);
    const put = vi.spyOn(IDBObjectStore.prototype, 'put');
    const stored = await db.save(next, saved.revision, changes);
    expect(put).toHaveBeenCalledTimes(2); // meta + the problem
    expect(await new IndexedDbStorage(name).read()).toEqual(stored);
  });
  it('keeps problems in the backup and accepts backups without them', () => {
    const state = flag(structuredClone(base)).next;
    const backup = JSON.parse(JSON.stringify(backupOf(state, pack)));
    expect(backup.issues).toHaveLength(1);
    expect(migrateState(backup).issues).toEqual(state.issues);
    delete backup.issues;
    expect(migrateState(backup)).not.toHaveProperty('issues');
  });
});

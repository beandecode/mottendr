import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { initialState } from '../src/domain/seed';
import { legacyEntries } from '../src/domain/legacy-samples';
import { migrateState } from '../src/domain/migration';
import { beginSession, commitAnswer, ensureTasks, availableTasks } from '../src/domain/learning';
import { newSense, relatedEntries, shortDefinition } from '../src/domain/lexicon';
import { validateEntry, validateLinks } from '../src/domain/validation';
import { parseEntries, exportTsv, commitImport, validateBackup } from '../src/domain/import-export';
import { IndexedDbStorage } from '../src/platform/storage';
import type { LegacyState, Entry, VerbProfile } from '../src/domain/types';
import { verbGroupText } from '../src/domain/verb-group';
const at = 1791115200000;
function legacy() {
  const s = initialState(at);
  s.entries = s.entries.slice(0, 24);
  s.tasks = s.tasks.filter((t) => s.entries.some((e) => e.id === t.entryId));
  beginSession(s, 'recognition', at);
  commitAnswer(s, s.session!.queue[0], 'old-exposure', at, 100);
  const raw = JSON.parse(JSON.stringify(s));
  raw.schemaVersion = 1;
  raw.entries = legacyEntries(at);
  for (const t of raw.tasks) delete t.target;
  for (const e of raw.events) {
    delete e.before.target;
    delete e.after.target;
  }
  raw.entries[0].note = '保留旧笔记';
  raw.entries[0].noteLanguage = 'zh';
  raw.entries[0].favorite = true;
  return raw as LegacyState;
}
const by = (entries: Entry[], word: string) => entries.find((e) => e.word === word)!;
describe('lexical schema and migration', () => {
  it('preserves legacy IDs, schedules, events, sessions and notes on migration', () => {
    const old = legacy(),
      next = migrateState(old);
    expect(next.schemaVersion).toBe(2);
    expect(next.entries.length).toBe(24);
    expect(next.session).toEqual(old.session);
    expect(next.prefs).toEqual(old.prefs);
    expect(next.events[0]).toEqual({
      ...old.events[0],
      before: { ...old.events[0].before, target: { kind: 'entry' } },
      after: { ...old.events[0].after, target: { kind: 'entry' } },
    });
    expect(next.tasks[0]).toEqual({ ...old.tasks[0], target: { kind: 'entry' } });
    expect(next.entries[0].localizedNotes.zh).toBe('保留旧笔记');
    expect(next.entries[0].favorite).toBe(true);
    expect(old.schemaVersion).toBe(1);
  });
  it('enriches unchanged starter data while preserving user edits and progress', () => {
    const old = legacy();
    old.entries[1].zh.short = '用户自己的解释';
    old.entries[1].contentVersion = 4;
    const next = migrateState(old, true);
    expect(next.entries.length).toBe(30);
    expect(next.entries[1].groups[0].senses[0].definitions.zh.short).toBe('用户自己的解释');
    expect(next.entries[1].contentVersion).toBe(4);
    expect(by(next.entries, 'livre').groups[0].senses).toHaveLength(2);
    expect(next.tasks[0].card).toEqual(old.tasks[0].card);
    expect(next.entries[0].favorite).toBe(true);
  });
  it('uses existing user base verbs when adding related starter entries', () => {
    const old = legacy(),
      appeler = structuredClone(old.entries[7]);
    appeler.id = 'user-appeler';
    appeler.word = 'appeler';
    appeler.pos = 'verb';
    appeler.sourceStatus = 'user';
    old.entries.push(appeler);
    const next = migrateState(old, true);
    expect(by(next.entries, 's’appeler').relations[0].targetId).toBe('user-appeler');
    expect(() => validateBackup(next)).not.toThrow();
  });
  it('keeps a pre-migration snapshot in the same storage transaction', async () => {
    const old = legacy(),
      name = `migration-${crypto.randomUUID()}`;
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('state');
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        const db = r.result,
          tx = db.transaction('state', 'readwrite');
        tx.objectStore('state').put(old, 'current');
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
      };
    });
    const db = new IndexedDbStorage(name);
    const saved = await db.save(migrateState(old, true), old.revision);
    expect(await db.readMigrationBackup()).toEqual(old);
    expect(await db.read()).toEqual(saved);
  });
  it('adds meanings without new memory tasks, but gives pronominal entries separate tasks', () => {
    const s = initialState(at),
      before = structuredClone(s.tasks),
      e = by(s.entries, 'apprendre'),
      sense = newSense();
    sense.definitions.en.short = 'additional meaning';
    e.groups[0].senses.push(sense);
    ensureTasks(s, 'recognition', at);
    expect(s.tasks).toEqual(before);
    const call = s.tasks.find((t) => t.entryId === by(s.entries, 'appeler').id)!,
      name = s.tasks.find((t) => t.entryId === by(s.entries, 's’appeler').id)!;
    call.learnedAt = at;
    call.card.reps = 3;
    expect(name.card.reps).toBe(0);
    expect(name.learnedAt).toBeUndefined();
    expect(s.tasks.every((t) => t.target.kind === 'entry')).toBe(true);
  });
  it('stores noun sense gender and multi-POS independently', () => {
    const s = initialState(at),
      livre = by(s.entries, 'livre');
    expect(livre.groups[0].gender).toBe('m');
    expect(livre.groups[0].senses[1].gender).toBe('f');
    expect(by(s.entries, 'ensemble').groups.map((g) => g.pos)).toEqual(['adverb', 'noun']);
    expect(shortDefinition(livre, 'en')).toContain('pound');
  });
  it('does not repeat a short meaning piece that an earlier sense gave', () => {
    const s = initialState(at),
      entry = structuredClone(by(s.entries, 'livre'));
    entry.groups = [entry.groups[0]];
    const [first, second] = entry.groups[0].senses;
    first.definitions.en.short = 'to learn';
    second.definitions.en.short = 'to learn; to find out';
    first.definitions.zh.short = '学习；学会';
    second.definitions.zh.short = '学会；得知';
    expect(shortDefinition(entry, 'en')).toBe('to learn; to find out');
    expect(shortDefinition(entry, 'zh')).toBe('学习；学会；得知');
  });
  it('shows inverse verb links and all members of a word family', () => {
    const s = initialState(at),
      base = by(s.entries, 'attendre'),
      links = relatedEntries(base, s.entries);
    expect(links.some((r) => r.inverse && r.entry?.word === 's’attendre')).toBe(true);
    expect(relatedEntries(by(s.entries, 'apprendre'), s.entries).map((r) => r.entry?.word)).toEqual(
      expect.arrayContaining(['apprentissage', 'réapprendre']),
    );
  });
  it('preserves structured content in TSV and JSON including remapped links', () => {
    const s = initialState(at);
    for (const format of ['tsv', 'json'] as const) {
      const imported = parseEntries(
        format === 'tsv' ? exportTsv(s.entries) : JSON.stringify(s.entries),
        format,
        [],
      );
      expect(imported.errors).toEqual([]);
      expect(imported.entries).toHaveLength(30);
      for (const e of s.entries) {
        const copy = by(imported.entries, e.word);
        expect(copy.groups).toEqual(e.groups);
        expect(copy.families).toEqual(e.families);
        expect(copy.sources).toEqual(e.sources);
      }
      expect(by(imported.entries, 's’appeler').relations[0].targetId).toBe(
        by(imported.entries, 'appeler').id,
      );
      const empty = initialState(at);
      empty.entries = [];
      empty.tasks = [];
      commitImport(empty, imported.entries);
      expect(by(empty.entries, 's’appeler').relations[0].targetId).toBe(
        by(empty.entries, 'appeler').id,
      );
      expect(() => validateBackup(empty)).not.toThrow();
    }
  });
  it('maps links to existing words on a partial content import', () => {
    const s = initialState(at),
      existing = [by(s.entries, 'appeler')],
      incoming = [by(s.entries, 'appeler'), by(s.entries, 's’appeler')];
    const p = parseEntries(JSON.stringify(incoming), 'json', existing);
    expect(p.duplicates).toBe(1);
    expect(p.entries[0].relations[0].targetId).toBe(existing[0].id);
  });
  it('rejects dangling, cyclic and invalid pronominal relationships before mutation', () => {
    const s = initialState(at),
      before = structuredClone(s),
      e = structuredClone(by(s.entries, 's’appeler'));
    e.word = 'se tester';
    e.id = 'other';
    e.relations[0].targetId = 'missing';
    expect(() => commitImport(s, [e])).toThrow();
    expect(s).toEqual(before);
    const a = structuredClone(s.entries[0]),
      b = structuredClone(s.entries[1]),
      c = structuredClone(s.entries[2]),
      link = (targetId: string) => ({
        id: crypto.randomUUID(),
        type: 'derived-from' as const,
        targetId,
        notes: { zh: '', en: '' },
        status: 'needs-review' as const,
        source: '',
      });
    a.relations = [link(b.id), link(c.id)];
    c.relations = [link(a.id)];
    expect(() => validateLinks([a, b, c])).toThrow();
    e.relations[0].targetId = s.entries[0].id;
    expect(() => validateLinks([...s.entries, e])).toThrow();
  });
  it('rejects unsafe URLs and incomplete tables labelled provided', () => {
    const s = initialState(at),
      e = structuredClone(by(s.entries, 'appeler'));
    e.groups[0].verb!.conjugations[0].source = 'javascript:alert(1)';
    expect(() => validateEntry(e)).toThrow();
    e.groups[0].verb!.conjugations[0].source = '';
    e.groups[0].verb!.conjugations[0].rows.pop();
    expect(() => validateEntry(e)).toThrow();
  });
  it('does not insert future sense exercise targets into the current queue', () => {
    const s = initialState(at),
      e = s.entries[0];
    s.tasks.push({
      ...structuredClone(s.tasks[0]),
      id: 'future-sense',
      target: { kind: 'sense', senseId: e.groups[0].senses[0].id },
    });
    expect(() => validateBackup(s)).not.toThrow();
    expect(availableTasks(s, 'recognition').map((t) => t.id)).not.toContain('future-sense');
  });
});
describe('starter French verb forms', () => {
  it('handles spelling, elision, pronominal meaning and agreement notes', () => {
    const entries = initialState(at).entries,
      table = (word: string, tense: string) =>
        by(entries, word).groups[0].verb!.conjugations.find(
          (t) => t.mood === 'indicative' && t.tense === tense,
        )!;
    expect(table('manger', 'present').rows[3].forms[0]).toBe('nous mangeons');
    expect(table('manger', 'imperfect').rows[3].forms[0]).toBe('nous mangions');
    expect(table('appeler', 'future-simple').rows[0].forms[0]).toBe('j’appellerai');
    expect(table('réapprendre', 'present').rows[0].forms[0]).toBe('je réapprends');
    expect(table('s’attendre', 'present').rows[0].forms[0]).toBe('je m’attends');
    expect(table('s’appeler', 'past-composed').rows[0].forms[0]).toBe('je me suis appelé(e)');
    expect(by(entries, 's’attendre').groups[0].verb!.meaningDifference.en).toContain('expect');
    expect(table('s’attendre', 'pluperfect').status).toBe('not-provided');
    expect(
      by(entries, 's’appeler').groups[0].verb!.conjugations.find(
        (t) => t.mood === 'participle' && t.tense === 'present',
      )!.rows[0].forms[0],
    ).toBe('s’appelant');
  });
});
describe('verb groups', () => {
  it('names the group and the first-group spelling change', () => {
    const verb = (v: Partial<VerbProfile>) => v as VerbProfile;
    expect(verbGroupText(verb({ group: '1', spellingChange: 'e-grave' }), 'zhOnly')).toBe(
      '第一组 · e→è',
    );
    expect(verbGroupText(verb({ group: '2' }), 'enOnly')).toBe('Group 2');
    expect(verbGroupText(verb({ group: '1', spellingChange: 'double' }), 'zhOnly')).toBe(
      '第一组 · 双写辅音',
    );
    expect(verbGroupText(verb({}), 'zhOnly')).toBe('');
  });
  it('accepts the group on a verb and rejects other values', () => {
    const e = structuredClone(
      initialState(at).entries.find((e) => e.groups.some((g) => g.pos === 'verb' && g.verb))!,
    );
    const g = e.groups.find((g) => g.pos === 'verb' && g.verb)!;
    g.verb!.group = '3';
    expect(() => validateEntry(e)).not.toThrow();
    (g.verb as unknown as Record<string, unknown>).group = '4';
    expect(() => validateEntry(e)).toThrow();
  });
  it('lets only a defective verb leave out persons that do not exist', () => {
    const e = structuredClone(
      initialState(at).entries.find((e) =>
        e.groups.some((g) => g.verb?.conjugations.some((t) => t.status === 'provided')),
      )!,
    );
    const g = e.groups.find((g) => g.verb?.conjugations.some((t) => t.status === 'provided'))!;
    const t = g.verb!.conjugations.find((t) => t.status === 'provided' && t.mood === 'indicative')!;
    t.rows = t.rows.filter((r) => r.person === '3s');
    expect(() => validateEntry(e)).toThrow();
    g.features = [...g.features, 'defective'];
    expect(() => validateEntry(e)).not.toThrow();
  });
});

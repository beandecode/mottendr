import { describe, expect, it } from 'vitest';
import { freshLearningState } from '../src/domain/builtin';
import {
  beginSession,
  buildQueue,
  ensureTasks,
  FREQUENCY_JITTER,
  frequencyJitter,
} from '../src/domain/learning';
import { validateBackup } from '../src/domain/import-export';
import { content } from '../src/content/files';
import type { AppState, Entry } from '../src/domain/types';

const at = new Date('2026-10-16T09:00:00Z').getTime();
const words = (state: AppState, ids: string[]) => {
  const byTask = new Map(state.tasks.map((t) => [t.id, t.entryId]));
  const byId = new Map(state.entries.map((e) => [e.id, e.word]));
  return ids.map((id) => byId.get(byTask.get(id)!));
};
// The first n built-in words to study, by frequency loosened by each entry's fixed offset.
const byFrequency = (state: AppState, n: number) => {
  const { frequency } = content('word-list');
  return state.entries
    .filter((e) => !e.suspended && frequency[e.id] !== undefined)
    .map((e) => ({
      word: e.word,
      rank: frequency[e.id],
      key: Math.max(1, frequency[e.id] + frequencyJitter(e.id)),
    }))
    .sort((a, b) => a.key - b.key || a.rank - b.rank)
    .slice(0, n)
    .map((e) => e.word);
};
function addOwn(state: AppState, id: string, word: string) {
  const entry = { ...structuredClone(state.entries.at(-1)!), id, word, tags: [] } as Entry;
  state.entries.push(entry);
  ensureTasks(state, 'recognition', at);
}

describe('new-word order', () => {
  it('ships a place for every built-in entry', () => {
    const file = content('word-list');
    const places = Object.values(file.frequency).sort((a, b) => a - b);
    expect(places).toEqual(file.entries.map((_, i) => i + 1));
    expect(file.entries.every((e) => file.frequency[e.id] !== undefined)).toBe(true);
  });
  it('loosens the frequency order by a fixed offset of at most 30 places', () => {
    const ids = content('word-list').entries.map((e) => e.id);
    const offsets = ids.map(frequencyJitter);
    expect(FREQUENCY_JITTER).toBe(30);
    expect(offsets.every((o) => Number.isInteger(o) && Math.abs(o) <= 30)).toBe(true);
    expect(ids.map(frequencyJitter)).toEqual(offsets);
    expect(Math.min(...offsets)).toBe(-30);
    expect(Math.max(...offsets)).toBe(30);
    expect(new Set(offsets).size).toBe(61);
  });
  it('orders only new words by frequency in a fixed session; due reviews and the daily limit stay', () => {
    const state = freshLearningState(at);
    Object.assign(state.prefs, { newLimit: 5, sessionLimit: 20 });
    const listOrder = words(state, buildQueue(state, 'recognition', at));
    expect(listOrder).toEqual(state.entries.slice(0, 5).map((e) => e.word));
    const due = state.tasks.find((t) => state.entries.at(-1)!.id === t.entryId)!;
    due.learnedAt = at - 86_400_000;
    due.card.due = at - 1000;
    state.prefs.newWordOrder = 'frequency';
    const queue = buildQueue(state, 'recognition', at);
    expect(queue[0]).toBe(due.id);
    // Frequent words of content/word-list/frequency.json, lightly mixed; de, je, ne, et are
    // grammar words not studied by default (content/word-list/not-studied.json).
    const first = words(state, queue.slice(1));
    expect(first).toEqual(byFrequency(state, 5));
    expect(first).not.toEqual(['être', 'avoir', 'ne... pas', 'en', 'faire']);
  });
  it('puts the learner’s own and dictionary entries before built-in ones', () => {
    const state = freshLearningState(at);
    Object.assign(state.prefs, { newLimit: 4, newWordOrder: 'frequency' });
    addOwn(state, 'user-own-1', 'mon mot');
    addOwn(state, 'dict:abc', 'du dictionnaire');
    expect(words(state, buildQueue(state, 'recognition', at))).toEqual([
      'mon mot',
      'du dictionnaire',
      ...byFrequency(state, 2),
    ]);
  });
  it('refills a continuous session in frequency order', () => {
    const state = freshLearningState(at);
    Object.assign(state.prefs, {
      continuousLearning: true,
      activeTaskLimit: 6,
      refillLimit: 3,
      newLimit: 8,
      newWordOrder: 'frequency',
    });
    beginSession(state, 'recognition', at);
    expect(words(state, state.session!.queue)).toEqual(byFrequency(state, 3));
  });
  it('converts the old shuffle switch in saved data and backups', () => {
    const state = freshLearningState(at);
    const on = { ...structuredClone(state), prefs: { ...state.prefs, shuffleNewWords: true } };
    const restored = validateBackup(JSON.parse(JSON.stringify(on)));
    expect(restored.prefs.newWordOrder).toBe('shuffle');
    expect('shuffleNewWords' in restored.prefs).toBe(false);
    const off = { ...structuredClone(state), prefs: { ...state.prefs, shuffleNewWords: false } };
    const kept = validateBackup(JSON.parse(JSON.stringify(off)));
    expect(kept.prefs.newWordOrder).toBeUndefined();
    expect('shuffleNewWords' in kept.prefs).toBe(false);
    state.prefs.newWordOrder = 'frequency';
    expect(validateBackup(JSON.parse(JSON.stringify(state))).prefs.newWordOrder).toBe('frequency');
    Object.assign(state.prefs, { newWordOrder: 'alphabetical' });
    expect(() => validateBackup(JSON.parse(JSON.stringify(state)))).toThrow();
  });
});

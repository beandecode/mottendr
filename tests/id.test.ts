import { afterEach, describe, expect, it, vi } from 'vitest';
import { newId } from '../src/domain/id';
import { blankEntry } from '../src/domain/lexicon';
import { freshLearningState } from '../src/domain/builtin';
import { beginSession, commitAnswer } from '../src/domain/learning';
import { validateBackup } from '../src/domain/import-export';

const webCrypto = globalThis.crypto;
afterEach(() => vi.unstubAllGlobals());
describe('record IDs on LAN HTTP', () => {
  it('uses the native UUID API when available', () => {
    const uuid = webCrypto.randomUUID();
    const randomUUID = vi.fn(() => uuid);
    vi.stubGlobal('crypto', { randomUUID });
    expect(newId()).toBe(uuid);
    expect(randomUUID).toHaveBeenCalledOnce();
  });
  it('produces unique UUIDv4 record IDs with only getRandomValues', () => {
    vi.stubGlobal('crypto', { getRandomValues: webCrypto.getRandomValues.bind(webCrypto) });
    const ids = Array.from({ length: 1000 }, () => newId());
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      ids.every((id) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id),
      ),
    ).toBe(true);
  });
  it('can boot the collection, create an entry and record learning without randomUUID', () => {
    vi.stubGlobal('crypto', { getRandomValues: webCrypto.getRandomValues.bind(webCrypto) });
    const at = Date.now(),
      state = freshLearningState(at),
      entry = blankEntry();
    entry.word = 'test';
    entry.groups[0].senses[0].definitions.zh.short = '测试';
    state.entries.push(entry);
    beginSession(state, 'recognition', at, 'word-list');
    commitAnswer(state, state.session!.queue[0], newId(), at, 1200);
    expect(state.events).toHaveLength(1);
    expect(state.session!.completed).toBe(1);
    expect(() => validateBackup(state)).not.toThrow();
  });
  it('fails explicitly when no secure random generator exists', () => {
    vi.stubGlobal('crypto', {});
    expect(() => newId()).toThrow('RANDOM_SOURCE_UNAVAILABLE');
  });
});

import { describe, expect, it } from 'vitest';
import { initialState } from '../src/domain/seed';
import { beginSession, commitAnswer, promotePending } from '../src/domain/learning';
import { preview } from '../src/scheduler';
import { validateBackup } from '../src/domain/import-export';
import { cardRegion, touchCapable } from '../src/platform/input';
import { selectVoice, speechSource } from '../src/platform/speech';

describe('display preferences and existing backups', () => {
  it('accepts old backups without a font setting and preserves their learning state', () => {
    const state = initialState();
    delete state.prefs.fontScale;
    const restored = validateBackup(JSON.parse(JSON.stringify(state)));
    expect(restored.tasks).toEqual(state.tasks);
    expect(restored.prefs.fontScale ?? 1).toBe(1);
    state.prefs.fontScale = 1.5;
    expect(validateBackup(JSON.parse(JSON.stringify(state))).prefs.fontScale).toBe(1.5);
  });
  it('rejects malformed or unsupported font scales before import', () => {
    for (const scale of [0, 0.84, 1.51, Infinity, null, '1.5']) {
      const state = initialState();
      Object.assign(state.prefs, { fontScale: scale });
      expect(() => validateBackup(state)).toThrow();
    }
  });
  it('rebases legacy sizes once to the larger default without changing learning progress', () => {
    for (const scale of [undefined, 0.85, 1, 1.5]) {
      const state = initialState();
      const at = Date.now();
      beginSession(state, 'recognition', at);
      const id = state.session!.queue[0];
      commitAnswer(state, id, 'typography-exposure', at, 1000);
      state.session!.queue = [];
      promotePending(state, at + 60_001);
      const outcomes = preview(
        state.tasks.find((task) => task.id === id)!.card,
        at + 60_001,
        state.prefs.retention,
      );
      commitAnswer(state, id, 'typography-review', at + 60_001, 1500, 3, outcomes, at + 60_001);
      delete state.prefs.typographyVersion;
      state.prefs.fontScale = scale;
      const restored = validateBackup(state);
      expect(restored.prefs.fontScale).toBe(1);
      expect(restored.prefs.typographyVersion).toBe(3);
      expect(restored.tasks).toEqual(state.tasks);
      expect(restored.events).toEqual(state.events);
      expect(restored.session).toEqual(state.session);
      expect(state.prefs.typographyVersion).toBeUndefined();
      restored.prefs.fontScale = 1.3;
      expect(validateBackup(restored).prefs.fontScale).toBe(1.3);
    }
  });
  it('keeps v2 sizes the same on screen when 115% becomes the new 100%', () => {
    for (const [before, after] of [
      [undefined, 0.85],
      [0.85, 0.85],
      [1, 0.85],
      [1.15, 1],
      [1.3, 1.15],
      [1.5, 1.3],
    ] as const) {
      const state = initialState();
      beginSession(state, 'recognition', Date.now());
      Object.assign(state.prefs, { typographyVersion: 2, fontScale: before });
      const restored = validateBackup(JSON.parse(JSON.stringify(state)));
      expect(restored.prefs.fontScale).toBe(after);
      expect(restored.prefs.typographyVersion).toBe(3);
      expect(restored.tasks).toEqual(state.tasks);
      expect(restored.session).toEqual(state.session);
      // Rebased once: loading the v3 state again keeps the size.
      expect(validateBackup(restored).prefs.fontScale).toBe(after);
    }
  });
  it('rejects unknown typography versions instead of resetting their size', () => {
    for (const version of [1, 4, null, '2', '3']) {
      const state = initialState();
      Object.assign(state.prefs, { typographyVersion: version });
      expect(() => validateBackup(state)).toThrow();
    }
  });
});

describe('card input capabilities and directional regions', () => {
  it('recognizes touch on phones and hybrid PCs without relying on their user agent', () => {
    expect(touchCapable(0, false)).toBe(false);
    expect(touchCapable(10, false)).toBe(true);
    expect(touchCapable(0, true)).toBe(true);
  });
  it('maps card edges consistently on wide and tall cards and leaves the center neutral', () => {
    for (const [w, h] of [
      [620, 420],
      [340, 600],
    ]) {
      expect(cardRegion(w * 0.05, h * 0.5, w, h)).toBe(0);
      expect(cardRegion(w * 0.95, h * 0.5, w, h)).toBe(1);
      expect(cardRegion(w * 0.5, h * 0.05, w, h)).toBe(2);
      expect(cardRegion(w * 0.5, h * 0.95, w, h)).toBe(3);
      expect(cardRegion(w * 0.5, h * 0.5, w, h)).toBeNull();
    }
    expect(cardRegion(-1, 0, 340, 600)).toBeNull();
    expect(cardRegion(0, 0, 0, 0)).toBeNull();
  });
});

describe('speech source describes the actual provider and selected voice', () => {
  const prefs = { ...initialState().prefs, speechEngine: 'browser' as const, voice: '' };
  const voices = [
    { name: 'Thomas', lang: 'fr-FR', localService: true },
    { name: 'Online French', lang: 'fr-CA', localService: false },
  ];
  it('keeps browser device voices distinct from direct system speech', () => {
    expect(speechSource(prefs, false, true, voices)).toEqual({
      engine: 'browser',
      location: 'device',
    });
    expect(speechSource({ ...prefs, voice: 'Online French' }, false, false, voices).location).toBe(
      'online',
    );
    expect(speechSource(prefs, false, false, [{ name: 'French', lang: 'fr' }]).location).toBe(
      'unknown',
    );
    expect(speechSource(prefs, false, false, [])).toEqual({
      engine: 'browser',
      location: 'unavailable',
    });
  });
  it('reports Mac/iOS system speech and correctly falls back when the Mac service is absent', () => {
    expect(speechSource({ ...prefs, speechEngine: 'mac' }, false, true, voices).engine).toBe('mac');
    expect(speechSource({ ...prefs, speechEngine: 'mac' }, false, false, voices).engine).toBe(
      'browser',
    );
    expect(speechSource(prefs, true, false, voices).engine).toBe('ios');
  });
  it('uses the same case-insensitive voice resolution for playback and provenance', () => {
    expect(selectVoice(voices, 'Online French')?.name).toBe('Online French');
    expect(selectVoice(voices, 'Unavailable voice')?.name).toBe('Thomas');
    expect(selectVoice([{ name: 'French', lang: 'FR-ca' }], '')?.name).toBe('French');
    expect(selectVoice([{ name: 'English', lang: 'en-US' }], '')).toBeUndefined();
  });
});

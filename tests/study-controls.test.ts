import { describe, expect, it } from 'vitest';
import { initialState } from '../src/domain/seed';
import { beginSession, buildQueue, shuffled } from '../src/domain/learning';
import { validateBackup } from '../src/domain/import-export';
import { autoSpeechEnabled } from '../src/domain/study-preferences';
import {
  arrowDirection,
  cardControls,
  confirmedSwipe,
  parseBoundedInt,
} from '../src/platform/input';
import { applyCorrections, inkOffsets, snapToPixel } from '../src/app/ink';
import { pushRecent } from '../src/app/recent';
import { letterOf } from '../src/domain/dictionary';

describe('new-word order and resumable sessions', () => {
  it('shuffles the entire unseen pool before applying limits, retaining due priority and unique tasks', () => {
    const at = Date.now(),
      s = initialState(at);
    s.prefs.newLimit = 2;
    s.prefs.sessionLimit = 3;
    const due = s.tasks.at(-1)!;
    due.learnedAt = at - 86400000;
    due.card.due = at - 1000;
    const before = structuredClone(s);
    expect(buildQueue(s, 'recognition', at)).toEqual([due.id, s.tasks[0].id, s.tasks[1].id]);
    s.prefs.newWordOrder = 'shuffle';
    const result = buildQueue(s, 'recognition', at, '', () => 0);
    expect(result[0]).toBe(due.id);
    expect(result.slice(1)).toEqual([s.tasks[1].id, s.tasks[2].id]);
    expect(new Set(result).size).toBe(3);
    expect(s.tasks).toEqual(before.tasks);
    expect(s.entries).toEqual(before.entries);
  });
  it('preserves the actual randomized queue in a backup when preferences change', () => {
    const s = initialState();
    s.prefs.newWordOrder = 'shuffle';
    beginSession(s, 'recognition', Date.now());
    const queue = [...s.session!.queue];
    s.prefs.newWordOrder = 'list';
    expect(validateBackup(JSON.parse(JSON.stringify(s))).session!.queue).toEqual(queue);
  });
  it('returns a permutation without mutating source arrays', () => {
    const source = [1, 2, 3, 4, 5];
    expect(shuffled(source, () => 0)).toEqual([2, 3, 4, 5, 1]);
    expect(source).toEqual([1, 2, 3, 4, 5]);
  });
});
describe('speech switches are independent', () => {
  it('defaults all phases to manual and never speaks a non-French production question', () => {
    const p = initialState().prefs;
    for (const d of ['recognition', 'production'] as const)
      for (const reveal of [false, true]) expect(autoSpeechEnabled(p, d, reveal)).toBe(false);
    p.autoSpeakQuestion = true;
    expect(autoSpeechEnabled(p, 'recognition', false)).toBe(true);
    expect(autoSpeechEnabled(p, 'production', false)).toBe(false);
    expect(autoSpeechEnabled(p, 'recognition', true)).toBe(false);
  });
  it.each(['recognition', 'production'] as const)(
    'enables only the %s answer when its switch is on',
    (direction) => {
      const p = initialState().prefs;
      p[direction === 'recognition' ? 'autoSpeakRecognitionAnswer' : 'autoSpeakProductionAnswer'] =
        true;
      expect(autoSpeechEnabled(p, direction, true)).toBe(true);
      expect(autoSpeechEnabled(p, direction, false)).toBe(false);
      expect(
        autoSpeechEnabled(p, direction === 'recognition' ? 'production' : 'recognition', true),
      ).toBe(false);
    },
  );
});
describe('input defaults and compatibility', () => {
  it('uses device defaults for older backups without changing their learning records', () => {
    const s = initialState(),
      restored = validateBackup(JSON.parse(JSON.stringify(s)));
    expect(cardControls(restored.prefs, true)).toEqual({
      swipe: true,
      grid: false,
      buttons: false,
    });
    expect(cardControls(restored.prefs, false)).toEqual({
      swipe: false,
      grid: true,
      buttons: true,
    });
    expect(restored.tasks).toEqual(s.tasks);
  });
  it('preserves explicit controls, recovering a usable method when a partial override crosses platforms', () => {
    const s = initialState();
    Object.assign(s.prefs, { swipeEnabled: true, gridEnabled: false, buttonsEnabled: false });
    const p = validateBackup(JSON.parse(JSON.stringify(s))).prefs;
    expect(cardControls(p, false)).toEqual({ swipe: true, grid: false, buttons: false });
    expect(cardControls({ ...p, swipeEnabled: false, gridEnabled: undefined }, true)).toEqual({
      swipe: false,
      grid: false,
      buttons: true,
    });
  });
  it('rejects malformed preference values and explicit disabling of every input method', () => {
    for (const key of [
      'shuffleNewWords',
      'autoSpeakQuestion',
      'autoSpeakRecognitionAnswer',
      'autoSpeakProductionAnswer',
      'swipeEnabled',
      'gridEnabled',
      'buttonsEnabled',
    ]) {
      const s = initialState();
      Object.assign(s.prefs, { [key]: 'true' });
      expect(() => validateBackup(s)).toThrow();
    }
    const s = initialState();
    Object.assign(s.prefs, { swipeEnabled: false, gridEnabled: false, buttonsEnabled: false });
    expect(() => validateBackup(s)).toThrow();
  });
  it('maps every arrow to its direction, then uses the user rating mapping', () => {
    const map = [4, 2, 1, 3];
    expect(
      ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].map((key) => map[arrowDirection(key)!]),
    ).toEqual([4, 2, 1, 3]);
    expect(arrowDirection('1')).toBeNull();
    expect(arrowDirection('constructor')).toBeNull();
  });
});
describe('deliberate swipe confirmation', () => {
  it('rejects former short thresholds, very quick drags, diagonals and return-to-origin releases', () => {
    expect(confirmedSwipe(100, 0, 330, 440, 300)).toBeNull();
    expect(confirmedSwipe(170, 0, 330, 440, 80)).toBeNull();
    expect(confirmedSwipe(150, 100, 330, 440, 300)).toBeNull();
    expect(confirmedSwipe(5, 0, 330, 440, 600)).toBeNull();
    expect(confirmedSwipe(NaN, 0, 330, 440, 300)).toBeNull();
  });
  it('accepts deliberate release in all four directions, with card-size-aware distances', () => {
    expect(confirmedSwipe(-150, 0, 330, 440, 180)).toBe(0);
    expect(confirmedSwipe(150, 0, 330, 440, 180)).toBe(1);
    expect(confirmedSwipe(0, -150, 330, 440, 180)).toBe(2);
    expect(confirmedSwipe(0, 150, 330, 440, 180)).toBe(3);
    expect(confirmedSwipe(150, 0, 620, 420, 180)).toBeNull();
    expect(confirmedSwipe(185, 0, 620, 420, 180)).toBe(1);
  });
});

describe('settings number fields', () => {
  it('clamps typed whole numbers and keeps the old value for empty or invalid text', () => {
    expect(parseBoundedInt('15', 1, 200)).toBe(15);
    expect(parseBoundedInt(' 7 ', 1, 200)).toBe(7);
    expect(parseBoundedInt('999', 1, 200)).toBe(200);
    expect(parseBoundedInt('0', 1, 200)).toBe(1);
    expect(parseBoundedInt('0', 0, 100)).toBe(0);
    for (const text of ['', ' ', '-3', '1.5', 'abc', '1e2'])
      expect(parseBoundedInt(text, 1, 200)).toBeNull();
  });
});

describe('reveal ink offsets', () => {
  it('pushes letters out from the centre of their own line, symmetrically', () => {
    const offsets = inkOffsets(
      [{ line: 0 }, { line: 0 }, { line: 0 }, { line: 1 }, { line: 1 }],
      10,
    );
    expect(offsets).toEqual([-10, 0, 10, -5, 5]);
  });
  it('leaves a single letter in place', () => {
    expect(inkOffsets([{ line: 0 }], 10)).toEqual([0]);
  });
});

describe('reveal ink calibration', () => {
  const letter = (ch: string, x: number, line: number, index: number) => ({
    ch,
    x,
    y: line * 80,
    dx: 0,
    line,
    index,
  });
  it('moves each letter onto the real text and lets a hyphen follow its line', () => {
    const letters = [letter('a', 0, 0, 0), letter('b', 30, 0, 1), letter('-', 60, 0, -1)];
    const fixed = applyCorrections(letters, [{ dx: 0.5, dy: 2 }, { dx: -0.25, dy: 2 }, null]);
    expect(fixed.map((l) => [l.x, l.y])).toEqual([
      [0.5, 2],
      [29.75, 2],
      [59.75, 2],
    ]);
  });
  it('leaves letters unchanged when nothing could be measured', () => {
    const letters = [letter('a', 0, 0, 0)];
    expect(applyCorrections(letters, [null])).toEqual(letters);
  });
});

describe('reveal ink pixel snapping', () => {
  it('places letters on whole device pixels', () => {
    expect(snapToPixel(12.37, 3)).toBeCloseTo(12.333, 3);
    expect(snapToPixel(12.37, 2)).toBe(12.5);
    expect(snapToPixel(12.37, 1)).toBe(12);
    expect(snapToPixel(12.37, 0)).toBe(12);
  });
});
describe('dictionary browsing helpers', () => {
  it('keeps recent lookups newest first, without repeats, up to the limit', () => {
    expect(pushRecent(['b', 'a'], 'c')).toEqual(['c', 'b', 'a']);
    expect(pushRecent(['b', 'a', 'c'], 'a')).toEqual(['a', 'b', 'c']);
    expect(pushRecent(['b', 'a'], 'c', 2)).toEqual(['c', 'b']);
  });
  it('files headwords under their base letter', () => {
    expect(letterOf('abaissé')).toBe('A');
    expect(letterOf('Été')).toBe('E');
    expect(letterOf('œuvre')).toBe('O');
    expect(letterOf('ægide')).toBe('A');
    expect(letterOf("l'eau")).toBe('L');
    expect(letterOf('123')).toBe('#');
  });
});

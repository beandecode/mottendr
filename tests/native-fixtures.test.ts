import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { setContent } from '../src/content/files';
import type { WordListFile } from '../src/content/files';
import {
  emptyCard,
  preview,
  recall,
  schedulerParameters,
  SCHEDULER_VERSION,
} from '../src/scheduler';
import type { AppState, Entry, StoredCard } from '../src/domain/types';
import { initialState, starterEntries } from '../src/domain/seed';
import { freshLearningState } from '../src/domain/builtin';
import {
  addDays,
  availableTasks,
  dailyCounts,
  dayKey,
  dueForecast,
  ensureTasks,
  entryProgress,
  entryProgresses,
  entryTag,
  entryTask,
  progressBreakdown,
  setEntryFlag,
  streak,
  weekStart,
  weekStats,
  beginSession,
  stats,
  buildQueue,
  commitAnswer,
  promotePending,
  skipTask,
  undoLast,
} from '../src/domain/learning';
import {
  applyPatches,
  canRevert,
  diffContent,
  inversePatches,
  resolveEntry,
  reviewPatches,
  setAtPath,
  splitEntry,
} from '../src/domain/layers';
import { isSpecial, primaryDefinition, sensesOf, shortDefinition } from '../src/domain/lexicon';
import { scopeOptions } from '../src/domain/collections';
import { displayConjugation } from '../src/domain/conjugations';
import { cardSense, frenchDisplay } from '../src/domain/headword';
import { collectionOf } from '../src/domain/collections';
import {
  cardControls,
  cardRegion,
  confirmedSwipe,
  swipeDirection,
  swipeThreshold,
} from '../src/platform/input';
import { autoSpeechEnabled } from '../src/domain/study-preferences';
import { inkOffsets } from '../src/app/ink';
import {
  addDictionaryEntry,
  dictionaryEntry,
  dictionaryForEntry,
  learnedDictionaryEntry,
  learningDictionaryIndex,
  letterOf,
  lookupDictionary,
  lookupKey,
  recordMeanings,
  searchFold,
  type DictionaryRecord,
} from '../src/domain/dictionary';
import { nativeContentRows } from '../src/content/native-content';
import { referenceSearch } from './native-dictionary-reference';
import { localeFor } from '../src/domain/types';
import { backupOf, stateFromBackup } from '../src/domain/user-data';
import {
  validateAnnotation,
  validateIssue,
  validateLogRecord,
  validatePatchDoc,
  validateReviewItem,
} from '../src/domain/user-layer';
import { validateEntry } from '../src/domain/validation';
import { exportTsv, mergeBackup, validateBackup } from '../src/domain/import-export';
import { packEntries } from '../src/domain/pack';
import { content } from '../src/content/files';
import { addIssue } from '../src/domain/issues';
import { importProgressReference } from './native-progress-import';

// Golden data for the native app (native/testing-and-fixtures.md): the TypeScript logic runs on fixed inputs
// and writes its results to native/MottendrCore/Tests/MottendrCoreTests/Fixtures. The Swift port
// (N1) must reproduce every case. Plain `pnpm test` fails when the logic changed without a
// re-export; `pnpm fixtures:export` rewrites the files.
//
// Everything that varies is pinned: the time zone, Math.random, crypto.randomUUID, the clock
// (every call gets an explicit time) and the word pack (a tiny synthetic one, never content/).

const TZ = 'Europe/Paris';
const DIR = fileURLToPath(
  new URL('../native/MottendrCore/Tests/MottendrCoreTests/Fixtures/', import.meta.url),
);
// 2026-10-27 09:00 in Paris (UTC+1); the clocks changed on 2026-10-25.
const T0 = Date.UTC(2026, 9, 27, 8, 0, 0);
const MINUTE = 60_000,
  HOUR = 60 * MINUTE,
  DAY = 24 * HOUR;

// mulberry32: a small seeded generator, easy to port if a test ever needs it.
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
let uuidCounter = 0,
  randomCalls = 0,
  randomSeed = 0;
const stubRandomness = (seed: number) => {
  uuidCounter = 0;
  randomCalls = 0;
  randomSeed = seed;
  const next = seeded(seed);
  vi.spyOn(Math, 'random').mockImplementation(() => {
    randomCalls++;
    return next();
  });
  vi.stubGlobal('crypto', {
    randomUUID: () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}`,
  });
};

// Where the random sources stand when a case starts, so the Swift port can reproduce them: the
// mulberry32 stream with its seed (after `consumed` draws) and the UUID counter (the next id is
// `consumed + 1`, written as 00000000-0000-4000-8000-<12 digits>).
const sources = () => ({
  random: { kind: 'mulberry32', seed: randomSeed, consumed: randomCalls },
  ids: { kind: 'counter', consumed: uuidCounter },
});

// Undefined dropped, as JSON does. Keys keep their insertion order: patch order depends on it, and a rerun
// is still byte-identical because the order is deterministic.
const canon = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canon)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, canon(v)]),
        )
      : value;
const plain = <T>(value: T): T => canon(JSON.parse(JSON.stringify(value))) as T;

const compare = {
  parsedValues:
    'compare parsed JSON values, not bytes (the Foundation encoder writes 1e-07 where JS writes 1e-7)',
  exact: 'integers, timestamps, state, due, reps, lapses, ids, queues, strings',
  tolerance:
    'stability and difficulty: absolute 1e-8 (ts-fsrs rounds with Math.round(x * 1e8) / 1e8); recall: relative 1e-12',
  absentKeys: 'a missing key is not null (for example last_review on a new card)',
  structural: 'compare previews and states structurally, never through JSON.stringify (key order)',
};
const fixtureText = (
  source: string,
  cases: { name: string; input: unknown; expected: unknown }[],
) => JSON.stringify(canon({ schema: 1, source, tz: TZ, compare, cases }), null, 2) + '\n';

// A small pack standing in for content/word-list: the first starter entries under built-in IDs.
const packFile = (): WordListFile => {
  const entries = starterEntries(T0)
    .slice(0, 6)
    .map((e, i) => {
      const id = `word-list-${String(i + 1).padStart(4, '0')}`;
      const sourceStatus = i === 1 || i === 2 ? 'ai' : e.sourceStatus;
      return { ...e, id, relations: [], contentVersion: 2, sourceStatus } as Entry;
    });
  return {
    version: 7,
    entries,
    senseOrigins: {},
    editions: {},
    frequency: Object.fromEntries(entries.map((e, i) => [e.id, entries.length - i])),
    retired: { entries: {}, senses: {} },
  };
};

beforeAll(() => {
  process.env.TZ = TZ;
  setContent('word-list', packFile());
});
afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('native fixtures', () => {
  it('pack', async () => {
    // The word pack the backup, state and frequency-order cases run against.
    const text =
      JSON.stringify(
        canon({ schema: 1, source: 'src/content/files.ts', tz: TZ, pack: packFile() }),
        null,
        2,
      ) + '\n';
    await expect(text).toMatchFileSnapshot(`${DIR}pack.json`);
  });

  it('scheduler', async () => {
    const sequences: { name: string; retention: number; ratings: (1 | 2 | 3 | 4)[] }[] = [
      { name: 'steady good', retention: 0.9, ratings: [3, 3, 3, 3, 3] },
      { name: 'lapse then recovery', retention: 0.9, ratings: [1, 3, 4, 1, 3, 3] },
      { name: 'hard and good mix', retention: 0.85, ratings: [2, 2, 3, 1, 4, 3] },
      { name: 'easy start', retention: 0.95, ratings: [4, 4, 3, 2] },
    ];
    const cases = sequences.map(({ name, retention, ratings }) => {
      let card: StoredCard = emptyCard(T0);
      let at = T0;
      const steps: unknown[] = [];
      for (const rating of ratings) {
        const options = preview(card, at, retention);
        const next = options[rating];
        steps.push({
          at,
          rating,
          previews: options,
          card: next,
          recallBefore: recall(card, at, retention),
        });
        card = next;
        at = Math.max(card.due, at + MINUTE);
      }
      return {
        name,
        input: { retention, start: T0, startCard: emptyCard(T0), ratings },
        expected: {
          steps,
          recallLater: [1, 7, 30].map((d) => ({
            at: at + d * DAY,
            value: recall(card, at + d * DAY, retention),
          })),
          schedulerVersion: SCHEDULER_VERSION,
          parameters: schedulerParameters(retention),
        },
      };
    });
    await expect(fixtureText('src/scheduler/index.ts', plain(cases))).toMatchFileSnapshot(
      `${DIR}scheduler.json`,
    );
  });

  it('learning', async () => {
    type Op =
      | { op: 'begin'; at: number; scope?: string }
      | { op: 'answer'; at: number; eventId: string; rating?: 1 | 2 | 3 | 4; previewAt?: number }
      | { op: 'skip'; at: number }
      | { op: 'undo'; at: number }
      | { op: 'promote'; at: number }
      | { op: 'drain'; at: number };
    const scenarios: {
      name: string;
      prefs?: Partial<AppState['prefs']>;
      ops: Op[];
    }[] = [
      {
        name: 'first reading, short-term review, undo and skip',
        prefs: { newLimit: 3, sessionLimit: 5 },
        ops: [
          { op: 'begin', at: T0 },
          { op: 'answer', at: T0, eventId: 'e1' },
          { op: 'answer', at: T0 + MINUTE, eventId: 'e2' },
          { op: 'undo', at: T0 + MINUTE },
          { op: 'skip', at: T0 + 2 * MINUTE },
          { op: 'drain', at: T0 + 3 * MINUTE },
          {
            op: 'answer',
            at: T0 + 3 * MINUTE,
            eventId: 'e3',
            rating: 3,
            previewAt: T0 + 3 * MINUTE,
          },
        ],
      },
      {
        name: 'continuous learning keeps a small active set',
        prefs: {
          newLimit: 4,
          sessionLimit: 10,
          continuousLearning: true,
          activeTaskLimit: 2,
          refillLimit: 1,
        },
        ops: [
          { op: 'begin', at: T0 },
          { op: 'answer', at: T0, eventId: 'c1' },
          { op: 'answer', at: T0 + MINUTE, eventId: 'c2' },
          { op: 'drain', at: T0 + 2 * MINUTE },
          {
            op: 'answer',
            at: T0 + 2 * MINUTE,
            eventId: 'c3',
            rating: 2,
            previewAt: T0 + 2 * MINUTE,
          },
          { op: 'skip', at: T0 + 3 * MINUTE },
        ],
      },
      {
        name: 'review the next day',
        prefs: { newLimit: 2, sessionLimit: 5 },
        ops: [
          { op: 'begin', at: T0 },
          { op: 'answer', at: T0, eventId: 'd1' },
          { op: 'answer', at: T0 + MINUTE, eventId: 'd2' },
          { op: 'begin', at: T0 + DAY },
          { op: 'answer', at: T0 + DAY, eventId: 'd3', rating: 3, previewAt: T0 + DAY },
        ],
      },
    ];
    const cases = scenarios.map(({ name, prefs, ops }) => {
      stubRandomness(20261027);
      const state = initialState(T0);
      state.entries = state.entries.slice(0, 6);
      state.tasks = [];
      Object.assign(state.prefs, prefs);
      const start = plain(state);
      const src = sources();
      const steps: unknown[] = [];
      for (const op of ops) {
        let error: string | undefined;
        try {
          if (op.op === 'begin') beginSession(state, 'recognition', op.at, op.scope ?? '');
          else if (op.op === 'skip') skipTask(state, op.at);
          else if (op.op === 'undo') undoLast(state, op.at);
          else if (op.op === 'promote') promotePending(state, op.at);
          else if (op.op === 'drain') {
            // As the app's tests do: nothing left in the queue, so waiting cards come back.
            state.session!.queue = [];
            promotePending(state, op.at);
          } else {
            const id = state.session!.queue[0];
            const task = state.tasks.find((t) => t.id === id)!;
            const options = op.rating
              ? preview(task.card, op.previewAt!, state.prefs.retention)
              : undefined;
            commitAnswer(state, id, op.eventId, op.at, 1500, op.rating, options, op.previewAt);
          }
        } catch (e) {
          error = (e as Error).message;
        }
        steps.push(
          plain({
            op,
            error,
            session: state.session,
            tasks: state.tasks.filter(
              (t) => t.learnedAt !== undefined || state.session?.queue.includes(t.id),
            ),
            lastEvent: state.events.at(-1),
            eventCount: state.events.length,
            voided: state.events.filter((e) => e.voidedAt).map((e) => e.id),
          }),
        );
      }
      return { name, input: { state: start, ops, ...src }, expected: { steps } };
    });
    // Queue building on its own, with and without frequency order (word-list entries).
    stubRandomness(7);
    const queues = (['list', 'shuffle', 'frequency'] as const).map((order) => {
      stubRandomness(99);
      const state = initialState(T0);
      state.entries = [...packEntries().values()].map((e) => structuredClone(e));
      state.tasks = [];
      state.prefs.newWordOrder = order;
      state.prefs.newLimit = 4;
      beginSession(state, 'recognition', T0);
      const input = plain(state);
      stubRandomness(99);
      const src = sources();
      const queue = buildQueue(state, 'recognition', T0);
      return {
        name: `queue order ${order}`,
        input: { state: input, at: T0, ...src },
        expected: { queue },
      };
    });
    await expect(
      fixtureText('src/domain/learning.ts', plain([...cases, ...queues])),
    ).toMatchFileSnapshot(`${DIR}learning.json`);
  });

  it('layers', async () => {
    // Each scenario edits a copy of a built-in entry; the fixture records the patches, annotation and
    // what resolving them gives back, plus the undo path and a review against a changed built-in entry.
    const starters = starterEntries(T0);
    const rich =
      starters.find(
        (e) => sensesOf(e).length > 1 && sensesOf(e).some((s) => s.examples.length > 0),
      ) ?? starters[0];
    const scenarios: {
      name: string;
      base: Entry;
      change: (e: Entry) => void;
      pack?: (b: Entry) => void;
    }[] = [
      {
        name: 'edit one entry',
        base: starters[0],
        change: (e) => {
          e.tags = [...e.tags, 'Mine'];
          e.updatedAt = T0 + 1;
          const sense = sensesOf(e)[0];
          sense.definitions.zh.short = `${sense.definitions.zh.short}（改）`;
          const extra = structuredClone(sense.examples[0]);
          extra.id = `${sense.id}:example:2`;
          extra.text = 'Un deuxième exemple.';
          sense.examples = [...sense.examples, extra];
        },
      },
      {
        name: 'remove an example and a sense, add a collocation',
        base: rich,
        change: (e) => {
          const senses = sensesOf(e);
          senses[0].examples = senses[0].examples.slice(1);
          e.groups[0].senses = e.groups[0].senses.slice(0, -1);
          const first = e.groups[0].senses[0];
          first.collocations = [
            ...first.collocations,
            {
              id: `${first.id}:col:1`,
              text: 'une locution',
              translations: { zh: '短语', en: 'a phrase' },
            },
          ];
        },
      },
      {
        name: 'reorder the examples (the list is replaced)',
        base: rich,
        change: (e) => {
          const sense = sensesOf(e).find((s) => s.examples.length > 1);
          if (sense) sense.examples = [...sense.examples].reverse();
          else sensesOf(e)[0].definitions.en.short = 'reordered fallback';
        },
      },
      {
        name: 'unset an optional key and set a new one',
        base: { ...starters[0], importBatchId: 'batch-1', dictionaryRefs: ['dict:1', 'dict:2'] },
        change: (e) => {
          e.headword = { number: 'singular', elision: 'no' };
          delete (e as Partial<Entry>).importBatchId;
          e.ipa = '';
        },
      },
      {
        name: 'tags: added and hidden',
        base: { ...starters[0], tags: ['A', 'B', 'C'] },
        change: (e) => {
          e.tags = ['A', 'C', 'New'];
        },
      },
      {
        name: 'tags: reordered, so the full list is kept',
        base: { ...starters[0], tags: ['A', 'B', 'C'] },
        change: (e) => {
          e.tags = ['C', 'A', 'B'];
        },
      },
      {
        name: 'annotation fields',
        base: starters[0],
        change: (e) => {
          e.favorite = true;
          e.suspended = true;
          e.archived = true;
          e.localizedNotes = { zh: '备注', en: 'a note' };
          e.cardDisplay = { senseIds: [sensesOf(e)[0].id] };
        },
      },
      {
        name: 'card display removed again',
        base: { ...starters[0], cardDisplay: { senseIds: [sensesOf(starters[0])[0].id] } },
        change: (e) => {
          delete (e as Partial<Entry>).cardDisplay;
        },
      },
      {
        name: 'edit against a built-in value that changed meanwhile',
        base: starters[0],
        change: (e) => {
          sensesOf(e)[0].definitions.zh.short = 'mon édition';
        },
        pack: (b) => {
          sensesOf(b)[0].definitions.zh.short = 'le pack a changé';
        },
      },
      {
        name: 'own example added; the pack later rewrites other fields and bumps the version',
        base: rich,
        change: (e) => {
          const sense = sensesOf(e).find((s) => s.examples.length > 0) ?? sensesOf(e)[0];
          const extra = structuredClone(sense.examples[0] ?? sense.collocations[0]);
          extra.id = `${sense.id}:example:own1`;
          extra.text = 'Mon exemple à moi.';
          sense.examples = [...sense.examples, extra];
        },
        pack: (b) => {
          b.contentVersion += 1;
          b.updatedAt += 1;
          sensesOf(b)[0].definitions.zh.short = 'le pack a réécrit la définition';
        },
      },
      {
        name: 'own example added; the pack removes that sense',
        base: rich,
        change: (e) => {
          const sense = sensesOf(e)[0];
          const extra = structuredClone(sense.examples[0] ?? sense.collocations[0]);
          extra.id = `${sense.id}:example:own2`;
          extra.text = 'Un exemple dans un sens disparu.';
          sense.examples = [...sense.examples, extra];
        },
        pack: (b) => {
          b.groups[0].senses = b.groups[0].senses.slice(1);
        },
      },
      {
        name: 'own tag, note and card display together with an own example',
        base: rich,
        change: (e) => {
          const sense = sensesOf(e)[0];
          const extra = structuredClone(sense.examples[0] ?? sense.collocations[0]);
          extra.id = `${sense.id}:example:own3`;
          extra.text = 'Trois choses à la fois.';
          sense.examples = [...sense.examples, extra];
          e.tags = [...e.tags, 'Mine'];
          e.localizedNotes = { zh: '我的笔记', en: '' };
          e.cardDisplay = { senseIds: [sense.id] };
        },
        pack: (b) => {
          b.tags = [...b.tags, 'FromPack'];
        },
      },
      {
        name: 'own example deleted again',
        base: { ...rich },
        change: (e) => {
          const sense = sensesOf(e)[0];
          sense.examples = sense.examples.slice(0, -1);
        },
      },
      {
        name: 'edit whose target the pack removed',
        base: rich,
        change: (e) => {
          sensesOf(e)[0].definitions.en.short = 'my wording';
        },
        pack: (b) => {
          b.groups[0].senses = b.groups[0].senses.slice(1);
        },
      },
    ];
    const cases = scenarios.map(({ name, base, change, pack }) => {
      const edited = structuredClone(base);
      change(edited);
      const patches = diffContent(base, edited);
      const applied = structuredClone(base);
      const applyOk = applyPatches(applied, patches);
      const inverse = inversePatches(patches);
      const reverted = structuredClone(edited);
      const revertOk = applyPatches(reverted, inverse);
      const { doc, annotation } = splitEntry(base, edited);
      const resolved = resolveEntry(base, doc, annotation);
      const newBase = structuredClone(base);
      pack?.(newBase);
      return {
        name,
        input: { base, edited, packBase: newBase },
        expected: {
          patches,
          applyOk,
          applied,
          inverse,
          revertOk,
          reverted,
          canRevertEdited: canRevert(edited, patches),
          canRevertBase: canRevert(base, patches),
          doc,
          annotation,
          resolved,
          review: doc ? reviewPatches(newBase, doc) : null,
          resolvedOnNewBase: resolveEntry(newBase, doc, annotation),
        },
      };
    });
    cases.push({
      name: 'no edit resolves to the base',
      input: { base: starters[0], edited: starters[0], packBase: starters[0] },
      expected: { resolved: resolveEntry(starters[0], null, null) } as never,
    });
    // setAtPath on a copy.
    const target = structuredClone(starters[0]);
    const sid = sensesOf(target)[0].id;
    const setResults = [
      setAtPath(target, ['word'], 'changé'),
      setAtPath(
        target,
        ['groups', { id: target.groups[0].id }, 'senses', { id: sid }, 'distance'],
        'close',
      ),
      setAtPath(target, ['groups', { id: 'missing' }, 'pos'], 'verb'),
      setAtPath(target, ['ipa'], undefined),
    ];
    cases.push({
      name: 'setAtPath',
      input: { base: starters[0], edited: starters[0], packBase: starters[0] },
      expected: { results: setResults, entry: target } as never,
    });
    await expect(fixtureText('src/domain/layers.ts', plain(cases))).toMatchFileSnapshot(
      `${DIR}layers.json`,
    );
  });

  it('dictionary', async () => {
    // A small dictionary standing in for content/dictionary: the rows the native build makes from it, and what the
    // PWA's own functions answer (lookups, folding, meanings, learned entries, search) for the same data.
    type Sense = { id: string; number: string; fr: string; zh: string[]; en: string[] };
    const sense = (zh: string[], en: string[], n = 1): Sense => ({
      id: `s${n}`,
      number: String(n),
      fr: '',
      zh,
      en,
    });
    const lex = (pos: string, gender: string, senses: Sense[], forms: string[] = []) => ({
      id: `l-${pos}-${gender}-${senses.length}`,
      pos,
      gender,
      ipa: [],
      senses,
      forms,
      sourceId: 'wikdict',
    });
    const rec = (
      id: string,
      word: string,
      aliases: string[],
      lexemes: ReturnType<typeof lex>[],
      pos?: string,
    ) => ({
      id: `dict:${id}`,
      word,
      aliases,
      lexemes,
      morphology: pos
        ? [
            {
              id: `m-${id}`,
              pos,
              gender: '',
              number: 'unknown',
              family: 'x',
              sourceId: 'demonette',
              forms: [],
              tables: [],
              pastParticiple: [],
              presentParticiple: [],
            },
          ]
        : [],
    });
    const records = [
      rec(
        'bonjour',
        'bonjour',
        [],
        [lex('interjection', '', [sense(['你好', '早上好'], ['hello', 'good morning'])])],
      ),
      rec('chat', 'chat', ['chatte'], [lex('noun', 'm', [sense(['猫'], ['cat'])])]),
      rec('chat2', 'Chat', [], [lex('noun', 'm', [sense([], ['tag (game)'])])]),
      rec('chateau', 'château', [], [lex('noun', 'm', [sense(['城堡'], ['castle', 'manor'])])]),
      rec('oeuvre', 'œuvre', [], [lex('noun', 'f', [sense(['作品'], ['work'])])]),
      rec('ecole', 'École', [], [lex('noun', 'f', [sense(['学校'], ['school'])])]),
      rec('maison', 'maison', [], [lex('noun', 'f', [sense(['房子', '家'], ['house', 'home'])])]),
      rec('merci', 'merci', [], [lex('interjection', '', [sense([], ['thank you'])])]),
      rec('eau', 'eau', [], [lex('noun', 'f', [sense(['水'], ['water'])])]),
      rec('aujourdhui', 'aujourd’hui', [], [lex('adverb', '', [sense(['今天'], ['today'])])]),
      rec('2000', '2000', [], [lex('noun', 'm', [sense(['两千'], ['two thousand'])])]),
      rec('ca', 'ça', [], [lex('pronoun', '', [sense(['这个'], ['that'])])]),
      rec('oeil', 'œil', [], [lex('noun', 'm', [sense(['眼睛'], ['eye'])])]),
      rec('mere', 'mère', [], [lex('noun', 'f', [sense(['母亲'], ['mother'])])]),
      rec(
        'cafe',
        'café',
        [],
        [
          lex('noun', 'm', [sense(['咖啡'], ['coffee'])]),
          lex('adjective', '', [sense([], ['coffee-coloured'])]),
        ],
      ),
      rec(
        'livre',
        'livre',
        [],
        [lex('noun', 'm', [sense(['书'], ['book'])]), lex('noun', 'f', [sense(['磅'], ['pound'])])],
      ),
      rec('ouvrir', 'ouvrir', [], [lex('verb', '', [sense(['打开'], ['open'])])], 'verb'),
      rec('asseoir', 's’asseoir', [], [lex('verb', '', [sense(['坐下'], ['sit down'])])], 'verb'),
      rec('etre', 'être', ['etre'], [lex('verb', '', [sense(['是'], ['be'])])], 'verb'),
    ] as DictionaryRecord[];
    const file = {
      records,
      manifest: { version: 'fixture', sources: [] },
      conflicts: [],
    };
    setContent('dictionary', file as never);
    const rows = nativeContentRows({ 'word-list': packFile(), dictionary: file as never });

    // The learner's entries: built-in ones (two reviewed by AI), their own, and one tied to a record by reference.
    const pack = [...packEntries().values()];
    const mine = (
      id: string,
      word: string,
      zh: string,
      en: string,
      status: Entry['sourceStatus'],
      extra: Partial<Entry> = {},
    ) => {
      const e = structuredClone(starterEntries(T0)[0]);
      e.id = id;
      e.word = word;
      e.sourceStatus = status;
      const s = sensesOf(e)[0];
      s.definitions.zh.short = zh;
      s.definitions.en.short = en;
      return Object.assign(e, { relations: [], ...extra }) as Entry;
    };
    const entries = [
      ...pack.map((e) => structuredClone(e)),
      mine('user-0001', 'maison', '我的房子', 'my house', 'user'),
      mine('user-0002', 'chat', '猫咪', 'kitty', 'user'),
      mine('user-0003', 'castle-fr', '古堡', 'old castle', 'imported', {
        dictionaryRefs: ['dict:chateau'],
      }),
    ];
    const state = initialState(T0);
    state.entries = entries;
    const none = initialState(T0);
    none.entries = [];
    const learnedKeys = (st: typeof state) => {
      const index = learningDictionaryIndex(st);
      return Object.fromEntries([...index.entries()].map(([k, e]) => [k, e.id]));
    };

    const search = (query: string, pos: string, mode: typeof state.prefs.mode, st: typeof state) =>
      referenceSearch(records, query, pos, mode, st);
    const queries = [
      'bon',
      'jour',
      'cha',
      'chat',
      'château',
      'chateau',
      'œuvre',
      'oeuvre',
      'ecole',
      'é',
      'eau',
      'l’',
      "d'hui",
      'aujourd',
      '2000',
      'ça',
      'ca',
      'hello',
      '你好',
      '房子',
      '我的',
      'house',
      'coffee',
      '猫咪',
      '古堡',
      'castle',
      'book',
      'mer',
      'etre',
      'xyz',
      '  CHAT ',
      'CHÂTEAU',
    ];
    const modes = ['zhOnly', 'enOnly', 'zhEnAssist'] as const;
    const searches = [];
    for (const [withLearned, st] of [
      [true, state],
      [false, none],
    ] as const)
      for (const mode of modes)
        for (const query of queries)
          searches.push({
            query,
            mode,
            pos: '',
            learned: withLearned,
            ords: search(query, '', mode, st),
          });
    for (const pos of ['noun', 'verb', 'adjective', 'interjection', 'adverb', 'pronoun'])
      for (const query of ['', 'ou', 'chat'])
        searches.push({
          query,
          mode: 'zhEnAssist',
          pos,
          learned: true,
          ords: search(query, pos, 'zhEnAssist', state),
        });

    const words = [
      'bonjour',
      'Bonjour',
      '  bonjour ',
      'BONJOUR',
      'chat',
      'Chat',
      'château',
      'chateau',
      'œuvre',
      'École',
      'école',
      'aujourd’hui',
      "aujourd'hui",
      'le chat',
      'la maison',
      'les chats',
      'un château',
      'des livres',
      'l’eau',
      "l'eau",
      'l’inconnu',
      'xyz',
      '',
      '2000',
      'être',
      'etre',
      'se laver',
      'café',
      'CAFÉ',
    ];
    const cases = [
      {
        name: 'dictionary',
        input: { rows, entries, words, queries },
        expected: {
          lookupKeys: words.map((w) => lookupKey(w)),
          folds: words.map((w) => searchFold(w)),
          letters: [...words, 'ß', 'Ǆ', 'æther', '9', '—', 'Éclair', 'Œil'].map((w) => letterOf(w)),
          lookups: words.map((w) => lookupDictionary(w)?.id ?? null),
          learnedKeys: learnedKeys(state),
          learnedForRecord: records.map((r) => learnedDictionaryEntry(state, r)?.id ?? null),
          forEntry: entries.map((e) => dictionaryForEntry(e)?.id ?? null),
          meanings: records.map((r) => ({
            id: r.id,
            plain: {
              zh: recordMeanings(r, undefined, 'zh'),
              en: recordMeanings(r, undefined, 'en'),
            },
            learned: (() => {
              const l = learnedDictionaryEntry(state, r);
              return l ? { zh: recordMeanings(r, l, 'zh'), en: recordMeanings(r, l, 'en') } : null;
            })(),
            limit1: recordMeanings(r, undefined, 'zh', 1),
          })),
          browse: [...rows.records].sort((a, b) => a.browse_rank - b.browse_rank).map((r) => r.ord),
          searches,
        },
      },
    ];
    await expect(fixtureText('src/domain/dictionary.ts', plain(cases))).toMatchFileSnapshot(
      `${DIR}dictionary.json`,
    );
  });

  it('backup', async () => {
    stubRandomness(5);
    const pack = packEntries();
    const state = initialState(T0);
    state.entries = [...pack.values()].map((e) => structuredClone(e));
    state.tasks = [];
    state.prefs.newLimit = 3;
    beginSession(state, 'recognition', T0);
    commitAnswer(state, state.session!.queue[0], 'b1', T0, 1000);
    // The learner edits one built-in entry and adds one of their own.
    const edited = state.entries[0];
    edited.tags = [...edited.tags, 'Mine'];
    state.entries.push({ ...starterEntries(T0)[1], id: 'user-0001', relations: [] } as Entry);
    const src = sources();
    const backup = backupOf(state, pack);
    const restored = stateFromBackup(structuredClone(backup), pack);
    const validated = validateBackup(structuredClone(backup));
    const current = initialState(T0);
    current.entries = [...pack.values()].slice(0, 2).map((e) => structuredClone(e));
    current.tasks = [];
    const incoming = structuredClone(validated);
    mergeBackup(current, incoming);
    const cases = [
      {
        name: 'state to backup to state',
        input: { state, packVersion: 7, ...src },
        expected: { backup, restored, validated },
      },
      {
        name: 'merge a backup into a smaller state',
        input: {
          current: { entries: [...pack.values()].slice(0, 2).map((e) => e.id) },
          incoming: validated,
        },
        expected: {
          entryIds: current.entries.map((e) => e.id),
          taskIds: current.tasks.map((t) => t.id),
          eventIds: current.events.map((e) => e.id),
        },
      },
      {
        name: 'tsv export',
        input: { entryIds: state.entries.map((e) => e.id) },
        expected: { tsv: exportTsv(state.entries) },
      },
    ];
    await expect(
      fixtureText('src/domain/user-data.ts, import-export.ts', plain(cases)),
    ).toMatchFileSnapshot(`${DIR}backup.json`);
  });

  it('state', async () => {
    stubRandomness(11);
    const state = initialState(T0);
    state.entries = [...packEntries().values()].map((e) => structuredClone(e));
    state.tasks = [];
    state.prefs.newLimit = 3;
    beginSession(state, 'recognition', T0);
    commitAnswer(state, state.session!.queue[0], 's1', T0, 1000);
    commitAnswer(state, state.session!.queue[0], 's2', T0 + MINUTE, 1000);
    state.session!.queue = [];
    promotePending(state, T0 + 2 * MINUTE);
    const id = state.session!.queue[0];
    const task = state.tasks.find((t) => t.id === id)!;
    commitAnswer(
      state,
      id,
      's3',
      T0 + 2 * MINUTE,
      1500,
      3,
      preview(task.card, T0 + 2 * MINUTE, 0.9),
      T0 + 2 * MINUTE,
    );
    const pack = packEntries();
    const cases = [
      {
        name: 'a realistic app state and its schemaVersion 3 backup',
        input: { at: T0 },
        expected: { state, backup: backupOf(state, pack) },
      },
    ];
    // A first run: no entries of the learner's own, the built-in collection installed, recognition tasks made.
    stubRandomness(13);
    const fresh = freshLearningState(T0);
    cases.push({
      name: 'a fresh install',
      input: { at: T0 },
      expected: { state: fresh, backup: backupOf(fresh, packEntries()) },
    } as never);
    await expect(
      fixtureText('src/domain/types.ts, user-layer.ts', plain(cases)),
    ).toMatchFileSnapshot(`${DIR}state.json`);
  });

  it('study', async () => {
    // How a card shows an entry (headword.ts, lexicon.ts, the card rules of StudyCard.tsx): which sense, the French
    // headword with its article, the definition, whether the card can be shown at all.
    const base = starterEntries(T0);
    const find = (word: string) => structuredClone(base.find((e) => e.word === word)!);
    const noun = (
      word: string,
      extra: Partial<Entry> = {},
      gender: 'm' | 'f' | '' = 'm',
      id = 'sample-x',
    ): Entry => {
      const e = find('maison');
      e.id = id;
      e.word = word;
      e.groups[0].gender = gender;
      return { ...e, ...extra } as Entry;
    };
    const headword = (
      number: 'singular' | 'plural' | 'unknown',
      elision: 'yes' | 'no' | 'unknown',
    ) => ({
      headword: { sourceForm: '', number, elision },
    });
    type Case = {
      name: string;
      entry: Entry;
      prefs?: { showArticles?: boolean; mode?: 'zhOnly' | 'zhEnAssist' | 'enOnly' };
      locale?: 'zh' | 'en';
      task?: {
        direction: 'recognition' | 'production';
        promptLanguage: 'fr' | 'zh' | 'en';
        learnedAt?: number | null;
      };
    };
    const sing = (
      w: string,
      gender: 'm' | 'f' = 'm',
      elision: 'yes' | 'no' | 'unknown' = 'unknown',
    ) => noun(w, headword('singular', elision) as never, gender);
    const withSenses = (e: Entry, edit: (e: Entry) => void) => {
      edit(e);
      return e;
    };
    const arrival = find('ensemble');
    const tour = noun('tour', headword('singular', 'no') as never, 'f');
    tour.groups[0].senses[0].gender = 'm';
    const cases: Case[] = [
      { name: 'feminine noun, article le/la known', entry: sing('maison', 'f', 'no') },
      { name: 'masculine noun, elision known', entry: sing('ami', 'm', 'yes') },
      { name: 'feminine noun elided: l’eau', entry: sing('eau', 'f', 'yes') },
      { name: 'plural: les', entry: noun('vacances', headword('plural', 'no') as never, 'f') },
      { name: 'no headword info: bare word', entry: noun('maison', {}, 'f') },
      {
        name: 'unknown number: bare word',
        entry: noun('maisons', headword('unknown', 'unknown') as never, 'f'),
      },
      { name: 'unknown elision, vowel: l’', entry: sing('école', 'f') },
      { name: 'unknown elision, accent vowel upper case', entry: sing('Écran') },
      { name: 'unknown elision, œ', entry: sing('œuf') },
      { name: 'unknown elision, consonant: le/la', entry: sing('livre') },
      { name: 'unknown elision, h stays bare', entry: sing('homme') },
      { name: 'unknown elision, upper case H stays bare', entry: sing('Hôtel') },
      { name: 'unknown elision, y stays bare', entry: sing('yaourt') },
      { name: 'unknown elision, onze takes le', entry: sing('onze') },
      { name: 'unknown elision, onzième takes le', entry: sing('onzième') },
      { name: 'unknown elision, onzièmes takes le', entry: sing('onzièmes') },
      { name: 'unknown elision, onzes takes le', entry: sing('onzes') },
      {
        name: 'unknown elision, onzeur: onze followed by letters is a plain vowel word',
        entry: sing('onzeur'),
      },
      { name: 'unknown elision, oui takes le', entry: sing('oui') },
      { name: 'unknown elision, ouistiti takes le', entry: sing('ouistiti') },
      { name: 'unknown elision, oui followed by a hyphen takes le', entry: sing('oui-oui') },
      { name: 'unknown elision, ouïe is a plain vowel word', entry: sing('ouïe', 'f') },
      { name: 'unknown elision, ouverture is a plain vowel word', entry: sing('ouverture', 'f') },
      { name: 'articles off', entry: sing('maison', 'f', 'no'), prefs: { showArticles: false } },
      {
        name: 'no overrides: this fixture’s defaults (articles on, Chinese)',
        entry: sing('maison', 'f', 'no'),
        prefs: {},
      },
      {
        name: 'noun without gender stays bare',
        entry: noun('maison', headword('singular', 'no') as never, ''),
      },
      { name: 'sense gender overrides the group (un tour)', entry: tour },
      {
        name: 'sense gender empty string overrides the group',
        entry: withSenses(structuredClone(tour), (e) => {
          e.groups[0].senses[0].gender = '' as never;
        }),
      },
      { name: 'pronominal verb stays bare', entry: find('s’appeler') },
      { name: 'verb stays bare', entry: find('parler') },
      { name: 'adverb then noun: the first group with a definition', entry: arrival },
      {
        name: 'noun group not first: no article (the card sense is the adverb)',
        entry: withSenses(structuredClone(arrival), (e) => {
          e.headword = { sourceForm: '', number: 'singular', elision: 'yes' } as never;
        }),
      },
      {
        name: 'chosen sense selects the second sense',
        entry: withSenses(find('livre'), (e) => {
          e.cardDisplay = { senseIds: [e.groups[0].senses[1].id] } as never;
        }),
      },
      {
        name: 'chosen sense in another group',
        entry: withSenses(structuredClone(arrival), (e) => {
          e.cardDisplay = { senseIds: [e.groups[1].senses[0].id] } as never;
          e.headword = { sourceForm: '', number: 'singular', elision: 'no' } as never;
        }),
      },
      {
        name: 'no English definition: the card cannot be shown in English',
        entry: withSenses(find('maison'), (e) => {
          e.groups[0].senses[0].definitions.en.short = '';
        }),
        locale: 'en',
        prefs: { mode: 'enOnly' },
      },
      {
        name: 'English locale',
        entry: sing('livre'),
        locale: 'en',
        prefs: { mode: 'enOnly', showArticles: true },
      },
      {
        name: 'whitespace-only Chinese definition',
        entry: withSenses(find('maison'), (e) => {
          e.groups[0].senses[0].definitions.zh.short = '  \u3000 ';
        }),
      },
      {
        name: 'definition with surrounding spaces is trimmed',
        entry: withSenses(find('maison'), (e) => {
          e.groups[0].senses[0].definitions.zh.short = '  房子；住宅 ';
        }),
      },
      {
        name: 'irregular note shown from the card group',
        entry: withSenses(find('être'), (e) => {
          e.groups[0].specialNotes = {
            zh: '最常见的不规则动词',
            en: 'The most common irregular verb',
          };
        }),
      },
      {
        name: 'production task prompted in the other language is incompatible',
        entry: find('maison'),
        task: { direction: 'production', promptLanguage: 'en' },
      },
      {
        name: 'production task prompted in the explanation language',
        entry: find('maison'),
        task: { direction: 'production', promptLanguage: 'zh' },
      },
      {
        name: 'recognition task ignores the prompt language',
        entry: find('maison'),
        task: { direction: 'recognition', promptLanguage: 'fr' },
      },
      {
        name: 'learned task',
        entry: find('maison'),
        task: { direction: 'recognition', promptLanguage: 'fr', learnedAt: T0 },
      },
      {
        name: 'learnedAt 0 counts as not learned',
        entry: find('maison'),
        task: { direction: 'recognition', promptLanguage: 'fr', learnedAt: 0 },
      },
      { name: 'first tag is the label', entry: find('maison') },
      {
        name: 'no tags: collection of a built-in id',
        entry: noun('maison', { tags: [] }, 'f', 'word-list-0007'),
      },
      {
        name: 'no tags: collection of a dictionary id',
        entry: noun('maison', { tags: [] }, 'f', 'dict:maison'),
      },
      {
        name: 'no tags: collection of the learner’s own entry',
        entry: noun('maison', { tags: [] }, 'f', 'user-0001'),
      },
    ];
    const out = cases.map((c) => {
      const prefs = { showArticles: true, mode: 'zhOnly' as const, ...c.prefs };
      const locale = c.locale ?? localeFor(prefs.mode);
      const task = c.task ?? { direction: 'recognition' as const, promptLanguage: 'fr' as const };
      const sense = cardSense(c.entry, locale);
      const short = primaryDefinition(c.entry, locale);
      return {
        name: c.name,
        input: { entry: c.entry, prefs: { ...c.prefs }, locale, task },
        expected: {
          cardSense: sense && {
            groupId: sense.group.id,
            pos: sense.group.pos,
            groupGender: sense.group.gender,
            senseId: sense.sense.id,
            senseGender: sense.sense.gender,
            short: sense.sense.definitions[locale].short.trim(),
            irregularNote: sense.group.specialNotes[locale] ?? '',
          },
          primaryDefinition: short,
          frenchDisplay: frenchDisplay(c.entry, prefs, locale),
          // StudyCard.tsx: no definition, or a production task prompted in another language.
          incompatible:
            !short.trim() || (task.direction === 'production' && task.promptLanguage !== locale),
          learned: Boolean((task as { learnedAt?: number | null }).learnedAt),
          tag: c.entry.tags[0] ?? collectionOf(c.entry),
        },
      };
    });
    await expect(
      fixtureText('src/domain/headword.ts, lexicon.ts, components/StudyCard.tsx', plain(out)),
    ).toMatchFileSnapshot(`${DIR}study.json`);
  });

  it('study rules', async () => {
    // The pure rules behind the study screen: which controls are on, how a drag is read, which grid cell was hit,
    // when speech starts by itself, how long until a card is due, how the ink letters spread, and today's numbers.
    const num = [0, 1, -1, 3, -3, 10, -10, 40, -40, 124.9, 125, 180, 300, -300, 0.5];
    const points = num.flatMap((x) => [0, 7, -7, 55, -200, 400].map((y) => [x, y]));
    const sizes = [
      [320, 480],
      [390, 640],
      [700, 900],
      [1000, 400],
    ];
    const intervals = [
      -5000, 0, 1000, 4499, 4500, 4999, 5000, 5400, 59_499, 59_500, 59_999, 60_000, 61_000, 119_999,
      120_000, 3_599_000, 3_600_000, 5_399_999, 5_400_000, 5_400_001, 86_399_000, 86_400_000,
      129_599_000, 129_600_000, 2_592_000_000,
    ];
    const prefsWith = (o: Record<string, unknown>) => ({ ...initialState(T0).prefs, ...o });
    const controlPrefs = [
      {},
      { swipeEnabled: true },
      { swipeEnabled: false },
      { swipeEnabled: false, gridEnabled: false, buttonsEnabled: false },
      { swipeEnabled: false, gridEnabled: true, buttonsEnabled: false },
      { swipeEnabled: true, gridEnabled: true, buttonsEnabled: true },
      { gridEnabled: false },
    ];
    const speechPrefs = [
      {},
      { autoSpeakQuestion: true },
      { autoSpeakRecognitionAnswer: true },
      { autoSpeakProductionAnswer: true },
      {
        autoSpeakQuestion: false,
        autoSpeakRecognitionAnswer: false,
        autoSpeakProductionAnswer: false,
      },
      {
        autoSpeakQuestion: true,
        autoSpeakRecognitionAnswer: true,
        autoSpeakProductionAnswer: true,
      },
    ];
    const lines = [[0, 0, 0], [0], [0, 0, 1, 1, 1, 2], [3, 3, 3, 3]];
    const cases: { name: string; input: unknown; expected: unknown }[] = [
      {
        name: 'swipeDirection',
        input: { points },
        expected: { results: points.map(([x, y]) => swipeDirection(x, y)) },
      },
      {
        name: 'swipeThreshold',
        input: { directions: [0, 1, 2, 3], sizes },
        expected: {
          results: [0, 1, 2, 3].flatMap((d) => sizes.map(([w, h]) => swipeThreshold(d, w, h))),
        },
      },
      {
        name: 'confirmedSwipe',
        input: {
          points,
          sizes,
          durations: [0, 119, 120, 600],
          odd: [
            [Number.NaN, 0, 300, 400, 200],
            [200, 0, 0, 400, 200],
            [200, 0, 300, -1, 200],
          ].map((a) => a.map((n) => (Number.isNaN(n) ? 'NaN' : n))),
        },
        expected: {
          results: sizes.flatMap(([w, h]) =>
            [0, 119, 120, 600].flatMap((d) =>
              points.map(([x, y]) => confirmedSwipe(x, y, w, h, d)),
            ),
          ),
          odd: [
            confirmedSwipe(Number.NaN, 0, 300, 400, 200),
            confirmedSwipe(200, 0, 0, 400, 200),
            confirmedSwipe(200, 0, 300, -1, 200),
          ],
        },
      },
      {
        name: 'cardRegion',
        input: {
          size: [300, 450],
          points: [-1, 0, 49, 99, 100, 149, 150, 199, 200, 299, 300].flatMap((x) =>
            [-1, 0, 100, 149, 150, 151, 299, 300, 449, 450].map((y) => [x, y]),
          ),
        },
        expected: {
          results: [-1, 0, 49, 99, 100, 149, 150, 199, 200, 299, 300].flatMap((x) =>
            [-1, 0, 100, 149, 150, 151, 299, 300, 449, 450].map((y) => cardRegion(x, y, 300, 450)),
          ),
        },
      },
      {
        name: 'cardControls',
        input: { prefs: controlPrefs, touch: [true, false] },
        expected: {
          results: controlPrefs.flatMap((p) =>
            [true, false].map((touch) => cardControls(prefsWith(p) as never, touch)),
          ),
        },
      },
      {
        name: 'autoSpeechEnabled',
        input: {
          prefs: speechPrefs,
          directions: ['recognition', 'production'],
          revealed: [false, true],
        },
        expected: {
          results: speechPrefs.flatMap((p) =>
            (['recognition', 'production'] as const).flatMap((direction) =>
              [false, true].map((revealed) =>
                autoSpeechEnabled(prefsWith(p) as never, direction, revealed),
              ),
            ),
          ),
        },
      },
      {
        name: 'inkOffsets',
        input: { lines, spread: 0.24 },
        expected: {
          results: lines.map((l) =>
            inkOffsets(
              l.map((line) => ({ line })),
              0.24,
            ),
          ),
        },
      },
      {
        name: 'interval text parts',
        input: { intervalsMs: intervals },
        // The study screen's formatInterval, split into its number and its unit (Study.tsx).
        expected: {
          results: intervals.map((ms) => {
            const s = Math.max(0, Math.round(ms / 1000));
            if (s < 5) return { unit: 'ready' };
            if (s < 60) return { unit: 'sec', value: s };
            if (s < 3600) return { unit: 'min', value: Math.ceil(s / 60) };
            if (s < 86400) return { unit: 'hr', value: Math.round(s / 3600) };
            return { unit: 'days', value: Math.round(s / 86400) };
          }),
        },
      },
    ];
    // Today's numbers (stats): first encounters, unassisted reviews, their success rate and the time spent.
    stubRandomness(29);
    const state = initialState(T0);
    state.entries = [...packEntries().values()].map((e) => structuredClone(e));
    state.entries[1].tags = ['Essentials'];
    state.tasks = [];
    state.prefs.newLimit = 6;
    beginSession(state, 'recognition', T0);
    const queue = [...state.session!.queue];
    queue
      .slice(0, 5)
      .forEach((id, i) => commitAnswer(state, id, `x${i}`, T0 + i * MINUTE, 2000 + i * 100_000));
    const review = (
      id: string,
      at: number,
      rating: 1 | 2 | 3 | 4,
      duration: number,
      assisted?: number,
    ) => {
      const task = state.tasks.find((t) => t.id === id)!;
      commitAnswer(state, id, `r${at}`, at, duration, rating, preview(task.card, at, 0.9), at);
      const event = state.events[state.events.length - 1];
      if (assisted) event.assisted = true;
      // The queue was edited by hand to answer in a chosen order; keep the recorded session consistent.
      event.sessionBefore = { ...event.sessionBefore, queue: [], pending: [] };
    };
    state.session!.queue = [queue[0], queue[1]];
    review(queue[0], T0 + 20 * MINUTE, 3, 3000);
    state.session!.queue = [queue[1], queue[0]];
    review(queue[1], T0 + 21 * MINUTE, 1, 400_000);
    state.session!.queue = [queue[2]];
    review(queue[2], T0 + 22 * MINUTE, 4, 1500, 1);
    state.session!.queue = [queue[3]];
    review(queue[3], T0 + DAY + 2 * HOUR, 2, 1500);
    state.events[state.events.length - 1].voidedAt = T0 + DAY + 3 * HOUR;
    // The queue edits above were only to answer cards in a chosen order; leave a consistent session.
    state.session!.queue = [];
    state.session!.pending = [];
    const queries = [T0, T0 + 2 * HOUR, T0 + DAY + HOUR, T0 + 3 * DAY].flatMap((at) =>
      ['', 'word-list', 'top-2000', 'Essentials', 'user', 'unknown-tag'].map((scope) => ({
        at,
        scope,
      })),
    );
    cases.push({
      name: 'stats',
      input: { state, queries },
      expected: { results: queries.map(({ at, scope }) => stats(state, at, scope)) },
    });
    await expect(
      fixtureText(
        'src/platform/input.ts, domain/study-preferences.ts, app/ink.ts, pages/Study.tsx, domain/learning.ts',
        plain(cases),
      ),
    ).toMatchFileSnapshot(`${DIR}study-rules.json`);
  });

  it('overview stats', async () => {
    // What Today, Library and Activity count: where each entry stands, practice days and streaks, week figures, the
    // progress breakdown, scope options, and the numbers Today's figure is made of.
    stubRandomness(31);
    const DAYS = (n: number, h = 12) => Date.UTC(2026, 9, n, h - 1, 0, 0); // Paris wall-clock hour h on October n
    const state = initialState(T0);
    const pack = [...packEntries().values()].map((e) => structuredClone(e));
    pack.push({ ...structuredClone(pack[0]), id: 'word-list-0007', word: 'septième' } as Entry);
    state.entries = pack;
    state.tasks = [];
    state.prefs.newLimit = 5;
    ensureTasks(state, 'recognition', T0);
    ensureTasks(state, 'production', T0);
    const at = DAYS(29);
    const task = (id: string, direction = 'recognition') =>
      state.tasks.find((t) => t.entryId === id && t.direction === direction)!;
    const learn = (
      id: string,
      o: { due: number; stability: number; last: number },
      direction = 'recognition',
    ) => {
      const t = task(id, direction);
      t.learnedAt = o.last;
      Object.assign(t.card, {
        due: o.due,
        stability: o.stability,
        last_review: o.last,
        state: 2,
        reps: 3,
      });
    };
    // 1 new (no progress); 2 due; 3 learning; 4 mature; 5 paused; 6 archived.
    learn(pack[1].id, { due: at - HOUR, stability: 4, last: at - DAY });
    task(pack[1].id).card.lapses = 4;
    // 0: read once and never rated ("seen"), due again.
    task(pack[0].id).learnedAt = at - DAY;
    Object.assign(task(pack[0].id).card, { due: at - DAY + 60_000, reps: 0 });
    learn(pack[2].id, { due: at + DAY, stability: 6, last: at - HOUR });
    learn(pack[3].id, { due: at + 30 * DAY, stability: 40, last: at - 2 * DAY });
    learn(pack[4].id, { due: at - DAY, stability: 9, last: at - 3 * DAY });
    pack[4].suspended = true;
    learn(pack[5].id, { due: at + DAY, stability: 30, last: at - DAY });
    pack[5].archived = true;
    // A production task learned later than the recognition one does not carry the progress; an older second
    // recognition task of the same entry loses to the more recently reviewed one.
    learn(pack[0].id, { due: at - HOUR, stability: 3, last: at - HOUR }, 'production');
    state.tasks.push({
      ...structuredClone(task(pack[2].id)),
      id: 'extra-recognition',
      promptLanguage: 'fr',
      learnedAt: at - 5 * DAY,
      card: {
        ...structuredClone(task(pack[2].id).card),
        last_review: at - 5 * DAY,
        stability: 50,
        due: at - 2 * DAY,
      },
    } as never);
    state.tasks.push({
      ...structuredClone(task(pack[3].id)),
      id: 'newer-recognition',
      promptLanguage: 'fr',
      learnedAt: at - HOUR,
      card: {
        ...structuredClone(task(pack[3].id).card),
        last_review: at - HOUR,
        stability: 25,
        due: at - HOUR,
      },
    } as never);
    // Events: copies of one real answer at chosen times (a streak over the daylight-saving change on 25 October).
    beginSession(state, 'recognition', T0);
    const queue = [...state.session!.queue];
    commitAnswer(state, queue[0], 'seed', T0, 2000);
    const seed = state.events[state.events.length - 1];
    state.events = [];
    state.session = null as never;
    // The seed answer made the first entry "learned"; put it back to new.
    delete task(pack[6].id).learnedAt;
    task(pack[6].id).card = emptyCard(T0);
    const ev = (n: number, time: number, o: Record<string, unknown> = {}) => {
      const entryId = (o.entryId as string | undefined) ?? pack[1].id,
        taskId = task(entryId).id;
      const copy = structuredClone(seed);
      for (const side of [copy.before, copy.after]) Object.assign(side, { id: taskId, entryId });
      return {
        ...copy,
        id: `ev-${n}`,
        at: time,
        kind: 'review',
        rating: 3,
        durationMs: 4000,
        ...o,
        entryId,
        taskId,
      } as never;
    };
    const times = [
      DAYS(20, 9),
      DAYS(22, 9),
      DAYS(23, 22),
      DAYS(24, 23) + 30 * 60_000,
      DAYS(25, 0) + 30 * 60_000,
      DAYS(25, 23) + 30 * 60_000,
      DAYS(26, 8),
      DAYS(28, 7),
      DAYS(29, 8),
    ];
    times.forEach((time, i) =>
      state.events.push(ev(i, time, i % 3 === 0 ? { rating: 1, entryId: pack[2].id } : {})),
    );
    state.events.push(ev(20, DAYS(29, 9), { voidedAt: DAYS(29, 10) }));
    state.events.push(ev(21, DAYS(29, 9), { assisted: true, rating: 4, durationMs: 400_000 }));
    state.events.push(
      ev(22, DAYS(27, 9), { kind: 'exposure', rating: undefined, durationMs: 1500 }),
    );
    state.events.push(ev(23, DAYS(21, 9), { voided: undefined, voidedAt: DAYS(21, 10) }));
    const ats = [
      DAYS(29),
      DAYS(30),
      DAYS(31),
      DAYS(25, 0),
      DAYS(25, 23) + 45 * 60_000,
      DAYS(26, 3),
    ];
    const asRecord = (m: Map<string, unknown>) =>
      Object.fromEntries([...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
    const cases: { name: string; input: unknown; expected: unknown }[] = [];
    cases.push({
      name: 'statuses and progress carrier',
      input: { state, at },
      expected: {
        progress: Object.fromEntries([...entryProgresses(state, at).entries()]),
        single: Object.fromEntries(state.entries.map((e) => [e.id, entryProgress(state, e, at)])),
        tags: Object.fromEntries(
          state.entries.map((e) => [e.id, entryTag(entryProgress(state, e, at))]),
        ),
        carrier: Object.fromEntries(
          state.entries.map((e) => [e.id, entryTask(state, e.id)?.id ?? null]),
        ),
        breakdown: progressBreakdown(state, at),
      },
    });
    cases.push({
      name: 'practice days, streaks and weeks',
      input: { state, ats },
      expected: {
        dailyCounts: asRecord(dailyCounts(state)),
        streaks: ats.map((t) => streak(state, t)),
        weeks: ats.map((t) => [
          weekStats(state, t, 0),
          weekStats(state, t, 1),
          weekStats(state, t, 2),
        ]),
        today: ats.map((t) => stats(state, t, '')),
        forecast: ats.map((t) => dueForecast(state, t)),
        dayKeys: ats.map((t) => dayKey(t)),
      },
    });
    const calendar = [
      DAYS(25, 0),
      DAYS(25, 12),
      DAYS(24, 23) + 59 * 60_000,
      DAYS(26, 0),
      DAYS(28, 12),
      DAYS(1, 12),
    ];
    cases.push({
      name: 'calendar days (addDays, weekStart)',
      input: { ats: calendar, ns: [-8, -1, 0, 1, 2, 7] },
      expected: {
        weekStart: calendar.map((t) => weekStart(t)),
        addDays: calendar.map((t) => [-8, -1, 0, 1, 2, 7].map((n) => addDays(t, n))),
      },
    });
    const tagged = structuredClone(pack);
    tagged[0].tags = ['Essentials', 'Verbs'];
    tagged[1].tags = ['Daily life'];
    tagged[2].archived = true;
    tagged[2].tags = ['Archived only'];
    tagged.push(
      { ...structuredClone(pack[0]), id: 'dict:x', tags: [] } as Entry,
      { ...structuredClone(pack[0]), id: 'user-0009', tags: ['Mine'] } as Entry,
    );
    cases.push({
      name: 'scope options',
      input: { entries: tagged },
      expected: {
        active: scopeOptions(tagged),
        withArchived: scopeOptions(tagged, true),
        none: scopeOptions([]),
      },
    });
    const withNotes = structuredClone(pack);
    withNotes[1].groups[0].senses.push({
      ...structuredClone(sensesOf(withNotes[1])[0]),
      id: 'dup',
      examples: [],
      collocations: [],
      definitions: {
        zh: { short: sensesOf(withNotes[1])[0].definitions.zh.short, detail: '', usage: '' },
        en: { short: ' ', detail: '', usage: '' },
      },
    } as never);
    withNotes[1].groups[0].senses.push({
      ...structuredClone(sensesOf(withNotes[1])[0]),
      id: 'overlap',
      examples: [],
      collocations: [],
      definitions: {
        zh: {
          short: `${sensesOf(withNotes[1])[0].definitions.zh.short}；获悉`,
          detail: '',
          usage: '',
        },
        en: {
          short: `${sensesOf(withNotes[1])[0].definitions.en.short}; to find out`,
          detail: '',
          usage: '',
        },
      },
    } as never);
    withNotes[2].groups[0].features = ['irregular-form'] as never;
    withNotes.push(structuredClone(starterEntries(T0).find((e) => e.kind === 'pronominal')!));
    cases.push({
      name: 'lexicon helpers',
      input: { entries: withNotes },
      expected: {
        shortDefinition: withNotes.map((e) => [shortDefinition(e, 'zh'), shortDefinition(e, 'en')]),
        isSpecial: withNotes.map((e) => isSpecial(e)),
      },
    });
    // Today's numbers: due count of the scope, due tasks of the other explanation language, active entries.
    const today = (
      scope: string,
      direction: 'recognition' | 'production',
      mode: 'zhOnly' | 'enOnly',
    ) => {
      const s = structuredClone(state);
      s.prefs.direction = direction;
      s.prefs.mode = mode;
      const locale = mode === 'enOnly' ? 'en' : 'zh';
      const candidates = availableTasks(s, direction, scope);
      const active = new Set(s.entries.filter((e) => !e.archived && !e.suspended).map((e) => e.id));
      return {
        scope,
        direction,
        mode,
        dueCount: candidates.filter((t) => t.learnedAt && t.card.due <= at).length,
        offModeDue: s.tasks.filter(
          (t) =>
            t.direction === 'production' &&
            t.promptLanguage !== locale &&
            t.learnedAt &&
            t.card.due <= at &&
            active.has(t.entryId),
        ).length,
        hasActive: s.entries.some(
          (e) =>
            !e.archived &&
            !e.suspended &&
            (!scope || e.tags.includes(scope) || scope === 'word-list') &&
            sensesOf(e).some((x) => x.definitions[locale].short.trim()),
        ),
      };
    };
    cases.push({
      name: 'today counts',
      input: {
        state,
        at,
        queries: [
          ['', 'recognition', 'zhOnly'],
          ['word-list', 'recognition', 'zhOnly'],
          ['', 'production', 'zhOnly'],
          ['', 'recognition', 'enOnly'],
          ['Essentials', 'recognition', 'zhOnly'],
        ],
      },
      expected: {
        results: [
          ['', 'recognition', 'zhOnly'],
          ['word-list', 'recognition', 'zhOnly'],
          ['', 'production', 'zhOnly'],
          ['', 'recognition', 'enOnly'],
          ['Essentials', 'recognition', 'zhOnly'],
        ].map(([a, b, c]) => today(a, b as never, c as never)),
      },
    });
    await expect(
      fixtureText(
        'src/domain/learning.ts, collections.ts, lexicon.ts, pages/Today.tsx',
        plain(cases),
      ),
    ).toMatchFileSnapshot(`${DIR}stats.json`);
  });

  it('entry flags', async () => {
    // Favorite, pause and archive (a pause or archive also takes the entry's tasks out of a running session).
    stubRandomness(37);
    const build = () => {
      const state = initialState(T0);
      state.entries = [...packEntries().values()].map((e) => structuredClone(e));
      state.tasks = [];
      state.prefs.newLimit = 6;
      beginSession(state, 'recognition', T0);
      commitAnswer(state, state.session!.queue[0], 'f1', T0, 1000);
      return state;
    };
    const cases = [] as { name: string; input: unknown; expected: unknown }[];
    const run = (
      name: string,
      ids: (s: AppState) => string[],
      flag: 'favorite' | 'suspended' | 'archived',
      value: boolean,
      prepare?: (s: AppState) => void,
    ) => {
      const state = build();
      prepare?.(state);
      const chosen = ids(state);
      const before = structuredClone(state);
      setEntryFlag(state, chosen, flag, value);
      cases.push({ name, input: { state: before, ids: chosen, flag, value }, expected: { state } });
    };
    run('favorite does not touch the session', (s) => [s.entries[0].id], 'favorite', true);
    run(
      'pause takes queued and waiting tasks out of the session',
      (s) => [s.entries[0].id, s.entries[2].id],
      'suspended',
      true,
    );
    run('archive trims the session', (s) => [s.entries[1].id], 'archived', true);
    run(
      'resume leaves the session alone',
      (s) => [s.entries[1].id],
      'suspended',
      false,
      (s) => {
        s.entries[1].suspended = true;
      },
    );
    run('unknown ids change nothing', () => ['nope'], 'archived', true);
    {
      const state = build();
      state.session = null as never;
      const before = structuredClone(state);
      setEntryFlag(state, [state.entries[0].id], 'suspended', true);
      cases.push({
        name: 'no session open',
        input: { state: before, ids: [before.entries[0].id], flag: 'suspended', value: true },
        expected: { state },
      });
    }
    await expect(fixtureText('src/domain/learning.ts', plain(cases))).toMatchFileSnapshot(
      `${DIR}entries.json`,
    );
  });

  it('add from dictionary', async () => {
    // Turning a dictionary record into an entry of the learner's (the record's senses, forms and verb tables, the
    // pronominal link to its base verb), and the refusals: no explanation, duplicate, an archived entry coming back.
    stubRandomness(41);
    const sense = (id: string, zh: string[], en: string[]) => ({ id, number: id, fr: '', zh, en });
    const lex = (
      id: string,
      pos: string,
      gender: string,
      senses: ReturnType<typeof sense>[],
      ipa: string[] = [],
    ) => ({ id, pos, gender, ipa, senses, forms: [], sourceId: 'wikdict' });
    const table = (mood: string, tense: string, forms: string[]) => ({
      mood,
      tense,
      rows: forms.map((f, i) => ({ person: ['1s', '2s', '3s', '1p', '2p', '3p'][i], forms: [f] })),
    });
    const morph = (
      id: string,
      pos: string,
      gender: string,
      number: string,
      extra: Record<string, unknown> = {},
    ) => ({
      id,
      pos,
      gender,
      number,
      family: 'fam-' + id,
      sourceId: 'demonette',
      forms: [],
      tables: [],
      pastParticiple: [],
      presentParticiple: [],
      ...extra,
    });
    const rec = (
      id: string,
      word: string,
      lexemes: ReturnType<typeof lex>[],
      morphology: ReturnType<typeof morph>[] = [],
      aliases: string[] = [],
    ) => ({ id: `dict:${id}`, word, aliases, lexemes, morphology });
    const records = [
      rec(
        'lune',
        'lune',
        [lex('lune-n', 'noun', 'f', [sense('1', ['月亮'], ['moon'])], ['lyn'])],
        [
          morph('lune', 'noun', 'f', 'singular', {
            forms: [{ form: 'lunes', kind: 'plural', gender: 'f', number: 'plural' }],
          }),
        ],
      ),
      rec(
        'parler',
        'parler',
        [lex('parler-v', 'verb', '', [sense('1', ['说'], ['speak'])], ['paʁle'])],
        [
          morph('parler', 'verb', '', 'unknown', {
            tables: [
              table('indicative', 'present', [
                'parle',
                'parles',
                'parle',
                'parlons',
                'parlez',
                'parlent',
              ]),
            ],
            pastParticiple: ['parlé'],
            presentParticiple: ['parlant'],
          }),
        ],
      ),
      rec(
        'seraser',
        's’asseoir',
        [lex('asseoir-v', 'verb', '', [sense('1', ['坐下'], ['sit down'])])],
        [morph('seraser', 'verb', '', 'unknown')],
      ),
      rec(
        'asseoir',
        'asseoir',
        [lex('asseoir-v2', 'verb', '', [sense('1', ['使坐'], ['seat'])])],
        [morph('asseoir', 'verb', '', 'unknown')],
      ),
      rec('sepasser', 'se passer', [
        lex('passer-n', 'noun', 'm', [sense('1', ['发生'], ['happen'])]),
      ]),
      rec(
        'onlyen',
        'cheval',
        [lex('cheval-n', 'noun', 'm', [sense('1', [], ['horse'])])],
        [morph('cheval-a', 'noun', 'm', 'singular'), morph('cheval-b', 'noun', 'm', 'singular')],
      ),
      rec('empty', 'rien', [lex('rien-n', 'noun', 'm', [sense('1', [], [])])]),
      rec('francais', 'français', [
        lex('francais-a', 'adjective', '', [sense('1', ['法国的'], ['French'])]),
        {
          ...lex('Francais-n', 'noun', 'm', [sense('2', ['法国人'], ['Frenchman'])]),
          spelling: 'Français',
        } as ReturnType<typeof lex>,
      ]),
      rec(
        'livre',
        'livre',
        [
          lex('livre-m', 'noun', 'm', [sense('1', ['书'], ['book'])]),
          lex('livre-f', 'noun', 'f', [sense('2', ['磅'], ['pound'])]),
        ],
        [morph('livre-m', 'noun', 'm', 'singular'), morph('livre-f', 'noun', 'f', 'singular')],
      ),
    ] as unknown as DictionaryRecord[];
    const manifest = {
      version: 'fix-1',
      sources: [
        {
          id: 'wikdict',
          label: 'WikDict',
          license: 'CC BY-SA',
          url: 'https://example.org/wikdict',
          version: '2026',
        },
        {
          id: 'demonette',
          label: 'Démonette',
          license: 'CC BY-SA',
          url: 'https://example.org/demonette',
          version: '3',
        },
      ],
    };
    setContent('dictionary', { records, manifest, conflicts: [] } as never);
    const start = () => {
      const st = initialState(T0);
      st.entries = [...packEntries().values()].slice(0, 3).map((e) => structuredClone(e));
      st.tasks = [];
      return st;
    };
    const cases: { name: string; input: unknown; expected: unknown }[] = [];
    const run = (
      name: string,
      id: string,
      locale: 'zh' | 'en',
      prepare?: (s: AppState) => void,
    ) => {
      const st = start();
      prepare?.(st);
      const before = structuredClone(st);
      const record = records.find((r) => r.id === `dict:${id}`)!;
      let result: { id?: string; error?: string };
      try {
        result = { id: addDictionaryEntry(st, record, locale, T0 + 1000) };
      } catch (e) {
        result = { error: (e as Error).message };
      }
      cases.push({
        name,
        input: { state: before, record, locale, at: T0 + 1000, manifest },
        expected: { result, state: st },
      });
    };
    run('a noun with forms', 'lune', 'zh');
    run('a verb with a table and participles', 'parler', 'zh');
    run('a pronominal verb links to its base verb', 'seraser', 'zh', (s) => {
      s.entries.push({
        ...structuredClone(s.entries[0]),
        id: 'dict:asseoir',
        word: 'asseoir',
        groups: [{ ...structuredClone(s.entries[0].groups[0]), id: 'g-v', pos: 'verb' }],
        relations: [],
      } as never);
    });
    run('a pronominal verb without its base verb', 'seraser', 'zh');
    run('a pronominal-looking word without a verb is refused', 'sepasser', 'zh');
    run('only English meanings, asked in Chinese', 'onlyen', 'zh');
    run('only English meanings, asked in English', 'onlyen', 'en');
    run('no meanings at all', 'empty', 'zh');
    run('two lexemes keep both groups', 'livre', 'zh');
    run('a block spelled with other capitals gets a note', 'francais', 'zh');
    run('already learned (same headword)', 'lune', 'zh', (s) => {
      s.entries.push({ ...structuredClone(s.entries[0]), id: 'user-1', word: 'lune' } as never);
    });
    run('an archived entry of the same id comes back', 'lune', 'zh', (s) => {
      const e = structuredClone(s.entries[0]);
      Object.assign(e, { id: 'dict:lune', word: 'lune', archived: true, suspended: true });
      s.entries.push(e as never);
    });
    run('a headword that collides with another active entry', 'lune', 'zh', (s) => {
      s.entries.push({
        ...structuredClone(s.entries[0]),
        id: 'user-2',
        word: 'Lune',
        dictionaryRefs: undefined,
      } as never);
    });
    await expect(fixtureText('src/domain/dictionary.ts', plain(cases))).toMatchFileSnapshot(
      `${DIR}adding.json`,
    );
  });

  it('user layer', async () => {
    // Accept/reject verdicts of the user-layer validators and of validateEntry on own-entry shapes. The native
    // store refuses what these refuse, so the two sides must agree on every case.
    const verdict = (check: (v: unknown) => void, doc: unknown) => {
      try {
        check(structuredClone(doc));
        return true;
      } catch {
        return false;
      }
    };
    const entry = starterEntries(T0)[0];
    const sid = sensesOf(entry)[0].id;
    const gid = entry.groups[0].id;
    const path = ['groups', { id: gid }, 'senses', { id: sid }, 'examples'];
    const patchDocs: [string, unknown][] = [
      ['empty patch list', { id: 'e1', patches: [] }],
      [
        'set with base',
        { id: 'e1', patches: [{ op: 'set', path: ['ipa'], value: 'x', base: '' }] },
      ],
      [
        'set without base (a field the built-in entry lacks)',
        { id: 'e1', patches: [{ op: 'set', path: ['ipa'], value: 'x' }] },
      ],
      ['unset without base', { id: 'e1', patches: [{ op: 'unset', path: ['ipa'] }] }],
      [
        'add an item after another',
        { id: 'e1', patches: [{ op: 'add', path, item: { id: 'x' }, after: 'y' }] },
      ],
      [
        'add at the start',
        { id: 'e1', patches: [{ op: 'add', path, item: { id: 'x' }, after: null }] },
      ],
      ['add without after', { id: 'e1', patches: [{ op: 'add', path, item: { id: 'x' } }] }],
      [
        'remove with base and after',
        { id: 'e1', patches: [{ op: 'remove', path, id: 'x', base: { id: 'x' }, after: null }] },
      ],
      ['remove without an id', { id: 'e1', patches: [{ op: 'remove', path }] }],
      ['unknown op', { id: 'e1', patches: [{ op: 'replace', path: ['ipa'], value: 'x' }] }],
      [
        'path of 20 segments',
        { id: 'e1', patches: [{ op: 'unset', path: Array.from({ length: 20 }, () => 'a') }] },
      ],
      [
        'path of 21 segments',
        { id: 'e1', patches: [{ op: 'unset', path: Array.from({ length: 21 }, () => 'a') }] },
      ],
      ['path segment of the wrong type', { id: 'e1', patches: [{ op: 'unset', path: [1] }] }],
      ['contentVersion 1', { id: 'e1', patches: [], contentVersion: 1 }],
      ['contentVersion 0', { id: 'e1', patches: [], contentVersion: 0 }],
      ['updatedAt negative', { id: 'e1', patches: [], updatedAt: -1 }],
      ['no id', { patches: [] }],
      ['patches not a list', { id: 'e1', patches: {} }],
    ];
    const annotations: [string, unknown][] = [
      ['id only', { id: 'e1' }],
      ['flags', { id: 'e1', favorite: true, suspended: false, archived: true }],
      ['notes in both languages', { id: 'e1', localizedNotes: { zh: 'a', en: 'b' } }],
      ['note in one language', { id: 'e1', localizedNotes: { zh: 'a' } }],
      ['empty note kept', { id: 'e1', localizedNotes: { zh: '', en: '' } }],
      ['note of the wrong type', { id: 'e1', localizedNotes: { zh: 1 } }],
      ['card display with senses', { id: 'e1', cardDisplay: { senseIds: ['s1'] } }],
      ['card display removed (null)', { id: 'e1', cardDisplay: null }],
      ['card display with a bad sense list', { id: 'e1', cardDisplay: { senseIds: 'x' } }],
      ['added and hidden tags', { id: 'e1', addedTags: ['A'], hiddenTags: ['B'] }],
      ['the full tag list', { id: 'e1', tags: ['C', 'A'] }],
      ['tags of the wrong type', { id: 'e1', tags: [1] }],
      ['favorite as a string', { id: 'e1', favorite: 'yes' }],
      ['no id', { favorite: true }],
    ];
    const issue = {
      id: 'i1',
      entryId: 'e1',
      kind: 'meaning',
      note: 'n',
      context: 'c',
      status: 'open',
      createdAt: T0,
    };
    const issues: [string, unknown][] = [
      ['open issue', issue],
      ['with a sense and pack version', { ...issue, senseId: 's1', packVersion: 3 }],
      ['resolved with closedAt', { ...issue, status: 'resolved', closedAt: T0 + 1 }],
      ['dismissed', { ...issue, status: 'dismissed' }],
      ['kind missing (a built-in word with no meaning)', { ...issue, kind: 'missing' }],
      ['kind other', { ...issue, kind: 'other' }],
      ['unknown kind', { ...issue, kind: 'typo' }],
      ['unknown status', { ...issue, status: 'later' }],
      ['note of 5000 characters', { ...issue, note: 'x'.repeat(5000) }],
      ['note of 5001 characters', { ...issue, note: 'x'.repeat(5001) }],
      ['packVersion 0', { ...issue, packVersion: 0 }],
      ['createdAt negative', { ...issue, createdAt: -1 }],
      ['no entryId', { ...issue, entryId: undefined }],
    ];
    const record = { id: 'r1', entryId: 'e1', word: 'mot', at: T0, kind: 'edit', changes: [] };
    const logRecords: [string, unknown][] = [
      ['edit with no changes', record],
      [
        'edit with a change',
        { ...record, changes: [{ op: 'set', path: ['ipa'], value: 'x', base: '' }] },
      ],
      ['undo of another record', { ...record, kind: 'undo', undoOf: 'r0' }],
      ['edit that was undone', { ...record, undoneBy: 'r2' }],
      ['unknown kind', { ...record, kind: 'redo' }],
      ['no word', { ...record, word: undefined }],
      ['changes not a list', { ...record, changes: 'none' }],
    ];
    const review = { id: 'c1', entryId: 'e1', word: 'mot', kind: 'removed', path: ['ipa'], at: T0 };
    const reviewItems: [string, unknown][] = [
      ['removed item', review],
      [
        'changed item with base, pack and mine',
        { ...review, kind: 'changed', base: 'a', pack: 'b', mine: 'c' },
      ],
      ['retired item', { ...review, kind: 'retired', pack: ['id2'] }],
      ['unknown kind', { ...review, kind: 'stale' }],
      ['no path', { ...review, path: undefined }],
      ['at negative', { ...review, at: -1 }],
    ];
    // validateEntry on own-entry shapes (what a form would produce).
    const own = (patch: (e: Entry) => void) => {
      const e = structuredClone(entry);
      e.sourceStatus = 'user';
      patch(e);
      return e;
    };
    const entries: [string, unknown][] = [
      ['a starter entry', entry],
      ['an own entry', own(() => undefined)],
      [
        'blank Chinese and English definitions',
        own((e) => {
          const d = sensesOf(e)[0].definitions;
          d.zh.short = '';
          d.en.short = ' ';
        }),
      ],
      [
        'only an English definition',
        own((e) => {
          sensesOf(e)[0].definitions.zh.short = '';
        }),
      ],
      [
        'a duplicate id among examples and senses',
        own((e) => {
          const s = sensesOf(e)[0];
          s.examples = [...s.examples, { ...structuredClone(s.examples[0]), id: s.id }];
        }),
      ],
      [
        'an own example with a new id',
        own((e) => {
          const s = sensesOf(e)[0];
          s.examples = [
            ...s.examples,
            { ...structuredClone(s.examples[0]), id: `${s.id}:example:mine` },
          ];
        }),
      ],
      [
        'an empty example text',
        own((e) => {
          const s = sensesOf(e)[0];
          s.examples = [...s.examples, { ...structuredClone(s.examples[0]), id: 'x1', text: '' }];
        }),
      ],
      [
        'a blank word',
        own((e) => {
          e.word = ' ';
        }),
      ],
      [
        'a tag of 201 characters',
        own((e) => {
          e.tags = ['x'.repeat(201)];
        }),
      ],
      [
        'a source with a bad URL',
        own((e) => {
          e.sources = [{ label: 'x', url: 'not a url', locator: '' }];
        }),
      ],
      [
        'a source with an https URL',
        own((e) => {
          e.sources = [{ label: 'x', url: 'https://example.org/a', locator: '' }];
        }),
      ],
      [
        'a source URL with a space',
        own((e) => {
          e.sources = [{ label: 'x', url: 'https://a b', locator: '' }];
        }),
      ],
      [
        'a source URL that is only a scheme',
        own((e) => {
          e.sources = [{ label: 'x', url: 'https://', locator: '' }];
        }),
      ],
      [
        'a pronominal entry without a verb',
        own((e) => {
          e.kind = 'pronominal';
        }),
      ],
      [
        'a verb profile on a noun group',
        own((e) => {
          e.groups[0].pos = 'noun';
          e.groups[0].verb = {
            auxiliary: '',
            pastParticiple: '',
            presentParticiple: '',
            pronominalUse: '',
            pronounRequired: false,
            meaningDifference: { zh: '', en: '' },
            agreementNote: { zh: '', en: '' },
            conjugations: [],
          };
        }),
      ],
      [
        'a derived-from sense that does not exist',
        own((e) => {
          const s = sensesOf(e)[0];
          s.distance = 'derived';
          s.derivedFromSenseId = 'missing';
        }),
      ],
      [
        'a relation that points at the entry itself',
        own((e) => {
          e.relations = [
            {
              id: 'r1',
              type: 'synonym',
              targetId: e.id,
              notes: { zh: '', en: '' },
              status: 'needs-review',
              source: '',
            },
          ];
        }),
      ],
    ];
    const group = (name: string, check: (v: unknown) => void, list: [string, unknown][]) =>
      list.map(([label, doc]) => ({
        name: `${name}: ${label}`,
        input: { validator: name, doc },
        expected: { valid: verdict(check, doc) },
      }));
    const cases = [
      ...group('patchDoc', validatePatchDoc as never, patchDocs),
      ...group('annotation', validateAnnotation as never, annotations),
      ...group('issue', validateIssue as never, issues),
      ...group('logRecord', validateLogRecord as never, logRecords),
      ...group('reviewItem', validateReviewItem as never, reviewItems),
      ...group('entry', validateEntry as never, entries),
    ];
    await expect(
      fixtureText('src/domain/user-layer.ts, validation.ts', plain(cases)),
    ).toMatchFileSnapshot(`${DIR}user-layer.json`);
  });

  it('conjugation text', async () => {
    const forms = [
      ['parle', '1s', 'indicative'],
      ['parles', '2s', 'indicative'],
      ['parle', '3s', 'subjunctive'],
      ['parlent', '3p', 'subjunctive'],
      ['aime', '1s', 'subjunctive'],
      ['habite', '1s', 'indicative'],
      ['hurle', '1s', 'indicative'],
      ['yodle', '1s', 'indicative'],
      ['œuvre', '1s', 'indicative'],
      ['je parle', '1s', 'indicative'],
      ['qu’il parle', '3s', 'subjunctive'],
      ['parle', 'none', 'infinitive'],
      ['parle', '2s', 'imperative'],
      ['parlons', '1p', 'imperative'],
      ['allons', '1p', 'indicative'],
      ['ont', '3p', 'indicative'],
      ['Écoute', '1s', 'indicative'],
    ] as const;
    const words = ['parler', 'habiter', ''];
    const results = words.flatMap((w) =>
      forms.map(([f, p, m]) => displayConjugation(f, p as never, m as never, w)),
    );
    await expect(
      fixtureText(
        'src/domain/conjugations.ts',
        plain([{ name: 'display', input: { forms, words }, expected: { results } }]),
      ),
    ).toMatchFileSnapshot(`${DIR}conjugation.json`);
  });

  it('progress import', async () => {
    // What the native app takes from a PWA backup (Migration.importProgress; the reference is tests/native-progress-import.ts).
    const standard = packFile();
    const AT = T0 + DAY;
    const retiredId = 'word-list-0099';
    const withRetired = (): WordListFile => {
      const file = packFile();
      file.retired = {
        entries: {
          [retiredId]: {
            replacedBy: ['word-list-0001'],
            entry: { ...structuredClone(file.entries[0]), id: retiredId } as Entry,
          },
        },
        senses: {},
      };
      return file;
    };
    const attempt = (backup: unknown, file: WordListFile, addMissing = true) => {
      setContent('word-list', file);
      try {
        const pack = packEntries();
        const run = importProgressReference(
          backup,
          pack,
          new Set(Object.keys(file.retired.entries)),
          file.version,
          AT,
          addMissing,
        );
        return plain({ state: run.state, report: run.report });
      } catch (error) {
        return { error: (error as Error).message };
      } finally {
        setContent('word-list', standard);
      }
    };
    // A state as the PWA keeps it: the pack's entries, studied, with the learner's own things around them.
    const source = (file: WordListFile, entryCount = 6) => {
      setContent('word-list', file);
      const pack = packEntries();
      const state = initialState(T0);
      state.entries = [...pack.values()].slice(0, entryCount).map((e) => structuredClone(e));
      state.tasks = [];
      state.prefs.newLimit = 12;
      return { state, pack };
    };

    stubRandomness(21);
    const mixedFile = withRetired();
    const { state: mixed, pack: mixedPack } = source(mixedFile);
    const own = { ...starterEntries(T0)[1], id: 'user-0001', relations: [] } as Entry;
    const dict = { ...starterEntries(T0)[2], id: 'dict:chat', relations: [] } as Entry;
    const gone = { ...starterEntries(T0)[3], id: retiredId, relations: [] } as Entry;
    mixed.entries.push(own, dict, gone);
    ensureTasks(mixed, 'recognition', T0);
    // A sense task on a sense the learner added to a built-in entry: the sense exists only in a patch.
    const extra = structuredClone(mixed.entries[1]);
    const extraSense = { ...extra.groups[0].senses[0], id: 'sense-extra' };
    mixed.entries[1].groups[0].senses.push(extraSense);
    const senseTask = structuredClone(mixed.tasks.find((t) => t.entryId === mixed.entries[1].id)!);
    mixed.tasks.push({
      ...senseTask,
      id: `${senseTask.id}:extra`,
      target: { kind: 'sense', senseId: 'sense-extra' },
    });
    beginSession(mixed, 'recognition', T0);
    for (let i = 0; i < 9; i++)
      if (mixed.session?.queue.length) {
        const front = mixed.session.queue[0];
        const learned = mixed.tasks.find((t) => t.id === front)!.learnedAt;
        commitAnswer(
          mixed,
          front,
          `m${i}`,
          T0 + i * 1000,
          1500,
          learned ? (i % 3 ? 3 : 1) : undefined,
        );
      }
    const markers = mixed.entries;
    markers[0].favorite = true;
    markers[0].tags = [...markers[0].tags, 'Mine'];
    markers[2].archived = true;
    markers[3].localizedNotes = { zh: '备注', en: 'note' };
    markers[4].ipa = 'edited';
    addIssue(
      mixed,
      { entryId: markers[0].id, kind: 'meaning', note: 'wrong', context: 'card' },
      mixedPack,
      T0,
    );
    mixed.contentLog = [
      {
        id: 'log-1',
        entryId: markers[4].id,
        word: markers[4].word,
        at: T0,
        kind: 'edit',
        changes: [],
      },
    ];
    mixed.importBatches = [{ id: 'batch-1', at: T0, entryIds: ['user-0001'] }];
    const mixedBackup = backupOf(mixed, mixedPack);
    setContent('word-list', standard);

    stubRandomness(22);
    const { state: small, pack: smallPack } = source(standard, 3);
    ensureTasks(small, 'recognition', T0);
    beginSession(small, 'recognition', T0);
    commitAnswer(small, small.session!.queue[0], 's0', T0, 1000);
    const smallBackup = backupOf(small, smallPack);
    setContent('word-list', standard);

    const oldPrefs = structuredClone(smallBackup);
    const prefs = oldPrefs.meta.prefs as unknown as Record<string, unknown>;
    delete prefs.typographyVersion;
    prefs.fontScale = 1.15;
    prefs.shuffleNewWords = true;
    const newer = { ...structuredClone(smallBackup), packVersion: standard.version + 1 };
    const schema2 = { ...structuredClone(smallBackup), schemaVersion: 2 };

    const cases = [
      {
        name: 'mixed: own, dict and retired entries, patches, issues, log, open session, a sense task that no longer resolves',
        input: { backup: mixedBackup, pack: mixedFile, at: AT, addMissing: true },
        expected: attempt(mixedBackup, mixedFile),
      },
      {
        name: 'a backup with fewer entries than the pack: the missing ones arrive as new words',
        input: { backup: smallBackup, pack: standard, at: AT, addMissing: true },
        expected: attempt(smallBackup, standard),
      },
      {
        name: 'the same backup without adding the missing entries',
        input: { backup: smallBackup, pack: standard, at: AT, addMissing: false },
        expected: attempt(smallBackup, standard, false),
      },
      {
        name: 'old preferences: typography version and shuffle flag migrate',
        input: { backup: oldPrefs, pack: standard, at: AT, addMissing: true },
        expected: attempt(oldPrefs, standard),
      },
      {
        name: 'a backup made against a newer pack is refused',
        input: { backup: newer, pack: standard, at: AT, addMissing: true },
        expected: attempt(newer, standard),
      },
      {
        name: 'a schema 2 file is refused',
        input: { backup: schema2, pack: standard, at: AT, addMissing: true },
        expected: attempt(schema2, standard),
      },
    ];
    await expect(
      fixtureText(
        'tests/native-progress-import.ts (reference), src/domain/migration.ts',
        plain(cases),
      ),
    ).toMatchFileSnapshot(`${DIR}migration.json`);
  });
});

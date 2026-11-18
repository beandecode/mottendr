import { content, hasContent, onContentLoaded, type DictionaryFile } from '../content/files';
import { packEntries } from './pack';
import type { AppState, Entry, Gender, Locale, ConjugationRow, Mood } from './types';
import { blankEntry, newGroup, newSense, bilingual, entryKey } from './lexicon';
import { normalizeHeadword } from './headword';
import { ensureTasks } from './learning';
export interface DictionarySense {
  id: string;
  number: string;
  fr: string;
  zh: string[];
  en: string[];
}
export interface DictionaryLexeme {
  id: string;
  pos: string;
  gender: Gender;
  ipa: string[];
  senses: DictionarySense[];
  forms: string[];
  sourceId: string;
  // Set when the source spells this block with other capitals than the record's word, such as
  // Français (法国人) inside the record français.
  spelling?: string;
}
export interface DictionaryMorphology {
  id: string;
  pos: string;
  gender: Gender;
  number: 'singular' | 'plural' | 'unknown';
  family: string;
  sourceId: string;
  forms: {
    form: string;
    kind: 'plural' | 'feminine' | 'masculine';
    gender: Gender;
    number: 'singular' | 'plural';
  }[];
  tables: { mood: Mood; tense: string; rows: ConjugationRow[] }[];
  pastParticiple: string[];
  presentParticiple: string[];
}
export interface DictionaryRecord {
  id: string;
  word: string;
  aliases: string[];
  lexemes: DictionaryLexeme[];
  morphology: DictionaryMorphology[];
}
// Empty until the dictionary file has loaded (see content/files.ts); live bindings update.
export let dictionaryRecords: DictionaryRecord[] = [];
export let dictionaryManifest: DictionaryFile['manifest'] = { version: '', sources: [] };
export let dictionaryConflicts: unknown = [];
export const lookupKey = (s: string) =>
  s.normalize('NFC').trim().toLocaleLowerCase('fr').replace(/['’]/g, '’');
// The text dictionary search compares: accents removed, French lower case, one apostrophe. Shared with the
// native app's content build, so both searches fold alike.
export const searchFold = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('fr').replace(/['’]/g, '’');
let index = new Map<string, DictionaryRecord>(),
  byId = new Map<string, DictionaryRecord>();
function useDictionaryFile() {
  const file = content('dictionary');
  dictionaryRecords = file.records as DictionaryRecord[];
  dictionaryManifest = file.manifest;
  dictionaryConflicts = file.conflicts;
  index = new Map(dictionaryRecords.map((r) => [lookupKey(r.word), r]));
  byId = new Map(dictionaryRecords.map((r) => [r.id, r]));
}
if (hasContent('dictionary')) useDictionaryFile();
onContentLoaded((name) => name === 'dictionary' && useDictionaryFile());
export function lookupDictionary(word: string): DictionaryRecord | undefined {
  const direct = index.get(lookupKey(word));
  if (direct) return direct;
  const e = blankEntry();
  e.word = word;
  normalizeHeadword(e);
  return index.get(lookupKey(e.word));
}
export const dictionaryRecord = (id: string) => byId.get(id);
// The letter a headword is filed under when browsing: accents and ligatures fold to their base
// letter (é → E, œ → O); anything else goes under "#".
export function letterOf(word: string): string {
  const folded = word
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae');
  return /[a-z]/.exec(folded)?.[0].toUpperCase() ?? '#';
}
export const dictionaryForEntry = (entry: Entry) =>
  entry.dictionaryRefs?.map(dictionaryRecord).find(Boolean) ?? lookupDictionary(entry.word);
export function dictionaryEntry(record: DictionaryRecord, at = Date.now()): Entry | null {
  const e = blankEntry();
  e.id = record.id;
  e.word = record.word;
  e.kind = /^(se\s|s['’])/i.test(e.word) ? 'pronominal' : 'lexical';
  e.groups = [];
  for (const lex of record.lexemes) {
    if (!lex.senses.length) continue;
    const g = newGroup(lex.pos);
    g.id = lex.id;
    g.gender = lex.gender;
    if (lex.spelling)
      g.specialNotes = bilingual(
        `这一组写作 ${lex.spelling}（大小写不同）`,
        `Written ${lex.spelling} (different capitals)`,
      );
    g.senses = [];
    for (const source of lex.senses) {
      const s = newSense();
      s.id = record.id + ':sense:' + source.id;
      for (const locale of ['zh', 'en'] as const)
        s.definitions[locale].short = source[locale]
          .join(locale === 'zh' ? '；' : '; ')
          .slice(0, 2000);
      if (s.definitions.zh.short || s.definitions.en.short) g.senses.push(s);
    }
    if (!g.senses.length) continue;
    const candidates = record.morphology.filter(
      (m) => m.pos === g.pos && (!g.gender || !m.gender || m.gender === g.gender),
    );
    if (candidates.length === 1) {
      const m = candidates[0];
      g.forms = m.forms.map((f, i) => ({ id: g.id + ':form:' + i, ...f, notes: bilingual() }));
      if (g.verb) {
        g.verb.pronounRequired = e.kind === 'pronominal';
        g.verb.pronominalUse = e.kind === 'pronominal' ? 'unspecified' : '';
        g.verb.conjugations = m.tables.map((t) => ({
          id: g.id + ':' + t.mood + ':' + t.tense,
          ...structuredClone(t),
          status: 'provided',
          notes: bilingual(),
          source: dictionaryManifest.sources[1].url,
        }));
        g.verb.pastParticiple = m.pastParticiple.length === 1 ? m.pastParticiple[0] : '';
        g.verb.presentParticiple = m.presentParticiple.length === 1 ? m.presentParticiple[0] : '';
      }
      if (g.pos === 'noun' && !e.headword) e.headword = { number: m.number, elision: 'unknown' };
      if (!e.families.some((f) => f.key === 'demonette:' + m.family))
        e.families.push({
          key: 'demonette:' + m.family,
          label: 'Démonette ' + m.family,
          root: '',
          notes: bilingual(),
          status: 'needs-review',
        });
    }
    e.groups.push(g);
  }
  if (!e.groups.length || (e.kind === 'pronominal' && !e.groups.some((g) => g.pos === 'verb')))
    return null;
  e.ipa = [...new Set(record.lexemes.flatMap((l) => l.ipa))].join(' / ').slice(0, 500);
  e.tags = [];
  e.dictionaryRefs = [record.id];
  e.source = 'Local dictionary · rule extraction';
  e.sources = dictionaryManifest.sources.map((s) => ({
    label: s.label + ' · ' + s.license,
    url: s.url,
    locator: s.version,
  }));
  e.sourceStatus = 'imported';
  e.contentStatus = 'needs-review';
  e.createdAt = at;
  e.updatedAt = at;
  e.contentProvenance = [
    {
      path: 'groups',
      sourceId: 'wikdict',
      locator: record.id,
      method: 'rule',
      version: dictionaryManifest.version,
    },
  ];
  return e;
}
let reviewed: Map<string, Entry> | undefined;
// Built-in entries already reviewed by AI, by headword.
const reviewedByWord = () =>
  (reviewed ??= new Map(
    [...packEntries().values()]
      .filter((e) => e.sourceStatus === 'ai')
      .map((e) => [lookupKey(e.word), e]),
  ));
export function learningDictionaryIndex(state: AppState): Map<string, Entry> {
  const index = new Map<string, Entry>(),
    score = (e: Entry) =>
      e.id === reviewedByWord().get(lookupKey(e.word))?.id
        ? 4
        : e.sourceStatus === 'ai'
          ? 3
          : e.sourceStatus === 'user'
            ? 2
            : 1;
  for (const e of state.entries) {
    const key = lookupKey(e.word),
      previous = index.get(key);
    if (!previous || score(e) > score(previous)) index.set(key, e);
  }
  return index;
}
export function learnedDictionaryEntry(
  state: AppState,
  record: DictionaryRecord,
): Entry | undefined {
  return (
    learningDictionaryIndex(state).get(lookupKey(record.word)) ??
    state.entries.find((e) => e.dictionaryRefs?.includes(record.id))
  );
}
// The short meanings shown for a dictionary row: from the learned entry when there is one, else
// from the record. Most records have only English meanings, so English stands in (`fallback`)
// when the current language has none; `text` is empty when neither language has any.
export function recordMeanings(
  record: DictionaryRecord,
  learned: Entry | undefined,
  locale: Locale,
  limit = 3,
): { text: string; fallback: boolean } {
  const pick = (l: Locale) =>
    [
      ...new Set(
        learned
          ? learned.groups.flatMap((g) => g.senses.map((s) => s.definitions[l].short.trim()))
          : record.lexemes.flatMap((x) => x.senses.flatMap((s) => s[l].map((m) => m.trim()))),
      ),
    ]
      .filter(Boolean)
      .slice(0, limit)
      .join(l === 'zh' ? '；' : '; ');
  const own = pick(locale);
  if (own || locale === 'en') return { text: own, fallback: false };
  const english = pick('en');
  return { text: english, fallback: Boolean(english) };
}
export function displayDictionaryEntry(state: AppState, record: DictionaryRecord): Entry | null {
  const live = learnedDictionaryEntry(state, record);
  if (live) return live;
  const builtIn = reviewedByWord().get(lookupKey(record.word));
  if (builtIn) return structuredClone(builtIn);
  return dictionaryEntry(record);
}
export function addDictionaryEntry(
  state: AppState,
  record: DictionaryRecord,
  locale: Locale,
  at = Date.now(),
): string {
  const existing = learnedDictionaryEntry(state, record);
  if (existing) return existing.id;
  const entry = dictionaryEntry(record, at);
  if (!entry || !entry.groups.some((g) => g.senses.some((s) => s.definitions[locale].short)))
    throw new Error('NO_EXPLANATION');
  // Reuse archived dictionary IDs so old tasks/events still refer to one entry.
  const archived = state.entries.find((e) => e.id === entry.id);
  if (archived) {
    archived.archived = false;
    archived.suspended = false;
    ensureTasks(state, 'recognition', at);
    return archived.id;
  }
  if (state.entries.some((e) => !e.archived && entryKey(e) === entryKey(entry)))
    throw new Error('DUPLICATE');
  const base =
    entry.kind === 'pronominal' ? lookupKey(entry.word.replace(/^(se\s|s['’])/i, '')) : null;
  const original = base
    ? state.entries.find(
        (e) =>
          e.kind === 'lexical' &&
          lookupKey(e.word) === base &&
          e.groups.some((g) => g.pos === 'verb'),
      )
    : null;
  if (original)
    entry.relations.push({
      id: entry.id + ':base',
      type: 'pronominal-of',
      targetId: original.id,
      notes: bilingual(),
      status: 'needs-review',
      source: 'Exact pronominal prefix rule',
    });
  state.entries.push(entry);
  ensureTasks(state, 'recognition', at);
  return entry.id;
}

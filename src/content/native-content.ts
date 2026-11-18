import { createHash } from 'node:crypto';
import type { ContentFiles, WordListFile } from './files';
import {
  letterOf,
  lookupKey,
  recordMeanings,
  searchFold,
  type DictionaryRecord,
} from '../domain/dictionary';

// Build-time only: the rows of the native app's content database (native/content-schema.sql). The values
// that depend only on content (lookup keys, folded search texts, browse order, default meanings) are made
// by the same functions the PWA uses, so the native lookups and search start from the same results.

// The 12-character content hash of the PWA's files (vite.config.ts names them content/<name>.<hash>.json).
export const contentHash = (data: unknown) =>
  createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 12);

export interface EntryRow {
  ord: number;
  id: string;
  word: string;
  lookup_key: string;
  source_status: string;
  frequency: number | null;
  lemma_rank: number | null;
  not_studied: number;
  edition: string | null;
  json: string;
}
export interface RecordRow {
  ord: number;
  id: string;
  word: string;
  word_fold: string;
  lookup_key: string;
  letter: string;
  browse_rank: number;
  pos_mask: number;
  meanings_zh: string;
  zh_fallback: number;
  meanings_en: string;
  head: string;
  t_zh: string;
  t_en: string;
  json: string;
}
export interface NativeContentRows {
  meta: Record<string, unknown>;
  entries: EntryRow[];
  records: RecordRow[];
  keys: [string, number][];
}

// The first release of the native app carries only the high-frequency words: the entries whose Lexique
// lemma rank is at most this (the "高频 2000" study scope). More words arrive with later app updates.
export const FIRST_RELEASE_LEMMA_RANK = 2000;

export type PackScope = 'all' | 'first-release';

// The word list cut down to the first release. Every per-entry table follows the entries; the retired map
// stays whole (it only says what an old id became). A relation to an entry outside the cut would stop the
// app from loading its pack, so that is an error here, at build time.
export function firstReleaseList(list: WordListFile): WordListFile {
  const ranks = list.lemmaRanks ?? {};
  const entries = list.entries.filter((e) => (ranks[e.id] ?? Infinity) <= FIRST_RELEASE_LEMMA_RANK);
  const kept = new Set(entries.map((e) => e.id));
  for (const e of entries)
    for (const r of e.relations ?? [])
      if (!kept.has(r.targetId))
        throw new Error(
          `Entry ${e.id} (${e.word}) has a relation to ${r.targetId} outside the first release`,
        );
  const senses = new Set(
    entries.flatMap((e) => e.groups.flatMap((g) => g.senses.map((s) => s.id))),
  );
  const only = <T>(table: Record<string, T>, keep: (id: string) => boolean) =>
    Object.fromEntries(Object.entries(table).filter(([id]) => keep(id)));
  return {
    ...list,
    entries,
    senseOrigins: only(list.senseOrigins, (id) => senses.has(id)),
    editions: only(list.editions, (id) => kept.has(id)),
    frequency: only(list.frequency, (id) => kept.has(id)),
    lemmaRanks: only(ranks, (id) => kept.has(id)),
    notStudied: (list.notStudied ?? []).filter((id) => kept.has(id)),
  };
}

// The content files of the full web build: the same first release as the native app, so both carry only the
// checked words. The dictionary stays whole. The rest of the word list stays in content/ for later releases.
export function releaseFiles(files: ContentFiles): ContentFiles {
  return { ...files, 'word-list': firstReleaseList(files['word-list']) };
}

export function nativeContentRows(
  files: Pick<ContentFiles, 'word-list' | 'dictionary'>,
  scope: PackScope = 'all',
): NativeContentRows {
  const list =
    scope === 'first-release' ? firstReleaseList(files['word-list']) : files['word-list'];
  const dictionary = files.dictionary;
  const records = dictionary.records as DictionaryRecord[];
  const notStudied = new Set(list.notStudied ?? []);

  const entries: EntryRow[] = list.entries.map((e, ord) => ({
    ord,
    id: e.id,
    word: e.word,
    lookup_key: lookupKey(e.word),
    source_status: e.sourceStatus,
    frequency: list.frequency?.[e.id] ?? null,
    lemma_rank: list.lemmaRanks?.[e.id] ?? null,
    not_studied: notStudied.has(e.id) ? 1 : 0,
    edition: list.editions?.[e.id] ?? null,
    json: JSON.stringify(e),
  }));

  // One bit per part of speech, in a fixed order (stored in the meta table).
  const posBits = [
    ...new Set(
      records.flatMap((r) => [...r.lexemes.map((l) => l.pos), ...r.morphology.map((m) => m.pos)]),
    ),
  ].sort();
  if (posBits.length > 30)
    throw new Error(`Too many parts of speech for a 31-bit mask: ${posBits.length}`);

  // Browse order: by letter, then French alphabetical order (as the PWA sorts the A–Z list).
  const collator = new Intl.Collator('fr');
  const letters = records.map((r) => letterOf(r.word));
  const order = records
    .map((_, i) => i)
    .sort(
      (a, b) =>
        letters[a].localeCompare(letters[b]) || collator.compare(records[a].word, records[b].word),
    );
  const rank = new Array<number>(records.length);
  order.forEach((i, position) => (rank[i] = position));

  const rows: RecordRow[] = records.map((r, ord) => {
    const zh = r.lexemes.flatMap((l) => l.senses.flatMap((s) => s.zh));
    const en = r.lexemes.flatMap((l) => l.senses.flatMap((s) => s.en));
    const meaningsZh = recordMeanings(r, undefined, 'zh');
    let mask = 0;
    for (const pos of [...r.lexemes.map((l) => l.pos), ...r.morphology.map((m) => m.pos)])
      mask |= 1 << posBits.indexOf(pos);
    return {
      ord,
      id: r.id,
      word: r.word,
      word_fold: searchFold(r.word),
      lookup_key: lookupKey(r.word),
      letter: letters[ord],
      browse_rank: rank[ord],
      pos_mask: mask,
      meanings_zh: meaningsZh.text,
      zh_fallback: meaningsZh.fallback ? 1 : 0,
      meanings_en: recordMeanings(r, undefined, 'en').text,
      head: searchFold([r.word, ...r.aliases].join(' ')),
      t_zh: searchFold(zh.join(' ')),
      t_en: searchFold(en.join(' ')),
      json: JSON.stringify(r),
    };
  });

  // lookupKey -> record; a later record with the same key replaces an earlier one, like the PWA's Map.
  const keys = new Map<string, number>();
  records.forEach((r, ord) => keys.set(lookupKey(r.word), ord));

  return {
    meta: {
      schema: 1,
      scope,
      packVersion: list.version,
      wordListHash: contentHash(list),
      dictionaryHash: contentHash(dictionary),
      dictionaryVersion: dictionary.manifest.version,
      senseOrigins: list.senseOrigins,
      editions: list.editions,
      retired: list.retired,
      dictionaryManifest: dictionary.manifest,
      conflicts: dictionary.conflicts,
      posBits,
    },
    entries,
    records: rows,
    keys: [...keys.entries()],
  };
}

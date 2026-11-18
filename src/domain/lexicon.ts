import type {
  Bilingual,
  Entry,
  Gender,
  LegacyEntry,
  Locale,
  PosGroup,
  Sense,
  VerbProfile,
} from './types';
import { cardSense } from './headword';
import { newId } from './id';
import { collectionOf } from './collections';
export { newId } from './id';
export const bilingual = (zh = '', en = ''): Bilingual => ({ zh, en });
export const newExample = () => ({
  id: newId(),
  text: '',
  translations: bilingual(),
  note: bilingual(),
  source: '',
});
export const newSense = (): Sense => ({
  id: newId(),
  definitions: {
    zh: { short: '', detail: '', usage: '' },
    en: { short: '', detail: '', usage: '' },
  },
  distance: 'unspecified',
  examples: [],
  collocations: [],
});
export const newVerb = (): VerbProfile => ({
  auxiliary: '',
  pastParticiple: '',
  presentParticiple: '',
  pronominalUse: '',
  pronounRequired: false,
  meaningDifference: bilingual(),
  agreementNote: bilingual(),
  conjugations: [],
});
export const newGroup = (pos = 'noun'): PosGroup => ({
  id: newId(),
  pos,
  gender: '',
  senses: [newSense()],
  forms: [],
  features: [],
  specialNotes: bilingual(),
  ...(pos === 'verb' ? { verb: newVerb() } : {}),
});
export function blankEntry(): Entry {
  const at = Date.now();
  return {
    id: newId(),
    word: '',
    ipa: '',
    kind: 'lexical',
    groups: [newGroup()],
    relations: [],
    families: [],
    tags: [],
    source: '',
    sources: [],
    sourceStatus: 'user',
    contentStatus: 'draft',
    favorite: false,
    suspended: false,
    archived: false,
    localizedNotes: {},
    createdAt: at,
    updatedAt: at,
    contentVersion: 1,
  };
}
export const sensesOf = (entry: Entry) => entry.groups.flatMap((group) => group.senses);
/** The distinct short meanings of all senses; a piece that an earlier sense already gave ("to learn" in
 *  "to learn; to find out") is not repeated. */
export const shortDefinition = (entry: Entry, locale: Locale) =>
  [
    ...new Set(
      sensesOf(entry)
        .flatMap((s) => s.definitions[locale].short.split(/[;；]/))
        .map((piece) => piece.trim())
        .filter(Boolean),
    ),
  ].join(locale === 'en' ? '; ' : '；');
export const primaryDefinition = (entry: Entry, locale: Locale) =>
  cardSense(entry, locale)?.sense.definitions[locale].short.trim() ?? '';
export const hasExplanation = (entry: Entry, locale: Locale) => Boolean(cardSense(entry, locale));
export const isSpecial = (entry: Entry) =>
  entry.kind === 'pronominal' || entry.groups.some((g) => g.features.length > 0);
export const specialNote = (entry: Entry, locale: Locale) =>
  entry.groups
    .map((g) => g.specialNotes[locale])
    .filter(Boolean)
    .join(' · ');
export const gendersOf = (entry: Entry): Gender[] => [
  ...new Set(
    entry.groups.flatMap((g) => g.senses.map((s) => s.gender ?? g.gender)).filter(Boolean),
  ),
];
export function entryKey(e: Pick<Entry, 'word' | 'kind'> & { id?: string }) {
  return `${e.word.normalize('NFC').trim().toLocaleLowerCase('fr').replace(/['’]/g, '’')}|${e.kind}${collectionOf(e) === 'word-list' ? '|word-list' : ''}`;
}
export function upgradeEntry(e: LegacyEntry): Entry {
  const group = newGroup(e.pos);
  group.id = `${e.id}:group:1`;
  group.gender = e.gender;
  const sense = group.senses[0];
  sense.id = `${e.id}:sense:1`;
  for (const locale of ['zh', 'en'] as const) {
    sense.definitions[locale] = { short: e[locale].short, detail: e[locale].detail, usage: '' };
    group.specialNotes[locale] = e[locale].irregularNote;
  }
  if (e.example) {
    const ex = newExample();
    ex.id = `${e.id}:example:1`;
    ex.text = e.example;
    ex.translations = bilingual(e.zh.exampleTranslation, e.en.exampleTranslation);
    sense.examples = [ex];
  }
  if (e.irregular) group.features = ['special-use'];
  const pronominal = /^(se\s|s['’])/i.test(e.word);
  if (pronominal && group.verb) {
    group.verb.pronounRequired = true;
    group.verb.pronominalUse = 'unspecified';
  }
  return {
    id: e.id,
    word: e.word,
    ipa: e.ipa,
    kind: pronominal ? 'pronominal' : 'lexical',
    groups: [group],
    relations: [],
    families: [],
    tags: [...e.tags],
    source: e.source,
    sources: [],
    sourceStatus: e.sourceStatus,
    contentStatus: 'needs-review',
    favorite: e.favorite,
    suspended: e.suspended,
    archived: e.archived,
    localizedNotes: { ...(e.note ? { [e.noteLanguage]: e.note } : {}), ...e.localizedNotes },
    createdAt: e.createdAt,
    updatedAt: e.createdAt,
    contentVersion: e.contentVersion,
    importBatchId: e.importBatchId,
  };
}
export function relatedEntries(entry: Entry, entries: Entry[]) {
  const outgoing = entry.relations.map((r) => ({
    entry: entries.find((e) => e.id === r.targetId),
    type: r.type,
    notes: r.notes,
    inverse: false,
  }));
  const incoming = entries.flatMap((e) =>
    e.relations
      .filter((r) => r.targetId === entry.id)
      .map((r) => ({ entry: e, type: r.type, notes: r.notes, inverse: true })),
  );
  const direct = new Set([...outgoing, ...incoming].map((r) => r.entry?.id));
  const family = entries
    .filter(
      (e) =>
        e.id !== entry.id &&
        !direct.has(e.id) &&
        e.families.some((f) => entry.families.some((own) => own.key === f.key)),
    )
    .map((e) => ({ entry: e, type: 'same-family' as const, notes: bilingual(), inverse: false }));
  return [...outgoing, ...incoming, ...family].filter((r) => r.entry);
}

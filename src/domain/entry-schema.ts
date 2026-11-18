import { Type, type Static, type TLiteral, type TUnion } from '@sinclair/typebox';

// The one definition of an entry's structure. It gives the TypeScript types (types.ts),
// the structural check in validateEntry (meaning-level rules stay in code there), and
// the JSON Schema exported to content/schema/entry.schema.json for the content tools.
// `default` values are what the content source files may leave out.

const oneOf = <T extends string>(...values: T[]) =>
  Type.Union(values.map((v) => Type.Literal(v))) as unknown as TUnion<TLiteral<T>[]>;
const text = (maxLength = 20_000, empty = true) =>
  Type.String(empty ? { maxLength, default: '' } : { maxLength });
// Required and not blank.
const filled = (maxLength: number) => Type.String({ maxLength, pattern: '\\S' });
const list = <T extends Parameters<typeof Type.Array>[0]>(item: T, maxItems: number) =>
  Type.Array(item, { maxItems, default: [] });

export const Locale = oneOf('zh', 'en');
export const Gender = oneOf('', 'm', 'f', 'common', 'variable', 'unknown');
export const ContentStatus = oneOf('draft', 'needs-review', 'reviewed');
export const SenseDistance = oneOf('unspecified', 'close', 'distinct', 'derived');
export const Feature = oneOf(
  'irregular-conjugation',
  'spelling-change',
  'irregular-form',
  'gender-meaning',
  'special-use',
  // Some persons or tenses do not exist (il pleut; no imperfect of clore).
  'defective',
);
export const Mood = oneOf(
  'indicative',
  'conditional',
  'subjunctive',
  'imperative',
  'infinitive',
  'participle',
  'gerund',
);
export const Person = oneOf('1s', '2s', '3s', '1p', '2p', '3p', 'none');
export const RelationType = oneOf(
  'pronominal-of',
  'derived-from',
  'same-family',
  'synonym',
  'antonym',
  'related',
);

export const Bilingual = Type.Object({ zh: text(), en: text() }, { default: { zh: '', en: '' } });
export const Definition = Type.Object({
  short: text(2000),
  detail: text(),
  usage: text(),
});
export const Example = Type.Object({
  id: filled(500),
  text: filled(20_000),
  translations: Bilingual,
  note: Bilingual,
  source: text(),
});
export const Collocation = Type.Object({
  id: filled(500),
  text: filled(20_000),
  translations: Bilingual,
});
export const Sense = Type.Object({
  id: filled(500),
  definitions: Type.Object({ zh: Definition, en: Definition }),
  gender: Type.Optional(Gender),
  distance: Type.Union(SenseDistance.anyOf, { default: 'unspecified' }),
  derivedFromSenseId: Type.Optional(Type.String()),
  examples: list(Example, 200),
  collocations: list(Collocation, 200),
});
export const WordForm = Type.Object({
  id: filled(500),
  form: filled(500),
  kind: oneOf('feminine', 'masculine', 'plural', 'variant'),
  gender: Type.Union(Gender.anyOf, { default: '' }),
  number: Type.Union(oneOf('', 'singular', 'plural').anyOf, { default: '' }),
  notes: Bilingual,
});
export const ConjugationRow = Type.Object({
  person: Person,
  forms: Type.Array(filled(1000), { minItems: 1, maxItems: 20 }),
});
export const ConjugationTable = Type.Object({
  id: filled(500),
  mood: Mood,
  tense: filled(100),
  status: oneOf('provided', 'not-provided', 'not-applicable'),
  rows: list(ConjugationRow, 20),
  notes: Bilingual,
  source: text(),
});
export const VerbProfile = Type.Object({
  auxiliary: Type.Union(oneOf('', 'avoir', 'être', 'variable').anyOf, { default: '' }),
  pastParticiple: text(1000),
  presentParticiple: text(1000),
  pronominalUse: Type.Union(
    oneOf('', 'reflexive', 'reciprocal', 'lexicalized', 'passive', 'unspecified').anyOf,
    { default: '' },
  ),
  pronounRequired: Type.Boolean({ default: false }),
  meaningDifference: Bilingual,
  agreementNote: Bilingual,
  conjugations: list(ConjugationTable, 200),
  paradigmRef: Type.Optional(Type.String({ maxLength: 500 })),
  // Teaching group (1: -er, 2: -ir with -iss-, 3: the rest) and, for the first group, the
  // stem spelling change; set by rule from the conjugation tables (scripts/check-verbs.py).
  group: Type.Optional(oneOf('1', '2', '3')),
  spellingChange: Type.Optional(oneOf('cer', 'ger', 'e-grave', 'e-acute', 'yer', 'double')),
});
export const PosGroup = Type.Object({
  id: filled(500),
  pos: filled(100),
  gender: Type.Union(Gender.anyOf, { default: '' }),
  senses: Type.Array(Sense, { minItems: 1, maxItems: 200 }),
  forms: list(WordForm, 500),
  features: Type.Array(Feature, { maxItems: 20, uniqueItems: true, default: [] }),
  specialNotes: Bilingual,
  verb: Type.Optional(VerbProfile),
});
export const EntryRelation = Type.Object({
  id: filled(500),
  type: RelationType,
  targetId: filled(500),
  notes: Bilingual,
  status: ContentStatus,
  source: text(),
});
export const FamilyMembership = Type.Object({
  key: filled(500),
  label: filled(500),
  root: text(500),
  notes: Bilingual,
  status: ContentStatus,
});
export const ContentSource = Type.Object({
  label: Type.String({ maxLength: 500 }),
  url: Type.String(),
  locator: text(500),
});
export const EntrySchema = Type.Object({
  id: filled(500),
  word: filled(500),
  ipa: text(500),
  kind: oneOf('lexical', 'pronominal'),
  groups: Type.Array(PosGroup, { minItems: 1, maxItems: 100 }),
  relations: list(EntryRelation, 500),
  families: list(FamilyMembership, 50),
  tags: list(Type.String({ maxLength: 200 }), 100),
  source: text(),
  sources: list(ContentSource, 100),
  sourceStatus: oneOf('sample', 'user', 'imported', 'ai'),
  contentStatus: ContentStatus,
  favorite: Type.Boolean({ default: false }),
  suspended: Type.Boolean({ default: false }),
  archived: Type.Boolean({ default: false }),
  localizedNotes: Type.Object(
    {
      zh: Type.Optional(Type.String({ maxLength: 20_000 })),
      en: Type.Optional(Type.String({ maxLength: 20_000 })),
    },
    { additionalProperties: false, default: {} },
  ),
  createdAt: Type.Integer({ minimum: 0 }),
  updatedAt: Type.Integer({ minimum: 0 }),
  contentVersion: Type.Integer({ minimum: 1 }),
  importBatchId: Type.Optional(Type.String({ maxLength: 20_000 })),
  headword: Type.Optional(
    Type.Object({
      sourceForm: Type.Optional(Type.String({ maxLength: 500 })),
      number: oneOf('singular', 'plural', 'unknown'),
      elision: oneOf('yes', 'no', 'unknown'),
    }),
  ),
  dictionaryRefs: Type.Optional(Type.Array(filled(500), { maxItems: 100 })),
  contentProvenance: Type.Optional(
    Type.Array(
      Type.Object({
        path: Type.String({ maxLength: 500 }),
        sourceId: Type.String({ maxLength: 500 }),
        locator: Type.String({ maxLength: 2000 }),
        method: Type.Literal('rule'),
        version: Type.String({ maxLength: 100 }),
      }),
      { maxItems: 1000 },
    ),
  ),
  cardDisplay: Type.Optional(
    Type.Object({ senseIds: Type.Optional(Type.Array(Type.String(), { maxItems: 200 })) }),
  ),
});

export type Locale = Static<typeof Locale>;
export type Gender = Static<typeof Gender>;
export type ContentStatus = Static<typeof ContentStatus>;
export type SenseDistance = Static<typeof SenseDistance>;
export type Feature = Static<typeof Feature>;
export type Mood = Static<typeof Mood>;
export type Person = Static<typeof Person>;
export type RelationType = Static<typeof RelationType>;
export type Bilingual = Static<typeof Bilingual>;
export type Definition = Static<typeof Definition>;
export type Example = Static<typeof Example>;
export type Collocation = Static<typeof Collocation>;
export type Sense = Static<typeof Sense>;
export type WordForm = Static<typeof WordForm>;
export type ConjugationRow = Static<typeof ConjugationRow>;
export type ConjugationTable = Static<typeof ConjugationTable>;
export type VerbProfile = Static<typeof VerbProfile>;
export type PosGroup = Static<typeof PosGroup>;
export type EntryRelation = Static<typeof EntryRelation>;
export type FamilyMembership = Static<typeof FamilyMembership>;
export type ContentSource = Static<typeof ContentSource>;
export type Entry = Static<typeof EntrySchema>;

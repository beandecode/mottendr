import { Type, type Static } from '@sinclair/typebox';
import Ajv2020 from 'ajv/dist/2020';

// Records of the user layer. Each TypeBox definition is both the TypeScript type and the
// JSON Schema used to check stored and imported records.

// A path into an entry. Strings are object keys; { id } picks an array item by its id
// (or `key` for word families), never by position.
export const PathSegment = Type.Union([Type.String(), Type.Object({ id: Type.String() })]);
const Path = Type.Array(PathSegment, { maxItems: 20 });

export const ContentPatch = Type.Union([
  // Replace a value; `base` is the built-in value at the time of the edit. It is absent
  // when the built-in entry had no such field (a stored `undefined` does not survive JSON).
  Type.Object({
    op: Type.Literal('set'),
    path: Path,
    value: Type.Unknown(),
    base: Type.Optional(Type.Unknown()),
  }),
  Type.Object({ op: Type.Literal('unset'), path: Path, base: Type.Optional(Type.Unknown()) }),
  // Insert an item into an id-keyed array after the item `after` (null: at the start).
  Type.Object({
    op: Type.Literal('add'),
    path: Path,
    item: Type.Unknown(),
    after: Type.Union([Type.String(), Type.Null()]),
  }),
  Type.Object({
    op: Type.Literal('remove'),
    path: Path,
    id: Type.String(),
    base: Type.Optional(Type.Unknown()),
    after: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  }),
]);
export type ContentPatch = Static<typeof ContentPatch>;
export type PathSegment = Static<typeof PathSegment>;

// Content edits to one built-in entry. contentVersion / updatedAt are kept only when
// they differ from the built-in values.
export const ContentPatchDoc = Type.Object({
  id: Type.String(),
  patches: Type.Array(ContentPatch, { maxItems: 10_000 }),
  contentVersion: Type.Optional(Type.Integer({ minimum: 1 })),
  updatedAt: Type.Optional(Type.Integer({ minimum: 0 })),
});
export type ContentPatchDoc = Static<typeof ContentPatchDoc>;

// Personal data on one built-in entry; only fields that differ from the built-in values.
// null means "removed".
export const Annotation = Type.Object({
  id: Type.String(),
  favorite: Type.Optional(Type.Boolean()),
  suspended: Type.Optional(Type.Boolean()),
  archived: Type.Optional(Type.Boolean()),
  localizedNotes: Type.Optional(
    Type.Object({ zh: Type.Optional(Type.String()), en: Type.Optional(Type.String()) }),
  ),
  cardDisplay: Type.Optional(
    Type.Union([Type.Object({ senseIds: Type.Optional(Type.Array(Type.String())) }), Type.Null()]),
  ),
  // The learner's tags: added to and hidden from the built-in tags, or (when the order
  // cannot be expressed that way) the complete list.
  addedTags: Type.Optional(Type.Array(Type.String())),
  hiddenTags: Type.Optional(Type.Array(Type.String())),
  tags: Type.Optional(Type.Array(Type.String())),
});
export type Annotation = Static<typeof Annotation>;

const ajv = new Ajv2020({ strict: false });
const checkPatchDoc = ajv.compile(ContentPatchDoc),
  checkAnnotation = ajv.compile(Annotation);
export function validatePatchDoc(v: unknown): asserts v is ContentPatchDoc {
  if (!checkPatchDoc(v)) throw new Error('INVALID_FILE');
}
export function validateAnnotation(v: unknown): asserts v is Annotation {
  if (!checkAnnotation(v)) throw new Error('INVALID_FILE');
}

// A content edit that a newer built-in pack conflicts with, waiting for the learner.
// 'changed': the built-in value changed since the edit (base -> pack); the edit (mine)
// stays in effect until resolved. 'removed': the edited item no longer exists.
export const ContentReviewItem = Type.Object({
  id: Type.String(),
  entryId: Type.String(),
  word: Type.String(),
  // 'retired': the built-in entry was replaced (pack = replacement ids); the learner's
  // copy and progress stay as they are.
  kind: Type.Union([Type.Literal('changed'), Type.Literal('removed'), Type.Literal('retired')]),
  path: Path,
  base: Type.Optional(Type.Unknown()),
  pack: Type.Optional(Type.Unknown()),
  mine: Type.Optional(Type.Unknown()),
  at: Type.Integer({ minimum: 0 }),
});
export type ContentReviewItem = Static<typeof ContentReviewItem>;
const checkReviewItem = ajv.compile(ContentReviewItem);
export function validateReviewItem(v: unknown): asserts v is ContentReviewItem {
  if (!checkReviewItem(v)) throw new Error('INVALID_FILE');
}

// Full backup from 0.7 on: only the user layer plus the pack version it was made with.
// Built-in content comes from the app, so restoring onto a newer pack keeps its updates.
export const BackupV3 = Type.Object({
  schemaVersion: Type.Literal(3),
  packVersion: Type.Integer({ minimum: 0 }),
  meta: Type.Object({ schemaVersion: Type.Literal(2) }, { additionalProperties: true }),
  entryOrder: Type.Array(Type.String(), { maxItems: 100_000 }),
  tasks: Type.Array(Type.Unknown(), { maxItems: 100_000 }),
  events: Type.Array(Type.Unknown(), { maxItems: 100_000 }),
  contentPatches: Type.Array(Type.Unknown(), { maxItems: 100_000 }),
  annotations: Type.Array(Type.Unknown(), { maxItems: 100_000 }),
  userEntries: Type.Array(Type.Unknown(), { maxItems: 100_000 }),
  issues: Type.Optional(Type.Array(Type.Unknown(), { maxItems: 100_000 })),
  contentLog: Type.Optional(Type.Array(Type.Unknown(), { maxItems: 100_000 })),
});
const checkBackup = ajv.compile(BackupV3);
export function validateBackupShape(v: unknown): asserts v is Static<typeof BackupV3> {
  if (!checkBackup(v)) throw new Error('INVALID_FILE');
}

// A problem the learner noticed while studying, to fix now or later.
export const ISSUE_KINDS = [
  'meaning',
  'gender-pos',
  'example',
  'conjugation',
  'missing',
  'other',
] as const;
export const Issue = Type.Object({
  id: Type.String(),
  entryId: Type.String(),
  senseId: Type.Optional(Type.String()),
  kind: Type.Union(ISSUE_KINDS.map((k) => Type.Literal(k))),
  note: Type.String({ maxLength: 5000 }),
  context: Type.String({ maxLength: 5000 }),
  status: Type.Union([Type.Literal('open'), Type.Literal('resolved'), Type.Literal('dismissed')]),
  createdAt: Type.Integer({ minimum: 0 }),
  closedAt: Type.Optional(Type.Integer({ minimum: 0 })),
  // contentVersion of the built-in entry when flagged; a newer pack may have fixed it.
  packVersion: Type.Optional(Type.Integer({ minimum: 1 })),
});
export type Issue = Static<typeof Issue>;
const checkIssue = ajv.compile(Issue);
export function validateIssue(v: unknown): asserts v is Issue {
  if (!checkIssue(v)) throw new Error('INVALID_FILE');
}

// One content change to one entry, as field patches from the previous to the new content
// (base = before, value / item = after). An undo is itself recorded, so it can be undone.
export const ContentLogRecord = Type.Object({
  id: Type.String(),
  entryId: Type.String(),
  word: Type.String(),
  at: Type.Integer({ minimum: 0 }),
  kind: Type.Union([Type.Literal('edit'), Type.Literal('undo')]),
  changes: Type.Array(ContentPatch, { maxItems: 10_000 }),
  undoOf: Type.Optional(Type.String()),
  undoneBy: Type.Optional(Type.String()),
});
export type ContentLogRecord = Static<typeof ContentLogRecord>;
const checkLogRecord = ajv.compile(ContentLogRecord);
export function validateLogRecord(v: unknown): asserts v is ContentLogRecord {
  if (!checkLogRecord(v)) throw new Error('INVALID_FILE');
}

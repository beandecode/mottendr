import type { Entry } from './types';
import type { Annotation, ContentPatch, ContentPatchDoc, PathSegment } from './user-layer';

// A built-in entry as the learner sees it = built-in content + content patches + annotation.
// splitEntry and resolveEntry are inverses: resolveEntry(base, splitEntry(base, e)) equals e.

type Json = unknown;
type Obj = Record<string, Json>;
const isObject = (v: Json): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

// Personal fields live in the annotation; tags are split into added / hidden.
const annotationKeys = [
  'favorite',
  'suspended',
  'archived',
  'localizedNotes',
  'cardDisplay',
] as const;
// Per-entry metadata, kept in the patch document when it differs from the built-in value.
const metaKeys = ['contentVersion', 'updatedAt'] as const;
const excluded = new Set<string>([...annotationKeys, ...metaKeys, 'tags']);

// Undefined properties count as absent, as in JSON.
export function deepEqual(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (!isObject(a) || !isObject(b)) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (!deepEqual(a[k], b[k])) return false;
  return true;
}

const keyOf = (item: Json): string | undefined =>
  isObject(item)
    ? typeof item.id === 'string'
      ? item.id
      : typeof item.key === 'string'
        ? item.key
        : undefined
    : undefined;
// Arrays of records with unique ids are diffed item by item; other arrays are values.
function keyed(list: Json[]): string[] | null {
  const ids = list.map(keyOf);
  if (ids.some((id) => id === undefined) || new Set(ids).size !== ids.length) return null;
  return ids as string[];
}

function diffValue(base: Json, edited: Json, path: PathSegment[], out: ContentPatch[]) {
  if (deepEqual(base, edited)) return;
  if (edited === undefined) {
    out.push({ op: 'unset', path, base });
    return;
  }
  if (Array.isArray(base) && Array.isArray(edited)) {
    const baseIds = keyed(base),
      editedIds = keyed(edited);
    if (baseIds && editedIds) {
      const kept = new Set(editedIds),
        common = baseIds.filter((id) => kept.has(id)),
        old = new Set(baseIds);
      // Reordering existing items cannot be expressed item by item: replace the list.
      if (common.join('\n') === editedIds.filter((id) => old.has(id)).join('\n')) {
        baseIds.forEach((id, i) => {
          if (!kept.has(id))
            out.push({ op: 'remove', path, id, base: base[i], after: i ? baseIds[i - 1] : null });
        });
        edited.forEach((item, i) => {
          const id = editedIds[i];
          if (old.has(id)) diffValue(base[baseIds.indexOf(id)], item, [...path, { id }], out);
          else out.push({ op: 'add', path, item, after: i ? editedIds[i - 1] : null });
        });
        return;
      }
    }
  } else if (isObject(base) && isObject(edited)) {
    for (const k of new Set([...Object.keys(base), ...Object.keys(edited)]))
      diffValue(base[k], edited[k], [...path, k], out);
    return;
  }
  out.push({ op: 'set', path, value: edited, base });
}

export function diffContent(base: Entry, edited: Entry): ContentPatch[] {
  const out: ContentPatch[] = [];
  const b = base as unknown as Obj,
    e = edited as unknown as Obj;
  for (const k of new Set([...Object.keys(b), ...Object.keys(e)]))
    if (!excluded.has(k)) diffValue(b[k], e[k], [k], out);
  return out;
}

// Returns false when the patch no longer fits the base (its target was removed).
// Follows the first `end` segments of `path`; undefined when something on the way is gone.
function walk(root: Json, path: PathSegment[], end: number): Json {
  let node: Json = root;
  for (let i = 0; i < end; i++) {
    const segment = path[i];
    if (typeof segment === 'string') node = isObject(node) ? node[segment] : undefined;
    else node = Array.isArray(node) ? node.find((item) => keyOf(item) === segment.id) : undefined;
    if (node === undefined) return undefined;
  }
  return node;
}
function valueAt(root: Json, path: PathSegment[]): { found: boolean; value?: Json } {
  const parent = walk(root, path, path.length - 1),
    segment = path.at(-1)!;
  if (typeof segment === 'string')
    return isObject(parent) ? { found: true, value: parent[segment] } : { found: false };
  const item = Array.isArray(parent) ? parent.find((x) => keyOf(x) === segment.id) : undefined;
  return item === undefined ? { found: false } : { found: true, value: item };
}

function applyPatch(root: Obj, patch: ContentPatch): boolean {
  const path = patch.path,
    last = patch.op === 'add' || patch.op === 'remove' ? path.length : path.length - 1;
  const parent = walk(root, path, last);
  if (parent === undefined) return false;
  if (patch.op === 'add' || patch.op === 'remove') {
    if (!Array.isArray(parent)) return false;
    if (patch.op === 'remove') {
      const i = parent.findIndex((item) => keyOf(item) === patch.id);
      if (i < 0) return false;
      parent.splice(i, 1);
    } else {
      let at = 0;
      if (patch.after !== null) {
        const i = parent.findIndex((item) => keyOf(item) === patch.after);
        // The neighbour is gone (removed upstream): keep the item, at the end.
        at = i < 0 ? parent.length : i + 1;
      }
      parent.splice(at, 0, structuredClone(patch.item));
    }
    return true;
  }
  const segment = path[last];
  if (typeof segment === 'string') {
    if (!isObject(parent)) return false;
    if (patch.op === 'unset') delete parent[segment];
    else parent[segment] = structuredClone(patch.value);
  } else {
    if (!Array.isArray(parent)) return false;
    const i = parent.findIndex((item) => keyOf(item) === segment.id);
    if (patch.op === 'unset') {
      if (i >= 0) parent.splice(i, 1);
    } else if (i < 0) parent.push(structuredClone(patch.value));
    else parent[i] = structuredClone(patch.value);
  }
  return true;
}

// Sets (or, with undefined, removes) the value at `path` in a plain entry.
// Undoing a change: each patch is checked against the current entry first (the change must
// still be in place, not edited again since), then reverted, last patch first.
function inPlace(entry: Json, p: ContentPatch): boolean {
  if (p.op === 'set' || p.op === 'unset') {
    const now = valueAt(entry, p.path);
    return now.found && deepEqual(now.value, p.op === 'set' ? p.value : undefined);
  }
  const list = walk(entry, p.path, p.path.length);
  if (!Array.isArray(list)) return false;
  const present = list.some((item) => keyOf(item) === (p.op === 'add' ? keyOf(p.item) : p.id));
  return p.op === 'add' ? present : !present;
}
export const canRevert = (entry: Entry, patches: ContentPatch[]) =>
  patches.every((p) => inPlace(entry, p));
// The inverse patches, in the order they must be applied.
export function inversePatches(patches: ContentPatch[]): ContentPatch[] {
  return [...patches].reverse().map((p): ContentPatch => {
    if (p.op === 'add')
      return { op: 'remove', path: p.path, id: keyOf(p.item)!, base: p.item, after: p.after };
    if (p.op === 'remove') return { op: 'add', path: p.path, item: p.base, after: p.after ?? null };
    const now = p.op === 'set' ? p.value : undefined;
    return p.base === undefined
      ? { op: 'unset', path: p.path, base: now }
      : { op: 'set', path: p.path, value: p.base, base: now };
  });
}
export function applyPatches(entry: Entry, patches: ContentPatch[]) {
  return patches.every((p) => applyPatch(entry as unknown as Obj, p));
}

export const setAtPath = (entry: Entry, path: PathSegment[], value: Json) =>
  applyPatch(
    entry as unknown as Obj,
    value === undefined
      ? { op: 'unset', path, base: undefined }
      : { op: 'set', path, value, base: undefined },
  );

export interface PatchReview {
  kind: 'changed' | 'removed';
  path: PathSegment[];
  base?: Json;
  pack?: Json;
  mine?: Json;
}
// Compares stored edits with the current built-in entry. `stale` means at least one patch
// was written against an older built-in value and the document should be rewritten.
// An edit the pack has caught up with is simply redundant; one whose built-in value
// changed in another way, or whose target was removed, needs the learner's decision.
export function reviewPatches(base: Entry, doc: ContentPatchDoc) {
  let stale = false;
  const items: PatchReview[] = [];
  for (const p of doc.patches) {
    if (p.op === 'add') {
      if (!Array.isArray(walk(base, p.path, p.path.length))) {
        stale = true;
        items.push({ kind: 'removed', path: p.path, mine: p.item });
      }
      continue;
    }
    if (p.op === 'remove') {
      const now = valueAt(base, [...p.path, { id: p.id }]);
      if (!now.found) stale = true;
      else if (!deepEqual(now.value, p.base)) {
        stale = true;
        items.push({
          kind: 'changed',
          path: [...p.path, { id: p.id }],
          base: p.base,
          pack: now.value,
        });
      }
      continue;
    }
    const now = valueAt(base, p.path),
      mine = p.op === 'set' ? p.value : undefined;
    if (!now.found) {
      stale = true;
      items.push({ kind: 'removed', path: p.path, base: p.base, mine });
    } else if (!deepEqual(now.value, p.base)) {
      stale = true;
      if (!deepEqual(now.value, mine))
        items.push({ kind: 'changed', path: p.path, base: p.base, pack: now.value, mine });
    }
  }
  return { stale, items };
}

export function splitEntry(
  base: Entry,
  entry: Entry,
): { doc: ContentPatchDoc | null; annotation: Annotation | null } {
  const patches = diffContent(base, entry);
  const doc: ContentPatchDoc = { id: entry.id, patches };
  for (const k of metaKeys) if (entry[k] !== base[k]) doc[k] = entry[k];
  const annotation: Annotation = { id: entry.id };
  for (const k of annotationKeys)
    if (!deepEqual(base[k], entry[k]))
      (annotation as Obj)[k] = entry[k] === undefined && k === 'cardDisplay' ? null : entry[k];
  if (!deepEqual(base.tags, entry.tags)) {
    const own = new Set(entry.tags),
      builtIn = new Set(base.tags);
    const hidden = base.tags.filter((t) => !own.has(t)),
      added = entry.tags.filter((t) => !builtIn.has(t));
    // Prefer added / hidden so later built-in tags still arrive; fall back to the full list.
    if (deepEqual([...base.tags.filter((t) => own.has(t)), ...added], entry.tags)) {
      if (added.length) annotation.addedTags = added;
      if (hidden.length) annotation.hiddenTags = hidden;
    } else annotation.tags = [...entry.tags];
  }
  return {
    doc: patches.length || metaKeys.some((k) => k in doc) ? doc : null,
    annotation: Object.keys(annotation).length > 1 ? annotation : null,
  };
}

export function resolveEntry(
  base: Entry,
  doc?: ContentPatchDoc | null,
  annotation?: Annotation | null,
): { entry: Entry; unapplied: ContentPatch[] } {
  if (!doc && !annotation) return { entry: base, unapplied: [] };
  const entry = structuredClone(base) as unknown as Obj;
  const unapplied = (doc?.patches ?? []).filter((p) => !applyPatch(entry, p));
  for (const k of metaKeys) if (doc?.[k] !== undefined) entry[k] = doc[k];
  if (annotation) {
    for (const k of annotationKeys) {
      const value = (annotation as Obj)[k];
      if (value === null) delete entry[k];
      else if (value !== undefined) entry[k] = structuredClone(value);
    }
    const hidden = new Set(annotation.hiddenTags ?? []);
    entry.tags = annotation.tags
      ? [...annotation.tags]
      : [...base.tags.filter((t) => !hidden.has(t)), ...(annotation.addedTags ?? [])];
  }
  return { entry: entry as unknown as Entry, unapplied };
}

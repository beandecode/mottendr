import { content as contentFile } from '../content/files';
import { packVersion } from './pack';
import type { AppState, Entry } from './types';
interface DefinitionPatches {
  version: number;
  changes: {
    id: string;
    word: string;
    kind: Entry['kind'];
    groupIds: string[];
    groups: {
      id: string;
      pos: string;
      gender: string;
      beforeSenses: unknown;
      afterSenses: unknown;
    }[];
    addedGroups: unknown[];
    fields: Record<string, { before: unknown; after: unknown }>;
  }[];
}
// Atomic per-entry sense update: changed meanings, examples, POS or identity cause a skip.
// Verb tables, forms, notes, flags, tasks, history and sessions are retained from live state.
export function upgradeDefinitions(state: AppState, at: number): boolean {
  const collection = state.installedCollections?.find((c) => c.id === 'word-list');
  if (!collection || collection.version >= packVersion()) return false;
  const content = contentFile('legacy-upgrade').definitions as DefinitionPatches;
  const entries = new Map(state.entries.map((e) => [e.id, e]));
  for (const patch of content.changes) {
    const entry = entries.get(patch.id);
    if (!entry || entry.word !== patch.word || entry.kind !== patch.kind) continue;
    if (JSON.stringify(entry.groups.map((g) => g.id)) !== JSON.stringify(patch.groupIds)) continue;
    if (
      patch.groups.some((p) => {
        const g = entry.groups.find((g) => g.id === p.id);
        return (
          !g ||
          g.pos !== p.pos ||
          g.gender !== p.gender ||
          JSON.stringify(g.senses) !== JSON.stringify(p.beforeSenses)
        );
      })
    )
      continue;
    for (const p of patch.groups)
      entry.groups.find((g) => g.id === p.id)!.senses = structuredClone(
        p.afterSenses,
      ) as Entry['groups'][number]['senses'];
    entry.groups.push(...(structuredClone(patch.addedGroups) as Entry['groups']));
    const target = entry as unknown as Record<string, unknown>;
    for (const [key, values] of Object.entries(patch.fields)) {
      if (JSON.stringify(target[key] ?? null) === JSON.stringify(values.before)) {
        if (values.after === null) delete target[key];
        else target[key] = structuredClone(values.after);
      }
    }
    entry.contentVersion++;
    entry.updatedAt = at;
  }
  collection.version = content.version;
  return true;
}

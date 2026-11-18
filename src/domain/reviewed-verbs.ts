import { content } from '../content/files';
import type { Entry, VerbProfile } from './types';
export interface VerbCompletions {
  version: number;
  changes: { entryId: string; word: string; groupId: string; before: unknown; after: unknown }[];
}
// Replace a whole profile only when its previously shipped value still matches.
export function completeReviewedVerb(
  entry: Entry,
  data = content('legacy-upgrade').verbs as VerbCompletions,
): boolean {
  if (entry.kind !== 'lexical') return false;
  let changed = false;
  for (const p of data.changes.filter((p) => p.entryId === entry.id && p.word === entry.word)) {
    const group = entry.groups.find((g) => g.id === p.groupId && g.pos === 'verb');
    if (!group || JSON.stringify(group.verb) !== JSON.stringify(p.before)) continue;
    group.verb = structuredClone(p.after) as VerbProfile;
    changed = true;
  }
  return changed;
}

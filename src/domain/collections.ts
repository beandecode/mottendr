import { lemmaRank } from './pack';
import type { AppState, Entry } from './types';

// Where an entry comes from. Derived from the stable ID prefix instead of being stored
// as a tag, so tags stay free for the learner's own labels.
export type CollectionId = 'word-list' | 'dictionary' | 'user';
export const COLLECTIONS: CollectionId[] = ['word-list', 'dictionary', 'user'];
export const isCollection = (scope: string): scope is CollectionId =>
  (COLLECTIONS as string[]).includes(scope);
export const collectionOf = (entry: { id?: string }): CollectionId =>
  entry.id?.startsWith('word-list-')
    ? 'word-list'
    : entry.id?.startsWith('dict:')
      ? 'dictionary'
      : 'user';

// Built-in scopes derived from content data, not stored as tags (that would change every
// finished entry): built-in entries that cover one of the 500, 1,000 or 2,000 most frequent
// Lexique lemmas (content/word-list/frequency.json, scripts/frequency.py). The tiers are nested
// (top 500 is inside top 1,000), and progress belongs to the entry, so it is shared by all of them.
export const TOP_500 = 'top-500';
export const TOP_1000 = 'top-1000';
export const TOP_2000 = 'top-2000';
export const TOP_RANK = 2000;
export const TOP_TIERS: [scope: string, rank: number][] = [
  [TOP_500, 500],
  [TOP_1000, 1000],
  [TOP_2000, 2000],
];
const tierRank = (scope: string) => TOP_TIERS.find(([s]) => s === scope)?.[1];
export const isTopTier = (scope: string) => tierRank(scope) !== undefined;
export const inTop = (entry: { id?: string }, rank: number) =>
  entry.id !== undefined && (lemmaRank(entry.id) ?? Infinity) <= rank;
export const inTop2000 = (entry: { id?: string }) => inTop(entry, TOP_RANK);

// A learning scope is empty (everything), a collection, a frequency tier, or a tag.
export const inScope = (entry: Pick<Entry, 'id' | 'tags'>, scope: string) => {
  if (!scope) return true;
  const rank = tierRank(scope);
  return rank !== undefined
    ? inTop(entry, rank)
    : collectionOf(entry) === scope || entry.tags.includes(scope);
};

// The study scopes the entries offer: collections, then the frequency tiers, then tags. The whole
// built-in collection is not offered (since 2026-11-17: the app carries only the first release, so
// it equals the top 2,000). A tier is offered when it has entries; a smaller tier only when it holds
// fewer than the next larger one (in the demo, whose words all rank within 500, only the top 2,000).
export function scopeOptions(entries: Entry[], includeArchived = false) {
  const collections = new Set<string>(),
    tags = new Set<string>();
  const counts = TOP_TIERS.map(() => 0);
  for (const e of entries) {
    if (e.archived && !includeArchived) continue;
    collections.add(collectionOf(e));
    e.tags.forEach((t) => tags.add(t));
    TOP_TIERS.forEach(([, rank], i) => {
      if (inTop(e, rank)) counts[i]++;
    });
  }
  const tiers = TOP_TIERS.filter(
    (_, i) => counts[i] > 0 && (i === TOP_TIERS.length - 1 || counts[i] < counts[i + 1]),
  ).map(([scope]) => scope);
  return [
    ...COLLECTIONS.filter((c) => c !== 'word-list' && collections.has(c)),
    ...tiers,
    ...[...tags].filter((t) => !isCollection(t) && !isTopTier(t)),
  ];
}

// Before 0.7 the collection was also written into tags ('word-list', 'dictionary').
export function stripCollectionTags(state: Pick<AppState, 'entries'>) {
  for (const e of state.entries) {
    const collection = collectionOf(e);
    if (collection !== 'user' && e.tags.includes(collection))
      e.tags = e.tags.filter((t) => t !== collection);
  }
}

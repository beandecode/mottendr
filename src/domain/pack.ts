import { freeze } from 'immer';
import { content } from '../content/files';
import type { Entry } from './types';

// The built-in collection exactly as a fresh install sees it, read-only. Its source is
// content/word-list/entries/; the build turns it into content/word-list.*.json.
// Entries listed as not studied by default start paused: the learner layer stores only
// differences from these values, so resuming one is kept as the learner's own choice.
let pack: ReadonlyMap<string, Entry> | undefined,
  notStudied: ReadonlySet<string> = new Set(),
  source: unknown;
export function packEntries(): ReadonlyMap<string, Entry> {
  const file = content('word-list');
  if (source !== file) {
    notStudied = new Set(file.notStudied ?? []);
    pack = new Map(
      file.entries.map((e) => [
        e.id,
        freeze(notStudied.has(e.id) ? { ...e, suspended: true } : e, true),
      ]),
    );
    source = file;
  }
  return pack!;
}
// A grammar word the pack leaves out of study unless the learner resumes it.
export const notStudiedByDefault = (entryId: string) => {
  packEntries();
  return notStudied.has(entryId);
};
export const packVersion = () => content('word-list').version;
// How a built-in sense was produced: rule conversion unless listed otherwise.
export const senseOrigin = (senseId: string) =>
  content('word-list').senseOrigins[senseId] ?? 'source';
export const retiredContent = () => content('word-list').retired;
// "1.0.0" once the built-in entry meets the definition of done; undefined before.
export const entryEdition = (entryId: string): string | undefined =>
  content('word-list').editions?.[entryId];
// Place of a built-in entry in word frequency order (1 = most frequent).
export const frequencyRank = (entryId: string): number | undefined =>
  content('word-list').frequency?.[entryId];
// Place among Lexique lemmas of the most frequent lemma a built-in entry covers (1 = most
// frequent); undefined for other entries.
export const lemmaRank = (entryId: string): number | undefined =>
  content('word-list').lemmaRanks?.[entryId];

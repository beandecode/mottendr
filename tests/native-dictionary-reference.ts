import {
  learningDictionaryIndex,
  lookupKey,
  searchFold,
  type DictionaryRecord,
} from '../src/domain/dictionary';
import { localeFor, type AppState } from '../src/domain/types';

// The PWA's dictionary search (components/Dictionary.tsx), as a function over records, for the native golden
// data. Returns the positions (file order) of the matching records, exact headword matches first.
export function referenceSearch(
  records: DictionaryRecord[],
  query: string,
  pos: string,
  mode: AppState['prefs']['mode'],
  state: Pick<AppState, 'entries'>,
): number[] {
  const locale = localeFor(mode);
  const learnedIndex = learningDictionaryIndex(state as AppState);
  const q = searchFold(query.trim());
  if (!q && !pos) return [];
  return records
    .map((r, ord) => ({ r, ord }))
    .filter(
      ({ r }) =>
        (!pos || r.lexemes.some((l) => l.pos === pos) || r.morphology.some((m) => m.pos === pos)) &&
        (!q ||
          searchFold(
            [
              r.word,
              ...r.aliases,
              ...(learnedIndex
                .get(lookupKey(r.word))
                ?.groups.flatMap((g) =>
                  g.senses.flatMap((s) =>
                    mode === 'zhEnAssist'
                      ? [s.definitions.zh.short, s.definitions.en.short]
                      : [s.definitions[locale].short],
                  ),
                ) ??
                r.lexemes.flatMap((l) =>
                  l.senses.flatMap((s) => (mode === 'zhEnAssist' ? [...s.zh, ...s.en] : s[locale])),
                )),
            ].join(' '),
          ).includes(q)),
    )
    .sort((a, b) => Number(searchFold(b.r.word) === q) - Number(searchFold(a.r.word) === q))
    .map(({ ord }) => ord);
}

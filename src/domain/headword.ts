import type { Entry, Locale, Preferences, Sense } from './types';

// The learner can select senses in a future UI. Progress remains per entry.
export function cardSense(
  entry: Entry,
  locale: Locale,
): { group: Entry['groups'][number]; sense: Sense } | undefined {
  const chosen = entry.cardDisplay?.senseIds;
  return entry.groups
    .flatMap((group) => group.senses.map((sense) => ({ group, sense })))
    .find(
      ({ sense }) =>
        (!chosen?.length || chosen.includes(sense.id)) && sense.definitions[locale].short.trim(),
    );
}
export function normalizeHeadword(entry: Entry): boolean {
  const word = entry.word.normalize('NFC').trim();
  const match = /^((?:le|la|les|un|une|des)\s+|l['’])(.+)$/i.exec(word);
  if (entry.kind === 'pronominal' || !entry.groups.some((g) => g.pos === 'noun') || !match) {
    const changed = entry.word !== word;
    entry.word = word;
    return changed;
  }
  const prefix = match[1].trim().toLocaleLowerCase('fr');
  entry.word = match[2].trim();
  entry.headword = {
    sourceForm: word,
    number: ['les', 'des'].includes(prefix) ? 'plural' : 'singular',
    elision: ["l'", 'l’'].includes(prefix)
      ? 'yes'
      : ['le', 'la'].includes(prefix)
        ? 'no'
        : 'unknown',
  };
  return true;
}
export function frenchDisplay(
  entry: Entry,
  prefs: Pick<Preferences, 'showArticles' | 'mode'>,
  locale: Locale = prefs.mode === 'enOnly' ? 'en' : 'zh',
): string {
  if (!prefs.showArticles || entry.kind === 'pronominal') return entry.word;
  const selected = cardSense(entry, locale),
    noun = selected?.group;
  if (!noun || noun.pos !== 'noun') return entry.word;
  const gender = selected!.sense.gender ?? noun.gender;
  if (gender !== 'm' && gender !== 'f') return entry.word;
  if (entry.headword?.number === 'plural') return `les ${entry.word}`;
  // Plural-looking unknown forms and unknown h/y are intentionally undecided.
  if (entry.headword?.number !== 'singular') return entry.word;
  const elision = entry.headword.elision;
  if (elision === 'yes') return `l’${entry.word}`;
  if (elision === 'no') return `${gender === 'm' ? 'le' : 'la'} ${entry.word}`;
  if (/^[hy]/i.test(entry.word)) return entry.word;
  if (/^(onze|onzième|oui|ouistiti)(\b|s\b)/i.test(entry.word))
    return `${gender === 'm' ? 'le' : 'la'} ${entry.word}`;
  return /^[aeiouàâäéèêëîïôöùûüœæ]/i.test(entry.word)
    ? `l’${entry.word}`
    : `${gender === 'm' ? 'le' : 'la'} ${entry.word}`;
}

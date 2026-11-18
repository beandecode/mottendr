import type { LanguageMode, VerbProfile } from './types';

// Labels for a verb's teaching group and first-group spelling change (set by
// scripts/check-verbs.py), shown on the card back and in the entry's verb section.
const spellingChanges: Record<string, [string, string]> = {
  cer: ['c→ç', 'c→ç'],
  ger: ['g→ge', 'g→ge'],
  'e-grave': ['e→è', 'e→è'],
  'e-acute': ['é→è', 'é→è'],
  yer: ['y→i', 'y→i'],
  double: ['双写辅音', 'doubled consonant'],
};
// "第一组 · e→è": the verb's teaching group and its first-group spelling change.
export const verbGroupText = (verb: VerbProfile | undefined, mode: LanguageMode) => {
  if (!verb?.group) return '';
  const en = mode === 'enOnly';
  const group = en ? `Group ${verb.group}` : `第${['一', '二', '三'][Number(verb.group) - 1]}组`;
  const change = verb.spellingChange && spellingChanges[verb.spellingChange];
  return change ? `${group} · ${change[en ? 1 : 0]}` : group;
};

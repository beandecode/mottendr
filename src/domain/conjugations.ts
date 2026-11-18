import type { ConjugationTable, Mood, Person, VerbProfile } from './types';
import { bilingual } from './lexicon';
export const persons: Person[] = ['1s', '2s', '3s', '1p', '2p', '3p'];
export const subjects = ['je', 'tu', 'il / elle / on', 'nous', 'vous', 'ils / elles'];
export const moodNames = {
  indicative: ['直陈式', 'Indicative'],
  conditional: ['条件式', 'Conditional'],
  subjunctive: ['虚拟式', 'Subjunctive'],
  imperative: ['命令式', 'Imperative'],
  infinitive: ['不定式', 'Infinitive'],
  participle: ['分词', 'Participle'],
  gerund: ['副动词', 'Gerund'],
} as const;
export const tenseNames: Record<string, readonly [string, string]> = {
  present: ['现在时', 'Present'],
  imperfect: ['未完成过去时', 'Imperfect'],
  'future-simple': ['简单将来时', 'Simple future'],
  'past-composed': ['复合过去时', 'Passé composé'],
  pluperfect: ['愈过去时', 'Pluperfect'],
  'past-simple': ['简单过去时', 'Passé simple'],
  'past-anterior': ['先过去时', 'Past anterior'],
  'future-anterior': ['先将来时', 'Future perfect'],
  past: ['过去式', 'Past'],
  composed: ['复合式', 'Compound'],
};
export const conjugationSlots: [Mood, string][] = [
  ...[
    'present',
    'imperfect',
    'future-simple',
    'past-composed',
    'pluperfect',
    'past-simple',
    'past-anterior',
    'future-anterior',
  ].map((t) => ['indicative', t] as [Mood, string]),
  ...['present', 'past'].map((t) => ['conditional', t] as [Mood, string]),
  ...['present', 'past', 'imperfect', 'pluperfect'].map(
    (t) => ['subjunctive', t] as [Mood, string],
  ),
  ...['present', 'past'].map((t) => ['imperative', t] as [Mood, string]),
  ...['present', 'past'].map((t) => ['infinitive', t] as [Mood, string]),
  ...['present', 'past', 'composed'].map((t) => ['participle', t] as [Mood, string]),
  ...['present', 'past'].map((t) => ['gerund', t] as [Mood, string]),
];
export const blankTable = (groupId: string, mood: Mood, tense: string): ConjugationTable => ({
  id: `${groupId}:${mood}:${tense}`,
  mood,
  tense,
  status: 'not-provided',
  rows: [],
  notes: bilingual(),
  source: '',
});
// Authored starter paradigms, checked against the linked conjugator. Not a general conjugation engine.
const paradigms: Record<
  string,
  {
    present: string[];
    imperfect: string[];
    future: string[];
    conditional: string[];
    imperative: string[];
    past: string;
    participle: string;
    auxiliary: 'avoir' | 'être';
    source: string;
  }
> = {
  être: {
    present: ['suis', 'es', 'est', 'sommes', 'êtes', 'sont'],
    imperfect: ['étais', 'étais', 'était', 'étions', 'étiez', 'étaient'],
    future: ['serai', 'seras', 'sera', 'serons', 'serez', 'seront'],
    conditional: ['serais', 'serais', 'serait', 'serions', 'seriez', 'seraient'],
    imperative: ['sois', 'soyons', 'soyez'],
    past: 'été',
    participle: 'étant',
    auxiliary: 'avoir',
    source: 'https://www.larousse-edu.fr/conjugaison/francais/%C3%AAtre/4440',
  },
  avoir: {
    present: ['ai', 'as', 'a', 'avons', 'avez', 'ont'],
    imperfect: ['avais', 'avais', 'avait', 'avions', 'aviez', 'avaient'],
    future: ['aurai', 'auras', 'aura', 'aurons', 'aurez', 'auront'],
    conditional: ['aurais', 'aurais', 'aurait', 'aurions', 'auriez', 'auraient'],
    imperative: ['aie', 'ayons', 'ayez'],
    past: 'eu',
    participle: 'ayant',
    auxiliary: 'avoir',
    source: 'https://www.larousse.fr/conjugaison/francais/avoir/749',
  },
  aller: {
    present: ['vais', 'vas', 'va', 'allons', 'allez', 'vont'],
    imperfect: ['allais', 'allais', 'allait', 'allions', 'alliez', 'allaient'],
    future: ['irai', 'iras', 'ira', 'irons', 'irez', 'iront'],
    conditional: ['irais', 'irais', 'irait', 'irions', 'iriez', 'iraient'],
    imperative: ['va', 'allons', 'allez'],
    past: 'allé',
    participle: 'allant',
    auxiliary: 'être',
    source: 'https://www.larousse.fr/fr/conjugaison/francais/aller/314',
  },
  faire: {
    present: ['fais', 'fais', 'fait', 'faisons', 'faites', 'font'],
    imperfect: ['faisais', 'faisais', 'faisait', 'faisions', 'faisiez', 'faisaient'],
    future: ['ferai', 'feras', 'fera', 'ferons', 'ferez', 'feront'],
    conditional: ['ferais', 'ferais', 'ferait', 'ferions', 'feriez', 'feraient'],
    imperative: ['fais', 'faisons', 'faites'],
    past: 'fait',
    participle: 'faisant',
    auxiliary: 'avoir',
    source: 'https://www.larousse.fr/conjugaison/francais/faire/4599',
  },
  parler: {
    present: ['parle', 'parles', 'parle', 'parlons', 'parlez', 'parlent'],
    imperfect: ['parlais', 'parlais', 'parlait', 'parlions', 'parliez', 'parlaient'],
    future: ['parlerai', 'parleras', 'parlera', 'parlerons', 'parlerez', 'parleront'],
    conditional: ['parlerais', 'parlerais', 'parlerait', 'parlerions', 'parleriez', 'parleraient'],
    imperative: ['parle', 'parlons', 'parlez'],
    past: 'parlé',
    participle: 'parlant',
    auxiliary: 'avoir',
    source: 'https://www.larousse.com/conjugaison/francais/parler/6578',
  },
  apprendre: {
    present: ['apprends', 'apprends', 'apprend', 'apprenons', 'apprenez', 'apprennent'],
    imperfect: ['apprenais', 'apprenais', 'apprenait', 'apprenions', 'appreniez', 'apprenaient'],
    future: ['apprendrai', 'apprendras', 'apprendra', 'apprendrons', 'apprendrez', 'apprendront'],
    conditional: [
      'apprendrais',
      'apprendrais',
      'apprendrait',
      'apprendrions',
      'apprendriez',
      'apprendraient',
    ],
    imperative: ['apprends', 'apprenons', 'apprenez'],
    past: 'appris',
    participle: 'apprenant',
    auxiliary: 'avoir',
    source: 'https://www.larousse.fr/conjugaison/francais/apprendre/506',
  },
  manger: {
    present: ['mange', 'manges', 'mange', 'mangeons', 'mangez', 'mangent'],
    imperfect: ['mangeais', 'mangeais', 'mangeait', 'mangions', 'mangiez', 'mangeaient'],
    future: ['mangerai', 'mangeras', 'mangera', 'mangerons', 'mangerez', 'mangeront'],
    conditional: ['mangerais', 'mangerais', 'mangerait', 'mangerions', 'mangeriez', 'mangeraient'],
    imperative: ['mange', 'mangeons', 'mangez'],
    past: 'mangé',
    participle: 'mangeant',
    auxiliary: 'avoir',
    source: 'https://www.larousse-edu.fr/conjugaison/francais/manger/10659',
  },
  appeler: {
    present: ['appelle', 'appelles', 'appelle', 'appelons', 'appelez', 'appellent'],
    imperfect: ['appelais', 'appelais', 'appelait', 'appelions', 'appeliez', 'appelaient'],
    future: ['appellerai', 'appelleras', 'appellera', 'appellerons', 'appellerez', 'appelleront'],
    conditional: [
      'appellerais',
      'appellerais',
      'appellerait',
      'appellerions',
      'appelleriez',
      'appelleraient',
    ],
    imperative: ['appelle', 'appelons', 'appelez'],
    past: 'appelé',
    participle: 'appelant',
    auxiliary: 'avoir',
    source: 'https://www.larousse.fr/conjugaison/francais/appeler/482',
  },
  attendre: {
    present: ['attends', 'attends', 'attend', 'attendons', 'attendez', 'attendent'],
    imperfect: ['attendais', 'attendais', 'attendait', 'attendions', 'attendiez', 'attendaient'],
    future: ['attendrai', 'attendras', 'attendra', 'attendrons', 'attendrez', 'attendront'],
    conditional: [
      'attendrais',
      'attendrais',
      'attendrait',
      'attendrions',
      'attendriez',
      'attendraient',
    ],
    imperative: ['attends', 'attendons', 'attendez'],
    past: 'attendu',
    participle: 'attendant',
    auxiliary: 'avoir',
    source: 'https://www.larousse.fr/fr/conjugaison/francais/attendre/11000',
  },
};
function withSubject(form: string, index: number, pronominal: boolean) {
  const pronouns = ['me', 'te', 'se', 'nous', 'vous', 'se'];
  const vowel = /^[aeiouyàâéèêëîïôùûüœ]/i.test(form);
  let phrase = form;
  if (pronominal)
    phrase =
      (vowel && index !== 3 && index !== 4 ? pronouns[index][0] + '’' : pronouns[index] + ' ') +
      form;
  return index === 0 && /^[aeiouyàâéèêëîïôùûüœ]/i.test(phrase)
    ? 'j’' + phrase
    : subjects[index] + ' ' + phrase;
}
export function starterVerb(word: string, groupId: string): VerbProfile | undefined {
  const pronominal = /^(se |s['’])/.test(word),
    base = word.replace(/^(se |s['’])/, '');
  const p =
    base === 'réapprendre'
      ? {
          ...paradigms.apprendre,
          present: paradigms.apprendre.present.map((f) => 'ré' + f),
          imperfect: paradigms.apprendre.imperfect.map((f) => 'ré' + f),
          future: paradigms.apprendre.future.map((f) => 'ré' + f),
          conditional: paradigms.apprendre.conditional.map((f) => 'ré' + f),
          imperative: paradigms.apprendre.imperative.map((f) => 'ré' + f),
          past: 'réappris',
          participle: 'réapprenant',
          source: 'https://www.larousse.com/conjugaison/francais/r%C3%A9apprendre/9904',
        }
      : paradigms[base];
  if (!p) return undefined;
  if (pronominal && !['appeler', 'attendre'].includes(base)) return undefined;
  const conjugationSource = pronominal
    ? `https://www.larousse.fr/conjugaison/francais/s%27${base}/${base === 'appeler' ? '485' : '659'}`
    : p.source;
  const auxiliary = pronominal ? 'être' : p.auxiliary;
  const tables = conjugationSlots.map(([m, t]) => blankTable(groupId, m, t));
  const fill = (
    mood: Mood,
    tense: string,
    forms: string[],
    rowPersons: Person[] = persons,
    notes = bilingual(),
  ) => {
    const t = tables.find((t) => t.mood === mood && t.tense === tense)!;
    Object.assign(t, {
      status: 'provided',
      rows: forms.map((form, i) => ({ person: rowPersons[i], forms: [form] })),
      source: conjugationSource,
      notes,
    });
  };
  for (const [tense, key] of [
    ['present', 'present'],
    ['imperfect', 'imperfect'],
    ['future-simple', 'future'],
  ] as const)
    fill(
      'indicative',
      tense,
      p[key].map((f, i) => withSubject(f, i, pronominal)),
    );
  fill(
    'conditional',
    'present',
    p.conditional.map((f, i) => withSubject(f, i, pronominal)),
  );
  const agreement =
    auxiliary === 'être'
      ? bilingual(
          '括号形式包含性数配合；代词式动词仍需按具体句式检查配合，不能一概套用。',
          'Parentheses show gender/number agreement. Pronominal agreement must be checked against the construction; it is not universally automatic.',
        )
      : bilingual(
          'avoir 的过去分词不默认随主语配合；前置直接宾语等情况另行检查。',
          'With avoir, the participle does not normally agree with the subject; a preceding direct object can affect agreement.',
        );
  fill(
    'indicative',
    'past-composed',
    paradigms[auxiliary].present.map((f, i) =>
      withSubject(
        `${f} ${p.past}${auxiliary === 'être' ? (i >= 3 ? '(e)s' : '(e)') : ''}`,
        i,
        pronominal,
      ),
    ),
    persons,
    agreement,
  );
  fill(
    'imperative',
    'present',
    p.imperative.map((f, i) => (pronominal ? `${f}-${['toi', 'nous', 'vous'][i]}` : f)),
    ['2s', '1p', '2p'],
  );
  fill('infinitive', 'present', [word], ['none']);
  fill(
    'participle',
    'present',
    [
      pronominal
        ? (/^[aeiouyéèêàâôîïùûœh]/i.test(p.participle) ? 's’' : 'se ') + p.participle
        : p.participle,
    ],
    ['none'],
  );
  fill('participle', 'past', [p.past], ['none'], agreement);
  return {
    auxiliary,
    pastParticiple: p.past,
    presentParticiple: p.participle,
    pronominalUse: pronominal ? 'lexicalized' : '',
    pronounRequired: pronominal,
    meaningDifference: bilingual(),
    agreementNote: agreement,
    conjugations: tables,
  };
}

export function personLabel(person: Person): string {
  return person === 'none' ? '—' : subjects[persons.indexOf(person)];
}
export function displayConjugation(form: string, person: Person, mood: Mood, word = ''): string {
  if (
    person === 'none' ||
    mood === 'imperative' ||
    /^(?:je\b|j['’]|tu\b|il\b|elle\b|on\b|nous\b|vous\b|ils\b|elles\b|que\b|qu['’])/i.test(form)
  )
    return form;
  const label = personLabel(person),
    elide =
      person === '1s' &&
      (/^[aeiouyàâéèêëîïôùûüœ]/i.test(form) || (word === 'habiter' && /^h/i.test(form)));
  const phrase = elide ? 'j’' + form : label + ' ' + form;
  return mood === 'subjunctive'
    ? (person === '3s' || person === '3p' ? 'qu’' : 'que ') + phrase
    : phrase;
}

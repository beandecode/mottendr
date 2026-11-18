import type { AppState, Entry, Sense, WordForm } from './types';
import { ensureTasks } from './learning';
import { legacyEntries } from './legacy-samples';
import { bilingual, blankEntry, newExample, newGroup, newSense, upgradeEntry } from './lexicon';
import { starterVerb } from './conjugations';
function sense(
  id: string,
  zh: string,
  en: string,
  text: string,
  tzh: string,
  ten: string,
  dzh = '',
  den = '',
  distance: Sense['distance'] = 'unspecified',
): Sense {
  const s = newSense();
  s.id = id;
  s.definitions = {
    zh: { short: zh, detail: dzh, usage: '' },
    en: { short: en, detail: den, usage: '' },
  };
  s.distance = distance;
  const x = newExample();
  x.id = `${id}:example:1`;
  x.text = text;
  x.translations = bilingual(tzh, ten);
  s.examples = [x];
  return s;
}
const form = (
  id: string,
  value: string,
  kind: WordForm['kind'],
  gender: WordForm['gender'],
  number: WordForm['number'],
): WordForm => ({ id, form: value, kind, gender, number, notes: bilingual() });
const source = (e: Entry, url: string) => {
  e.sources.push({ label: 'Larousse', url, locator: e.word });
};
const lexeme = (
  id: string,
  word: string,
  pos: string,
  zh: string,
  en: string,
  example: string,
  tzh: string,
  ten: string,
  at: number,
): Entry => {
  const e = blankEntry();
  e.id = id;
  e.word = word;
  e.createdAt = e.updatedAt = at;
  e.contentVersion = 2;
  e.sourceStatus = 'sample';
  e.contentStatus = 'needs-review';
  e.source = 'Authored starter content';
  e.tags = pos === 'verb' ? ['Verbs'] : ['Essentials'];
  e.groups = [newGroup(pos)];
  e.groups[0].id = `${id}:group:1`;
  e.groups[0].senses = [sense(`${id}:sense:1`, zh, en, example, tzh, ten)];
  return e;
};
export function starterEntries(at = Date.now()): Entry[] {
  const entries = legacyEntries(at).map(upgradeEntry);
  for (const e of entries) {
    e.word = e.word.replace(/^(le |la |l['’])/, '');
    e.contentVersion = 2;
    const g = e.groups[0];
    g.features = [];
    g.specialNotes = bilingual();
    if (g.pos === 'noun')
      g.forms = [
        form(
          `${e.id}:plural`,
          e.word === 'eau' ? 'eaux' : e.word === 'temps' ? e.word : e.word + 's',
          'plural',
          g.gender,
          'plural',
        ),
      ];
    if (g.pos === 'verb') {
      g.verb = starterVerb(e.word, g.id);
      if (['être', 'avoir', 'aller', 'faire', 'apprendre'].includes(e.word)) {
        g.features = ['irregular-conjugation'];
        g.specialNotes = bilingual(
          '变位不按单一规则模式，请查看各时态。',
          'Conjugation does not follow a single regular pattern. Check each tense.',
        );
      }
      if (e.word === 'manger') {
        g.features = ['spelling-change'];
        g.specialNotes = bilingual(
          '拼写变化：nous mangeons；未完成过去时 nous mangions。',
          'Spelling change: nous mangeons; imperfect nous mangions.',
        );
      }
      if (g.verb) source(e, g.verb.conjugations.find((t) => t.status === 'provided')!.source);
    }
  }
  const by = (word: string) => entries.find((e) => e.word === word)!;
  const livre = by('livre'),
    lg = livre.groups[0];
  lg.features = ['gender-meaning'];
  lg.specialNotes = bilingual(
    'le livre 是书；la livre 是重量或货币单位，性别变化伴随词义变化。',
    'Le livre is a book; la livre is a unit of weight or currency. Gender changes the meaning.',
  );
  lg.senses[0].definitions.zh.detail = '阳性名词，指书籍。';
  lg.senses[0].definitions.en.detail = 'A masculine noun referring to a book.';
  const pound = sense(
    `${livre.id}:sense:2`,
    '磅（重量或货币单位）',
    'pound (weight or currency)',
    'Ce paquet pèse une livre.',
    '这个包裹重一磅。',
    'This parcel weighs one pound.',
    '',
    '',
    'distinct',
  );
  pound.gender = 'f';
  lg.senses.push(pound);
  source(livre, 'https://www.larousse.fr/dictionnaires/francais-anglais/livre/47459');
  const cafe = by('café');
  cafe.groups[0].senses[0].definitions.zh.short = '咖啡';
  cafe.groups[0].senses[0].definitions.en.short = 'coffee';
  const place = sense(
    `${cafe.id}:sense:2`,
    '咖啡馆',
    'café; coffee shop',
    'Nous sommes dans un café.',
    '我们在一家咖啡馆里。',
    'We are in a café.',
    '',
    '',
    'derived',
  );
  place.derivedFromSenseId = cafe.groups[0].senses[0].id;
  cafe.groups[0].senses.push(place);
  const temps = by('temps');
  temps.groups[0].senses[0].definitions.zh.short = '时间';
  temps.groups[0].senses[0].definitions.en.short = 'time';
  temps.groups[0].senses.push(
    sense(
      `${temps.id}:sense:2`,
      '天气',
      'weather',
      'Quel temps fait-il ?',
      '天气怎么样？',
      'What is the weather like?',
      '',
      '',
      'distinct',
    ),
  );
  const learn = by('apprendre'),
    learnGroup = learn.groups[0];
  learnGroup.senses[0].definitions.zh.short = '学习；学会';
  learnGroup.senses[0].definitions.en.short = 'to learn';
  learnGroup.senses.push(
    sense(
      `${learn.id}:sense:2`,
      '教；使学会',
      'to teach',
      'Elle apprend le français aux enfants.',
      '她教孩子们法语。',
      'She teaches French to the children.',
      'apprendre quelque chose à quelqu’un：教某人某事。',
      'Apprendre quelque chose à quelqu’un: teach something to someone.',
      'distinct',
    ),
  );
  learnGroup.senses.push(
    sense(
      `${learn.id}:sense:3`,
      '得知',
      'to find out',
      'J’apprends une bonne nouvelle.',
      '我得知一个好消息。',
      'I find out some good news.',
      '',
      '',
      'derived',
    ),
  );
  learnGroup.senses[2].derivedFromSenseId = learnGroup.senses[0].id;
  source(learn, 'https://www.larousse.fr/dictionnaires/francais/apprendre/4746');
  const ensemble = by('ensemble');
  ensemble.groups[0].senses[0].definitions.zh.detail = '副词，表示一起。';
  ensemble.groups[0].senses[0].definitions.en.detail = 'An adverb meaning together.';
  const ng = newGroup('noun');
  ng.id = `${ensemble.id}:group:2`;
  ng.gender = 'm';
  ng.senses = [
    sense(
      `${ensemble.id}:sense:2`,
      '整体；集合',
      'whole; set',
      'Ces éléments forment un ensemble.',
      '这些元素组成一个整体。',
      'These elements form a whole.',
      '',
      '',
      'distinct',
    ),
  ];
  ng.forms = [form(`${ensemble.id}:plural`, 'ensembles', 'plural', 'm', 'plural')];
  ensemble.groups.push(ng);
  source(ensemble, 'https://www.larousse.fr/dictionnaires/college/ensemble/14509');
  for (const [word, forms] of Object.entries({
    petit: [
      ['petite', 'f', 'singular'],
      ['petits', 'm', 'plural'],
      ['petites', 'f', 'plural'],
    ],
    beau: [
      ['belle', 'f', 'singular'],
      ['bel', 'm', 'singular'],
      ['beaux', 'm', 'plural'],
      ['belles', 'f', 'plural'],
    ],
    heureux: [
      ['heureuse', 'f', 'singular'],
      ['heureux', 'm', 'plural'],
      ['heureuses', 'f', 'plural'],
    ],
  })) {
    const e = by(word),
      g = e.groups[0];
    g.forms = forms.map(([value, gender, number], i) =>
      form(
        `${e.id}:form:${i}`,
        value,
        number === 'plural' ? 'plural' : gender === 'f' ? 'feminine' : 'variant',
        gender as 'm' | 'f',
        number as 'singular' | 'plural',
      ),
    );
    if (word !== 'petit') {
      g.features = ['irregular-form'];
      g.specialNotes = bilingual(
        word === 'beau'
          ? '元音或哑音 h 前用 bel；阴性 belle。'
          : '阴性 heureuse；阳性复数仍为 heureux。',
        word === 'beau'
          ? 'Use bel before a vowel or silent h; feminine belle.'
          : 'Feminine heureuse; masculine plural remains heureux.',
      );
    }
  }
  const extras = [
    lexeme(
      'sample-appeler',
      'appeler',
      'verb',
      '呼叫；打电话',
      'to call',
      'J’appelle mon ami.',
      '我给朋友打电话。',
      'I call my friend.',
      at,
    ),
    lexeme(
      'sample-sappeler',
      's’appeler',
      'verb',
      '叫作；名字是',
      'to be called; to be named',
      'Je m’appelle Camille.',
      '我叫 Camille。',
      'My name is Camille.',
      at,
    ),
    lexeme(
      'sample-attendre',
      'attendre',
      'verb',
      '等待',
      'to wait',
      'J’attends le train.',
      '我在等火车。',
      'I am waiting for the train.',
      at,
    ),
    lexeme(
      'sample-sattendre',
      's’attendre',
      'verb',
      '预料；预计',
      'to expect',
      'Je m’attends à une réponse.',
      '我预期会得到答复。',
      'I expect a reply.',
      at,
    ),
  ];
  for (const e of extras) {
    const g = e.groups[0];
    g.verb = starterVerb(e.word, g.id);
    if (e.word.includes('appeler')) {
      g.features = ['spelling-change'];
      g.specialNotes = bilingual(
        'appelle / appelons；将来时 appellerai。',
        'Appelle / appelons; future appellerai.',
      );
    }
    if (g.verb) source(e, g.verb.conjugations[0].source);
  }
  for (const [name, base, zh, en, url] of [
    [
      's’appeler',
      'appeler',
      'appeler 表示呼叫或打电话；s’appeler 表示名字是。',
      'Appeler means call; s’appeler expresses a name.',
      'https://www.larousse.fr/dictionnaires/francais/appeler/4669',
    ],
    [
      's’attendre',
      'attendre',
      'attendre 表示等待；s’attendre à 表示预料，需要保留 à 的搭配。',
      'Attendre means wait; s’attendre à means expect and requires the à construction.',
      'https://www.larousse.fr/dictionnaires/francais/attendre/6227',
    ],
  ]) {
    const e = extras.find((e) => e.word === name)!,
      b = extras.find((e) => e.word === base)!;
    e.kind = 'pronominal';
    e.relations = [
      {
        id: `${e.id}:base`,
        type: 'pronominal-of',
        targetId: b.id,
        notes: bilingual(zh, en),
        status: 'reviewed',
        source: url,
      },
    ];
    e.groups[0].verb!.meaningDifference = bilingual(zh, en);
    e.groups[0].senses[0].definitions.zh.usage = zh;
    e.groups[0].senses[0].definitions.en.usage = en;
    source(e, url);
  }
  const expect = extras.find((e) => e.word === 's’attendre')!;
  expect.groups[0].senses[0].collocations = [
    {
      id: `${expect.id}:collocation`,
      text: 's’attendre à + nom / infinitif',
      translations: bilingual(
        '预料某事／预料会做某事',
        'expect something / expect to do something',
      ),
    },
  ];
  const noun = lexeme(
    'sample-apprentissage',
    'apprentissage',
    'noun',
    '学习过程；学徒训练',
    'learning process; apprenticeship',
    'L’apprentissage demande de la pratique.',
    '学习需要练习。',
    'Learning takes practice.',
    at,
  );
  noun.groups[0].gender = 'm';
  noun.groups[0].forms = [form(`${noun.id}:plural`, 'apprentissages', 'plural', 'm', 'plural')];
  const again = lexeme(
    'sample-reapprendre',
    'réapprendre',
    'verb',
    '重新学习',
    'to learn again',
    'Je dois réapprendre cette règle.',
    '我需要重新学习这条规则。',
    'I need to learn this rule again.',
    at,
  );
  again.groups[0].verb = starterVerb('réapprendre', again.groups[0].id);
  if (again.groups[0].verb) again.groups[0].verb.paradigmRef = 'apprendre';
  again.groups[0].features = ['irregular-conjugation'];
  const family = {
    key: 'family-apprendre',
    label: 'apprendre',
    root: 'appren- / appris- / apprent-',
    notes: bilingual(
      '学习相关词族；词形相似不能替代词义和来源核对。',
      'A learning-related word family. Similar spelling alone does not establish a relationship.',
    ),
    status: 'needs-review' as const,
  };
  for (const e of [learn, noun, again]) e.families = [structuredClone(family)];
  again.relations = [
    {
      id: `${again.id}:base`,
      type: 'derived-from',
      targetId: learn.id,
      notes: bilingual('ré- 表示再次。', 'Ré- indicates repetition.'),
      status: 'reviewed',
      source: 'https://www.larousse.com/conjugaison/francais/r%C3%A9apprendre/9904',
    },
  ];
  return [...entries, ...extras, noun, again];
}
export function initialState(at = Date.now()): AppState {
  const state: AppState = {
    schemaVersion: 2,
    revision: 0,
    entries: starterEntries(at),
    tasks: [],
    events: [],
    session: null,
    importBatches: [],
    prefs: {
      mode: 'zhEnAssist',
      newLimit: 20,
      sessionLimit: 50,
      retention: 0.9,
      speechEngine: 'mac',
      voice: 'Thomas',
      speechRate: 0.85,
      direction: 'recognition',
      swipeMap: [1, 3, 4, 2],
      fontScale: 1,
      typographyVersion: 3,
      continuousLearning: false,
      activeTaskLimit: 6,
      refillLimit: 1,
    },
  };
  ensureTasks(state, 'recognition', at);
  return state;
}
export function enrichUneditedSamples(state: AppState, legacy: ReturnType<typeof legacyEntries>) {
  const samples = starterEntries();
  const originals = legacyEntries();
  for (const old of legacy) {
    const baseline = originals.find((e) => e.id === old.id),
      replacement = samples.find((e) => e.id === old.id);
    if (!baseline || !replacement || old.contentVersion !== 1 || old.sourceStatus !== 'sample')
      continue;
    const same = [
      'word',
      'ipa',
      'pos',
      'gender',
      'zh',
      'en',
      'example',
      'tags',
      'source',
      'irregular',
    ].every(
      (key) =>
        JSON.stringify(old[key as keyof typeof old]) ===
        JSON.stringify(baseline[key as keyof typeof baseline]),
    );
    if (!same) continue;
    const current = state.entries.find((e) => e.id === old.id)!;
    Object.assign(current, {
      word: replacement.word,
      groups: replacement.groups,
      sources: replacement.sources,
      families: replacement.families,
      contentVersion: 2,
    });
  }
  if (legacy.some((e) => e.id === 'sample-1' && e.sourceStatus === 'sample')) {
    const extra = samples.filter((e) => !/^sample-\d+$/.test(e.id)),
      mapping = new Map<string, string>();
    for (const e of extra) {
      const existing = state.entries.find(
        (old) => old.id === e.id || (old.word === e.word && old.kind === e.kind),
      );
      mapping.set(e.id, existing?.id ?? e.id);
    }
    for (const e of extra)
      if (!state.entries.some((old) => old.id === mapping.get(e.id))) {
        e.relations = e.relations.map((r) => ({
          ...r,
          targetId: mapping.get(r.targetId) ?? r.targetId,
        }));
        state.entries.push(e);
      }
  }
  ensureTasks(state, 'recognition');
}

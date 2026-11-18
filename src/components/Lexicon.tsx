import { normalizeHeadword, frenchDisplay } from '../domain/headword';
import { lookupDictionary, displayDictionaryEntry } from '../domain/dictionary';
import { useEffect, useState, type ReactNode } from 'react';
import { ChevronRight, CircleHelp, Plus, Sparkles, Volume2, X } from 'lucide-react';
import type {
  AppState,
  Entry,
  LanguageMode,
  Locale,
  PosGroup,
  Sense,
  VerbProfile,
  Mood,
  RelationType,
  Bilingual,
} from '../domain/types';
import { localeFor } from '../domain/types';
import {
  bilingual,
  newExample,
  newGroup,
  newId,
  newSense,
  newVerb,
  hasExplanation,
  relatedEntries,
} from '../domain/lexicon';
import { validateEntry } from '../domain/validation';
import {
  blankTable,
  conjugationSlots,
  moodNames,
  persons,
  tenseNames,
  personLabel,
  displayConjugation,
} from '../domain/conjugations';
import { posLabel, translator, type Label } from '../i18n';
import { verbGroupText } from '../domain/verb-group';
const text = (mode: LanguageMode, zh: string, en: string) => (mode === 'enOnly' ? en : zh);
const genderText = (gender: string, mode: LanguageMode) =>
  ({
    m: ['阳性', 'Masculine'],
    f: ['阴性', 'Feminine'],
    common: ['通性', 'Common gender'],
    variable: ['随义项变化', 'Varies by sense'],
    unknown: ['待核对', 'Unknown'],
    '': ['不适用', 'Not applicable'],
  })[gender]?.[mode === 'enOnly' ? 1 : 0] ?? gender;
const statusText = (status: string, mode: LanguageMode) =>
  ({
    draft: ['草稿', 'Draft'],
    'needs-review': ['待核对', 'Needs review'],
    reviewed: ['已核对', 'Reviewed'],
  })[status]?.[mode === 'enOnly' ? 1 : 0] ?? status;
const relationText = (type: string, mode: LanguageMode, inverse = false) =>
  ({
    'pronominal-of': inverse
      ? ['对应代词式动词', 'Pronominal counterpart']
      : ['原动词', 'Base verb'],
    'derived-from': inverse ? ['派生词', 'Derived word'] : ['派生自', 'Derived from'],
    'same-family': ['同词族', 'Same word family'],
    synonym: ['近义', 'Synonym'],
    antonym: ['反义', 'Antonym'],
    related: ['相关', 'Related'],
  })[type]?.[mode === 'enOnly' ? 1 : 0] ?? type;
const distanceText = (distance: string, mode: LanguageMode) =>
  ({
    unspecified: ['尚未判断差异', 'Difference not assessed'],
    close: ['相近义项', 'Close meaning'],
    distinct: ['差异较大', 'Distinct meaning'],
    derived: ['衍生义项', 'Derived meaning'],
  })[distance]?.[mode === 'enOnly' ? 1 : 0] ?? distance;
const featureText = (feature: string, mode: LanguageMode) =>
  ({
    'irregular-conjugation': ['不规则变位', 'Irregular conjugation'],
    'spelling-change': ['拼写变化', 'Spelling change'],
    'irregular-form': ['特殊词形', 'Special form'],
    'gender-meaning': ['性别改变词义', 'Gender changes meaning'],
    'special-use': ['特别用法', 'Special usage'],
    defective: ['缺位变位', 'Defective conjugation'],
  })[feature]?.[mode === 'enOnly' ? 1 : 0] ?? feature;
const genders = ['', 'm', 'f', 'common', 'variable', 'unknown'] as const;
export function EntryBadges({
  entry,
  mode,
  showGender = true,
  groupId,
  senseGender,
}: {
  entry: Entry;
  mode: LanguageMode;
  showGender?: boolean;
  groupId?: string;
  // The gender of the sense shown, when it differs by sense (une tour, un tour).
  senseGender?: string;
}) {
  return (
    <>
      {entry.groups
        .filter((g) => !groupId || g.id === groupId)
        .map((g) => {
          const gender = senseGender || g.gender;
          return (
            <span key={g.id}>
              {posLabel(g.pos, mode)}
              {showGender && gender ? ` · ${genderText(gender, mode)}` : ''}
            </span>
          );
        })}
      {entry.groups
        .filter((g) => (!groupId || g.id === groupId) && g.verb?.group)
        .map((g) => (
          <span className="badge" key={`${g.id}:group`}>
            {verbGroupText(g.verb, mode)}
          </span>
        ))}
      {entry.kind === 'pronominal' && (
        <span className="badge amber">{text(mode, '代词式动词', 'Pronominal verb')}</span>
      )}
      {[
        ...new Set(
          entry.groups.filter((g) => !groupId || g.id === groupId).flatMap((g) => g.features),
        ),
      ].map((f) => (
        <span className="badge amber" key={f}>
          {featureText(f, mode)}
        </span>
      ))}
    </>
  );
}
// An entry as the learner reads it (details sheet, dictionary sheet): the headword first, then
// `afterHero` (learning status, or the dictionary's add button), the numbered senses, forms and
// conjugation. Empty fields are left out; notes about how content is kept sit in "资料信息".
export function LexiconDetails({
  entry,
  state,
  speak,
  openLinked,
  afterHero,
}: {
  entry: Entry;
  state: AppState;
  speak: (s: string) => void;
  openLinked: (id: string) => void;
  afterHero?: ReactNode;
}) {
  const mode = state.prefs.mode,
    locale = localeFor(mode),
    t = translator(mode),
    linked = relatedEntries(entry, state.entries).filter(
      (r) => r.type !== 'same-family' && r.type !== 'derived-from',
    );
  const senseCount = entry.groups.reduce((n, g) => n + g.senses.length, 0),
    firstNumber = entry.groups.map((_, i) =>
      entry.groups.slice(0, i).reduce((n, g) => n + g.senses.length, 0),
    );
  const groupTags = (group: PosGroup) => [
    posLabel(group.pos, mode) + (group.gender ? ` · ${genderText(group.gender, mode)}` : ''),
    ...(group.verb?.group ? [verbGroupText(group.verb, mode)] : []),
  ];
  return (
    <div className="lexicon-details">
      <header className="entry-hero">
        <p className="entry-word" lang="fr">
          {frenchDisplay(entry, state.prefs)}
        </p>
        <div className="detail-pronunciation">
          {entry.ipa && <span>/{entry.ipa}/</span>}
          <button
            className="icon-button"
            aria-label={t('listen')}
            onClick={() => speak(frenchDisplay(entry, state.prefs))}
          >
            <Volume2 size={20} />
          </button>
        </div>
        <div className="detail-tags">
          {entry.groups.flatMap(groupTags).map((tag, i) => (
            <span className="badge" key={i}>
              {tag}
            </span>
          ))}
          {entry.kind === 'pronominal' && (
            <span className="badge amber">{text(mode, '代词式动词', 'Pronominal verb')}</span>
          )}
          {[...new Set(entry.groups.flatMap((g) => g.features))].map((f) => (
            <span key={f} className="badge amber">
              {featureText(f, mode)}
            </span>
          ))}
          {entry.favorite && <span className="badge">{t('favorites')}</span>}
        </div>
      </header>
      {afterHero}
      {senseCount > 0 && (
        <p className="senses-label">
          {text(
            mode,
            `${senseCount} 个义项`,
            senseCount === 1 ? '1 sense' : `${senseCount} senses`,
          )}
        </p>
      )}
      {entry.groups.map((group, gi) => (
        <section className="lexical-group" key={group.id}>
          {entry.groups.length > 1 && <p className="group-head">{groupTags(group).join(' · ')}</p>}
          {group.specialNotes[locale] && (
            <div className="irregular-note">
              <CircleHelp size={17} />
              <p>{group.specialNotes[locale]}</p>
            </div>
          )}
          {group.senses.map((sense, i) => {
            const def = sense.definitions[locale],
              examples = sense.examples.filter((ex) => ex.text.trim());
            return (
              <article className="sense-detail" key={sense.id}>
                <span className="sense-number">{firstNumber[gi] + i + 1}</span>
                <div className="sense-body">
                  <h3 className="definition">
                    {def.short ||
                      (sense.definitions.en.short ? (
                        <>
                          <abbr className="meaning-fallback" title="English">
                            EN
                          </abbr>
                          {sense.definitions.en.short}
                        </>
                      ) : (
                        t('missing')
                      ))}
                  </h3>
                  {sense.gender !== undefined && (
                    <p className="sense-gender">{genderText(sense.gender, mode)}</p>
                  )}
                  {def.detail && <p className="detail-text">{def.detail}</p>}
                  {def.usage && <p className="usage-note">{def.usage}</p>}
                  {sense.derivedFromSenseId && (
                    <p className="muted">
                      {text(mode, '衍生自', 'Derived from')}:{' '}
                      {entry.groups
                        .flatMap((g) => g.senses)
                        .find((s) => s.id === sense.derivedFromSenseId)?.definitions[locale]
                        .short || '—'}
                    </p>
                  )}
                  {examples.map((ex) => (
                    <section className="example-box" key={ex.id}>
                      <p lang="fr">{ex.text}</p>
                      {ex.translations[locale] && <small>{ex.translations[locale]}</small>}
                      {ex.note[locale] && <small>{ex.note[locale]}</small>}
                      <button
                        className="icon-button"
                        aria-label={`${t('listen')}: ${ex.text}`}
                        onClick={() => speak(ex.text)}
                      >
                        <Volume2 size={18} />
                      </button>
                    </section>
                  ))}
                  {sense.collocations.length > 0 && (
                    <div className="collocation-list">
                      <h4>{text(mode, '搭配与句式', 'Collocations and constructions')}</h4>
                      {sense.collocations.map((c) => (
                        <p key={c.id}>
                          <strong lang="fr">{c.text}</strong>
                          <span>{c.translations[locale]}</span>
                        </p>
                      ))}
                    </div>
                  )}
                  {mode === 'zhEnAssist' && sense.definitions.en.short && (
                    <section className="bridge-box">
                      <span className="eyebrow">{t('englishBridge')}</span>
                      <strong>{sense.definitions.en.short}</strong>
                      {sense.definitions.en.detail && <p>{sense.definitions.en.detail}</p>}
                      {sense.definitions.en.usage && <p>{sense.definitions.en.usage}</p>}
                      {sense.examples
                        .filter((x) => x.translations.en)
                        .map((x) => (
                          <p key={x.id}>{x.translations.en}</p>
                        ))}
                    </section>
                  )}
                </div>
              </article>
            );
          })}
          {group.forms.length > 0 && (
            <section className="detail-block word-forms">
              <h4>{text(mode, '词形', 'Word forms')}</h4>
              {group.forms.map((f) => (
                <span className="badge" key={f.id}>
                  {f.form} · {genderText(f.gender, mode)}
                  {f.number &&
                    ` · ${text(mode, f.number === 'plural' ? '复数' : '单数', f.number)}`}
                  {f.notes[locale] && ` · ${f.notes[locale]}`}
                </span>
              ))}
            </section>
          )}
          {group.verb && <VerbDetails verb={group.verb} mode={mode} word={entry.word} />}
        </section>
      ))}
      {linked.length > 0 && (
        <section className="detail-block linked-entries">
          <h4>{text(mode, '关联词条', 'Linked entries')}</h4>
          {linked.map((r, i) => (
            <button
              className="linked-entry"
              key={`${r.entry!.id}:${r.type}:${i}`}
              onClick={() => openLinked(r.entry!.id)}
            >
              <span>
                <strong lang="fr">{r.entry!.word}</strong>
                <small>
                  {relationText(r.type, mode, r.inverse)}
                  {r.entry!.archived && ` · ${t('archived')}`}
                </small>
                {r.notes[locale] && <small>{r.notes[locale]}</small>}
              </span>
              <ChevronRight size={17} />
            </button>
          ))}
        </section>
      )}
    </div>
  );
}
// How an entry's content is kept: shared progress, review status and sources. Collapsed.
export function ContentInfo({ entry, state }: { entry: Entry; state: AppState }) {
  const mode = state.prefs.mode,
    t = translator(mode);
  return (
    <details className="detail-disclosure content-sources">
      <summary>{t('contentInfo')}</summary>
      <p>
        {text(
          mode,
          '本词条所有义项共用学习进度；关联的代词式动词独立学习。',
          'All senses share this entry’s progress. Linked pronominal verbs are learned separately.',
        )}
      </p>
      <p>{statusText(entry.contentStatus, mode)}</p>
      {entry.sources.map((s, i) =>
        s.url ? (
          <a key={i} href={s.url} target="_blank" rel="noreferrer">
            {s.label} · {s.locator}
          </a>
        ) : (
          <span key={i}>
            {s.label} · {s.locator}
          </span>
        ),
      )}
    </details>
  );
}
// The subject at the start of a conjugated form ("que je ", "j’", "il/elle/on "), shown in grey.
const SUBJECT =
  /^((?:que\s+|qu['’])?(?:je\s+|j['’]|tu\s+|(?:il|elle|on)(?:\/(?:il|elle|on))*\s+|nous\s+|vous\s+|(?:ils|elles)(?:\/(?:ils|elles))*\s+))(.+)$/i;
// One person per line, the subject in grey; the tenses that have a table are chips above it.
function VerbDetails({
  verb,
  mode,
  word,
}: {
  verb: VerbProfile;
  mode: LanguageMode;
  word: string;
}) {
  const locale = localeFor(mode),
    en = mode === 'enOnly' ? 1 : 0;
  const tables = verb.conjugations.filter((t) => t.status === 'provided' && t.rows.length);
  const order = (t: { mood: Mood; tense: string }) => {
    const i = conjugationSlots.findIndex(([m, k]) => m === t.mood && k === t.tense);
    return i < 0 ? conjugationSlots.length : i;
  };
  tables.sort((a, b) => order(a) - order(b));
  const [selected, setSelected] = useState(
    tables.find((t) => t.mood === 'indicative' && t.tense === 'present')?.id ?? tables[0]?.id,
  );
  const table = tables.find((t) => t.id === selected);
  const tenseLabel = (t: { mood: Mood; tense: string }) =>
    (t.mood === 'indicative' ? '' : moodNames[t.mood][en] + (en ? ' · ' : '')) +
    (tenseNames[t.tense]?.[en] ?? t.tense);
  const lines =
    table?.rows.map((r) => {
      const phrase = r.forms
          .map((f) => displayConjugation(f, r.person, table.mood, word))
          .join(' / ')
          .replace(/\s*\/\s*(?=(?:il|elle|on|ils|elles)\b)/g, '/'),
        [, prefix = '', forms = phrase] = SUBJECT.exec(phrase) ?? [];
      return { person: r.person, prefix, forms, phrase };
    }) ?? [];
  const twoColumns = lines.length > 1 && lines.every((l) => l.phrase.length <= 20);
  const facts = [
    verb.group ? `${text(mode, '组别', 'Group')} ${verbGroupText(verb, mode)}` : '',
    `${text(mode, '助动词', 'Auxiliary')} ${verb.auxiliary === 'variable' ? 'avoir / être' : verb.auxiliary || '—'}`,
    verb.pastParticiple
      ? `${text(mode, '过去分词', 'Past participle')} ${verb.pastParticiple}`
      : '',
    verb.presentParticiple
      ? `${text(mode, '现在分词', 'Present participle')} ${verb.presentParticiple}`
      : '',
  ].filter(Boolean);
  return (
    <section className="detail-block verb-details">
      <h4>
        {text(mode, '变位', 'Conjugation')}
        {table && <small>{moodNames[table.mood][en]}</small>}
      </h4>
      {verb.meaningDifference[locale] && (
        <div className="irregular-note">
          <CircleHelp size={17} />
          <p>{verb.meaningDifference[locale]}</p>
        </div>
      )}
      {verb.pronounRequired && (
        <p className="muted">
          {text(
            mode,
            '本词条需要代词，注意代词随人称变化。',
            'This entry requires a pronoun, which changes with the person.',
          )}
        </p>
      )}
      {tables.length > 0 ? (
        <>
          <div className="tense-chips" role="tablist" aria-label={text(mode, '时态', 'Tense')}>
            {tables.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={t.id === selected}
                className={t.id === selected ? 'active' : ''}
                onClick={() => setSelected(t.id)}
              >
                {tenseLabel(t)}
              </button>
            ))}
          </div>
          <div
            className={`conjugation-lines ${twoColumns ? 'two' : ''}`}
            lang="fr"
            style={
              twoColumns
                ? { gridTemplateRows: `repeat(${Math.ceil(lines.length / 2)}, auto)` }
                : undefined
            }
          >
            {lines.map((l) => (
              <span key={l.person}>
                {l.prefix && <em>{l.prefix}</em>}
                <b>{l.forms}</b>
              </span>
            ))}
          </div>
          {table?.notes[locale] && !/原表|规则转换|未复核/.test(table.notes[locale]) && (
            <p className="usage-note">{table.notes[locale]}</p>
          )}
        </>
      ) : (
        <p className="missing-conjugation">
          {text(
            mode,
            '变位尚未收录，不表示这些形式不存在。',
            'The conjugation has not been added; it does not mean the forms do not exist.',
          )}
        </p>
      )}
      <p className="verb-facts">{facts.join(' · ')}</p>
      {verb.agreementNote[locale] && <p className="muted">{verb.agreementNote[locale]}</p>}
    </section>
  );
}

export function EntryEditor({
  entry,
  state,
  busy,
  notify,
  save,
  focusSenseId,
}: {
  entry: Entry;
  state: AppState;
  busy: boolean;
  notify: (n: Label) => void;
  save: (e: Entry) => Promise<boolean>;
  focusSenseId?: string;
}) {
  const mode = state.prefs.mode,
    locale = localeFor(mode),
    t = translator(mode),
    [draft, setDraft] = useState(() => structuredClone(entry)),
    [secondary, setSecondary] = useState(false);
  const update = (fn: (e: Entry) => void) =>
    setDraft((old) => {
      const e = structuredClone(old);
      fn(e);
      return e;
    });
  const locales: Locale[] = mode === 'zhEnAssist' && secondary ? ['zh', 'en'] : [locale];
  useEffect(() => {
    if (focusSenseId)
      document
        .querySelector(`[data-sense-id="${CSS.escape(focusSenseId)}"]`)
        ?.scrollIntoView({ block: 'start' });
  }, [focusSenseId]);
  const allSenses = draft.groups.flatMap((g) => g.senses),
    familyOptions = [
      ...new Map(state.entries.flatMap((e) => e.families).map((f) => [f.key, f])).values(),
    ];
  const input = (label: string, value: string, change: (v: string) => void, large = false) => (
    <label>
      {label}
      {large ? (
        <textarea
          aria-label={label}
          rows={2}
          value={value}
          onChange={(e) => change(e.target.value)}
        />
      ) : (
        <input aria-label={label} value={value} onChange={(e) => change(e.target.value)} />
      )}
    </label>
  );
  const biInputs = (label: string, value: Bilingual, change: (l: Locale, v: string) => void) =>
    locales.map((l) => (
      <div key={l}>
        {input(
          `${label}${locales.length > 1 ? (l === 'en' ? ' · English' : ' · 中文') : ''}`,
          value[l],
          (v) => change(l, v),
          true,
        )}
      </div>
    ));
  const remove = (label: string, action: () => void) => (
    <button type="button" className="text-button remove-field" onClick={action}>
      <X size={14} />
      {label}
    </button>
  );
  const add = (label: string, action: () => void) => (
    <button type="button" className="secondary-button" onClick={action}>
      <Plus size={14} />
      {label}
    </button>
  );
  const clearSenseRefs = (e: Entry, ids: string[]) =>
    e.groups.forEach((g) =>
      g.senses.forEach((s) => {
        if (s.derivedFromSenseId && ids.includes(s.derivedFromSenseId)) {
          delete s.derivedFromSenseId;
        }
      }),
    );
  async function submit() {
    const e = structuredClone(draft);
    if (e.word !== entry.word) {
      delete e.headword;
      delete e.dictionaryRefs;
      delete e.contentProvenance;
    }
    normalizeHeadword(e);
    if (e.cardDisplay?.senseIds)
      e.cardDisplay.senseIds = e.cardDisplay.senseIds.filter((id) =>
        e.groups.some((g) => g.senses.some((s) => s.id === id)),
      );
    e.tags = e.tags.map((x) => x.trim()).filter(Boolean);
    e.updatedAt = Date.now();
    try {
      validateEntry(e);
      if (!hasExplanation(e, locale)) throw new Error();
    } catch {
      notify('entryStructureError');
      return;
    }
    await save(e);
  }
  function lookup() {
    const record = lookupDictionary(draft.word);
    const found =
      (record ? displayDictionaryEntry(state, record) : null) ??
      state.entries.find(
        (e) =>
          e.word.normalize('NFC').toLocaleLowerCase('fr') ===
          draft.word.normalize('NFC').trim().toLocaleLowerCase('fr'),
      );
    if (!found) {
      notify('lookupMissing');
      return;
    }
    setDraft((old) => ({
      ...structuredClone(found),
      id: old.id,
      createdAt: old.createdAt,
      contentVersion: old.contentVersion,
      favorite: old.favorite,
      suspended: old.suspended,
      archived: old.archived,
      localizedNotes: old.localizedNotes,
      sourceStatus: 'user',
      importBatchId: old.importBatchId,
    }));
  }
  return (
    <form
      className="entry-editor"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <fieldset disabled={busy}>
        <p className="progress-unit-note">
          {text(
            mode,
            '义项共用本词条进度；代词式动词请建立独立词条，再关联原动词。',
            'Senses share entry progress. Create a separate entry for a pronominal verb, then link its base verb.',
          )}
        </p>
        <div className="form-grid two">
          {input(t('word'), draft.word, (v) =>
            update((e) => {
              e.word = v;
            }),
          )}
          {input('IPA', draft.ipa, (v) =>
            update((e) => {
              e.ipa = v;
            }),
          )}
          <label>
            {text(mode, '词条类型', 'Entry type')}
            <select
              value={draft.kind}
              onChange={(ev) =>
                update((e) => {
                  e.kind = ev.target.value as Entry['kind'];
                  if (e.kind === 'pronominal') {
                    if (!e.groups.some((g) => g.pos === 'verb')) e.groups.push(newGroup('verb'));
                    e.groups
                      .filter((g) => g.verb)
                      .forEach((g) => {
                        g.verb!.pronounRequired = true;
                        g.verb!.pronominalUse ||= 'unspecified';
                      });
                  } else {
                    e.relations = e.relations.filter((r) => r.type !== 'pronominal-of');
                  }
                })
              }
            >
              <option value="lexical">{text(mode, '普通词条', 'Lexical entry')}</option>
              <option value="pronominal">{text(mode, '代词式动词', 'Pronominal verb')}</option>
            </select>
          </label>
          <label>
            {text(mode, '内容状态', 'Content status')}
            <select
              value={draft.contentStatus}
              onChange={(ev) =>
                update((e) => {
                  e.contentStatus = ev.target.value as Entry['contentStatus'];
                })
              }
            >
              {['draft', 'needs-review', 'reviewed'].map((s) => (
                <option key={s} value={s}>
                  {statusText(s, mode)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button type="button" className="text-button" onClick={lookup}>
          <Sparkles size={14} />
          {t('lookup')}
        </button>
        {mode === 'zhEnAssist' && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={secondary}
              onChange={(e) => setSecondary(e.target.checked)}
            />
            {t('secondary')}
          </label>
        )}
        {draft.groups.map((group, gi) => (
          <section className="editor-group" key={group.id}>
            <div className="editor-section-title">
              <h3>
                {text(mode, '词性分组', 'Part of speech group')} {gi + 1}
              </h3>
              {draft.groups.length > 1 &&
                remove(text(mode, '移除词性', 'Remove group'), () =>
                  update((e) => {
                    clearSenseRefs(
                      e,
                      e.groups[gi].senses.map((s) => s.id),
                    );
                    e.groups.splice(gi, 1);
                  }),
                )}
            </div>
            <div className="form-grid two">
              <label>
                {text(mode, '词性', 'Part of speech')}
                <select
                  value={group.pos}
                  onChange={(ev) =>
                    update((e) => {
                      const g = e.groups[gi];
                      g.pos = ev.target.value;
                      if (g.pos === 'verb') g.verb ??= newVerb();
                      else delete g.verb;
                    })
                  }
                >
                  {[
                    ...new Set([
                      'noun',
                      'verb',
                      'adjective',
                      'adverb',
                      'pronoun',
                      'preposition',
                      'conjunction',
                      'interjection',
                      'determiner',
                      'phrase',
                      group.pos,
                    ]),
                  ].map((p) => (
                    <option value={p} key={p}>
                      {posLabel(p, mode)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {text(mode, '默认性别', 'Default gender')}
                <select
                  value={group.gender}
                  onChange={(ev) =>
                    update((e) => {
                      e.groups[gi].gender = ev.target.value as PosGroup['gender'];
                    })
                  }
                >
                  {genders.map((g) => (
                    <option value={g} key={g}>
                      {genderText(g, mode)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="feature-options">
              {(
                [
                  'irregular-conjugation',
                  'spelling-change',
                  'irregular-form',
                  'gender-meaning',
                  'special-use',
                ] as const
              ).map((f) => (
                <label className="checkbox-label" key={f}>
                  <input
                    type="checkbox"
                    checked={group.features.includes(f)}
                    onChange={(ev) =>
                      update((e) => {
                        const g = e.groups[gi];
                        g.features = ev.target.checked
                          ? [...g.features, f]
                          : g.features.filter((x) => x !== f);
                      })
                    }
                  />
                  {featureText(f, mode)}
                </label>
              ))}
            </div>
            {biInputs(text(mode, '特别提示', 'Special notes'), group.specialNotes, (l, v) =>
              update((e) => {
                e.groups[gi].specialNotes[l] = v;
              }),
            )}
            {group.senses.map((sense, si) => (
              <section className="editor-sense" key={sense.id} data-sense-id={sense.id}>
                <div className="editor-section-title">
                  <h4>
                    {text(mode, '义项', 'Sense')} {si + 1}
                  </h4>
                  {group.senses.length > 1 &&
                    remove(text(mode, '移除义项', 'Remove sense'), () =>
                      update((e) => {
                        clearSenseRefs(e, [sense.id]);
                        e.groups[gi].senses.splice(si, 1);
                      }),
                    )}
                </div>
                {locales.map((l) => (
                  <div key={l} className="definition-fields">
                    <small>{l === 'en' ? 'English' : text(mode, '中文', 'Chinese')}</small>
                    {input(
                      text(mode, '简短解释', 'Short definition'),
                      sense.definitions[l].short,
                      (v) =>
                        update((e) => {
                          e.groups[gi].senses[si].definitions[l].short = v;
                        }),
                    )}
                    {input(
                      text(mode, '详细解释', 'Detailed explanation'),
                      sense.definitions[l].detail,
                      (v) =>
                        update((e) => {
                          e.groups[gi].senses[si].definitions[l].detail = v;
                        }),
                      true,
                    )}
                    {input(
                      text(mode, '用法与介词', 'Usage and prepositions'),
                      sense.definitions[l].usage,
                      (v) =>
                        update((e) => {
                          e.groups[gi].senses[si].definitions[l].usage = v;
                        }),
                      true,
                    )}
                  </div>
                ))}
                <div className="form-grid two">
                  <label>
                    {text(mode, '义项关系', 'Sense relationship')}
                    <select
                      value={sense.distance}
                      onChange={(ev) =>
                        update((e) => {
                          const s = e.groups[gi].senses[si];
                          s.distance = ev.target.value as Sense['distance'];
                          if (s.distance !== 'derived') delete s.derivedFromSenseId;
                        })
                      }
                    >
                      {['unspecified', 'close', 'distinct', 'derived'].map((v) => (
                        <option value={v} key={v}>
                          {distanceText(v, mode)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {text(mode, '义项性别', 'Sense gender')}
                    <select
                      value={sense.gender ?? 'inherit'}
                      onChange={(ev) =>
                        update((e) => {
                          const s = e.groups[gi].senses[si];
                          if (ev.target.value === 'inherit') delete s.gender;
                          else s.gender = ev.target.value as PosGroup['gender'];
                        })
                      }
                    >
                      <option value="inherit">
                        {text(mode, '使用词性默认值', 'Use group default')}
                      </option>
                      {genders.map((g) => (
                        <option value={g} key={g}>
                          {genderText(g, mode)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label>
                  {text(mode, '衍生来源义项', 'Derived from sense')}
                  <select
                    value={sense.derivedFromSenseId ?? ''}
                    onChange={(ev) =>
                      update((e) => {
                        const s = e.groups[gi].senses[si];
                        if (ev.target.value) {
                          s.derivedFromSenseId = ev.target.value;
                          s.distance = 'derived';
                        } else delete s.derivedFromSenseId;
                      })
                    }
                  >
                    <option value="">{text(mode, '未指定', 'Unspecified')}</option>
                    {allSenses
                      .filter((s) => s.id !== sense.id)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.definitions[locale].short ||
                            `${text(mode, '义项', 'Sense')} ${allSenses.indexOf(s) + 1}`}
                        </option>
                      ))}
                  </select>
                </label>
                {sense.examples.map((ex, xi) => (
                  <div className="editor-item" key={ex.id}>
                    <div className="editor-section-title">
                      <h4>
                        {t('example')} {xi + 1}
                      </h4>
                      {remove(text(mode, '移除例句', 'Remove example'), () =>
                        update((e) => {
                          e.groups[gi].senses[si].examples.splice(xi, 1);
                        }),
                      )}
                    </div>
                    {input(
                      text(mode, '法语例句', 'French example'),
                      ex.text,
                      (v) =>
                        update((e) => {
                          e.groups[gi].senses[si].examples[xi].text = v;
                        }),
                      true,
                    )}
                    {biInputs(
                      text(mode, '例句翻译', 'Example translation'),
                      ex.translations,
                      (l, v) =>
                        update((e) => {
                          e.groups[gi].senses[si].examples[xi].translations[l] = v;
                        }),
                    )}
                    {biInputs(text(mode, '例句说明', 'Example note'), ex.note, (l, v) =>
                      update((e) => {
                        e.groups[gi].senses[si].examples[xi].note[l] = v;
                      }),
                    )}
                    {input(t('source'), ex.source, (v) =>
                      update((e) => {
                        e.groups[gi].senses[si].examples[xi].source = v;
                      }),
                    )}
                  </div>
                ))}
                {add(text(mode, '添加例句', 'Add example'), () =>
                  update((e) => {
                    e.groups[gi].senses[si].examples.push(newExample());
                  }),
                )}
                {sense.collocations.map((c, ci) => (
                  <div className="editor-item" key={c.id}>
                    {input(text(mode, '搭配／句式', 'Collocation / construction'), c.text, (v) =>
                      update((e) => {
                        e.groups[gi].senses[si].collocations[ci].text = v;
                      }),
                    )}
                    {biInputs(
                      text(mode, '搭配说明', 'Construction explanation'),
                      c.translations,
                      (l, v) =>
                        update((e) => {
                          e.groups[gi].senses[si].collocations[ci].translations[l] = v;
                        }),
                    )}
                    {remove(text(mode, '移除搭配', 'Remove construction'), () =>
                      update((e) => {
                        e.groups[gi].senses[si].collocations.splice(ci, 1);
                      }),
                    )}
                  </div>
                ))}
                {add(text(mode, '添加搭配', 'Add construction'), () =>
                  update((e) => {
                    e.groups[gi].senses[si].collocations.push({
                      id: newId(),
                      text: '',
                      translations: bilingual(),
                    });
                  }),
                )}
              </section>
            ))}
            {add(text(mode, '添加义项', 'Add sense'), () =>
              update((e) => {
                e.groups[gi].senses.push(newSense());
              }),
            )}
            <details className="editor-disclosure">
              <summary>
                {text(mode, '阴阳性、复数与变体词形', 'Gender, plural and variant forms')} (
                {group.forms.length})
              </summary>
              {group.forms.map((f, fi) => (
                <div className="editor-item" key={f.id}>
                  {input(text(mode, '词形', 'Word form'), f.form, (v) =>
                    update((e) => {
                      e.groups[gi].forms[fi].form = v;
                    }),
                  )}
                  <div className="form-grid two">
                    <label>
                      {text(mode, '形式类型', 'Form type')}
                      <select
                        value={f.kind}
                        onChange={(ev) =>
                          update((e) => {
                            e.groups[gi].forms[fi].kind = ev.target.value as typeof f.kind;
                          })
                        }
                      >
                        {(['feminine', 'masculine', 'plural', 'variant'] as const).map((v) => (
                          <option value={v} key={v}>
                            {text(
                              mode,
                              {
                                feminine: '阴性形式',
                                masculine: '阳性形式',
                                plural: '复数形式',
                                variant: '其他变体',
                              }[v],
                              v,
                            )}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {text(mode, '性别', 'Gender')}
                      <select
                        value={f.gender}
                        onChange={(ev) =>
                          update((e) => {
                            e.groups[gi].forms[fi].gender = ev.target.value as typeof f.gender;
                          })
                        }
                      >
                        {genders.map((g) => (
                          <option value={g} key={g}>
                            {genderText(g, mode)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {text(mode, '数', 'Number')}
                      <select
                        value={f.number}
                        onChange={(ev) =>
                          update((e) => {
                            e.groups[gi].forms[fi].number = ev.target.value as typeof f.number;
                          })
                        }
                      >
                        <option value="">—</option>
                        <option value="singular">{text(mode, '单数', 'Singular')}</option>
                        <option value="plural">{text(mode, '复数', 'Plural')}</option>
                      </select>
                    </label>
                  </div>
                  {biInputs(text(mode, '词形说明', 'Form notes'), f.notes, (l, v) =>
                    update((e) => {
                      e.groups[gi].forms[fi].notes[l] = v;
                    }),
                  )}
                  {remove(text(mode, '移除词形', 'Remove form'), () =>
                    update((e) => {
                      e.groups[gi].forms.splice(fi, 1);
                    }),
                  )}
                </div>
              ))}
              {add(text(mode, '添加词形', 'Add form'), () =>
                update((e) => {
                  e.groups[gi].forms.push({
                    id: newId(),
                    form: '',
                    kind: 'variant',
                    gender: '',
                    number: '',
                    notes: bilingual(),
                  });
                }),
              )}
            </details>
            {group.verb && (
              <VerbEditor
                key={group.id}
                groupId={group.id}
                verb={group.verb}
                mode={mode}
                locales={locales}
                change={(fn) => update((e) => fn(e.groups[gi].verb!))}
              />
            )}
          </section>
        ))}
        {add(text(mode, '添加词性分组', 'Add part of speech'), () =>
          update((e) => {
            e.groups.push(newGroup());
          }),
        )}
        <details className="editor-disclosure">
          <summary>
            {text(mode, '原动词与其他关联', 'Base verb and other links')} ({draft.relations.length})
          </summary>
          {draft.relations.map((r, ri) => (
            <div className="editor-item" key={r.id}>
              <label>
                {text(mode, '关联类型', 'Relation type')}
                <select
                  value={r.type}
                  onChange={(ev) =>
                    update((e) => {
                      e.relations[ri].type = ev.target.value as RelationType;
                    })
                  }
                >
                  {(
                    [
                      'pronominal-of',
                      'derived-from',
                      'same-family',
                      'synonym',
                      'antonym',
                      'related',
                    ] as const
                  )
                    .filter((v) => v !== 'pronominal-of' || draft.kind === 'pronominal')
                    .map((v) => (
                      <option key={v} value={v}>
                        {relationText(v, mode)}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                {text(mode, '目标词条', 'Target entry')}
                <select
                  value={r.targetId}
                  onChange={(ev) =>
                    update((e) => {
                      e.relations[ri].targetId = ev.target.value;
                    })
                  }
                >
                  <option value="">{text(mode, '请选择', 'Choose an entry')}</option>
                  {state.entries
                    .filter(
                      (e) =>
                        e.id !== draft.id &&
                        (r.type !== 'pronominal-of' ||
                          (e.kind === 'lexical' && e.groups.some((g) => g.pos === 'verb'))),
                    )
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.word}
                      </option>
                    ))}
                </select>
              </label>
              {biInputs(text(mode, '关系说明', 'Relation notes'), r.notes, (l, v) =>
                update((e) => {
                  e.relations[ri].notes[l] = v;
                }),
              )}
              <label>
                {text(mode, '关系核对状态', 'Relation review status')}
                <select
                  value={r.status}
                  onChange={(ev) =>
                    update((e) => {
                      e.relations[ri].status = ev.target.value as typeof r.status;
                    })
                  }
                >
                  {['draft', 'needs-review', 'reviewed'].map((s) => (
                    <option key={s} value={s}>
                      {statusText(s, mode)}
                    </option>
                  ))}
                </select>
              </label>
              {input(t('source'), r.source, (v) =>
                update((e) => {
                  e.relations[ri].source = v;
                }),
              )}
              {remove(text(mode, '移除关联', 'Remove link'), () =>
                update((e) => {
                  e.relations.splice(ri, 1);
                }),
              )}
            </div>
          ))}
          {add(text(mode, '添加关联', 'Add link'), () =>
            update((e) => {
              e.relations.push({
                id: newId(),
                type:
                  e.kind === 'pronominal' && !e.relations.some((r) => r.type === 'pronominal-of')
                    ? 'pronominal-of'
                    : 'related',
                targetId: '',
                notes: bilingual(),
                status: 'needs-review',
                source: '',
              });
            }),
          )}
        </details>
        <details className="editor-disclosure">
          <summary>
            {text(mode, '词族与词根', 'Word families and roots')} ({draft.families.length})
          </summary>
          <label>
            {text(mode, '加入已有词族', 'Join an existing family')}
            <select
              value=""
              onChange={(ev) =>
                update((e) => {
                  const f = familyOptions.find((f) => f.key === ev.target.value);
                  if (f && !e.families.some((x) => x.key === f.key))
                    e.families.push(structuredClone(f));
                })
              }
            >
              <option value="">{text(mode, '请选择', 'Choose a family')}</option>
              {familyOptions.map((f) => (
                <option value={f.key} key={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          {draft.families.map((f, fi) => (
            <div className="editor-item" key={fi}>
              {input(
                text(mode, '词族标识（相同标识自动关联）', 'Family ID (matching IDs link entries)'),
                f.key,
                (v) =>
                  update((e) => {
                    e.families[fi].key = v;
                  }),
              )}
              {input(text(mode, '词族名称', 'Family label'), f.label, (v) =>
                update((e) => {
                  e.families[fi].label = v;
                }),
              )}
              {input(text(mode, '词根／词干标注', 'Root / stem annotation'), f.root, (v) =>
                update((e) => {
                  e.families[fi].root = v;
                }),
              )}
              {biInputs(text(mode, '词族说明', 'Family notes'), f.notes, (l, v) =>
                update((e) => {
                  e.families[fi].notes[l] = v;
                }),
              )}
              <label>
                {text(mode, '词族核对状态', 'Family review status')}
                <select
                  value={f.status}
                  onChange={(ev) =>
                    update((e) => {
                      e.families[fi].status = ev.target.value as typeof f.status;
                    })
                  }
                >
                  {['draft', 'needs-review', 'reviewed'].map((s) => (
                    <option key={s} value={s}>
                      {statusText(s, mode)}
                    </option>
                  ))}
                </select>
              </label>
              {remove(text(mode, '移除词族', 'Remove family'), () =>
                update((e) => {
                  e.families.splice(fi, 1);
                }),
              )}
            </div>
          ))}
          {add(text(mode, '建立词族', 'Create family'), () =>
            update((e) => {
              e.families.push({
                key: newId(),
                label: '',
                root: '',
                notes: bilingual(),
                status: 'needs-review',
              });
            }),
          )}
        </details>
        <details className="editor-disclosure">
          <summary>{t('source')}</summary>
          {input(t('source'), draft.source, (v) =>
            update((e) => {
              e.source = v;
            }),
          )}
          {draft.sources.map((s, i) => (
            <div className="editor-item" key={i}>
              {input(text(mode, '来源名称', 'Source label'), s.label, (v) =>
                update((e) => {
                  e.sources[i].label = v;
                }),
              )}
              {input(text(mode, '来源网址（http/https）', 'Source URL (http/https)'), s.url, (v) =>
                update((e) => {
                  e.sources[i].url = v;
                }),
              )}
              {input(text(mode, '页码／定位', 'Page / locator'), s.locator, (v) =>
                update((e) => {
                  e.sources[i].locator = v;
                }),
              )}
              {remove(text(mode, '移除来源', 'Remove source'), () =>
                update((e) => {
                  e.sources.splice(i, 1);
                }),
              )}
            </div>
          ))}
          {add(text(mode, '添加核对来源', 'Add verification source'), () =>
            update((e) => {
              e.sources.push({ label: '', url: '', locator: '' });
            }),
          )}
        </details>
        {input(
          text(mode, '标签（用 | 分隔）', 'Tags (separated by |)'),
          draft.tags.join('|'),
          (v) =>
            update((e) => {
              e.tags = v.split('|');
            }),
        )}
        <button type="submit" className="primary-button editor-save">
          {t('save')}
        </button>
      </fieldset>
    </form>
  );
}
function VerbEditor({
  verb,
  groupId,
  mode,
  locales,
  change,
}: {
  verb: VerbProfile;
  groupId: string;
  mode: LanguageMode;
  locales: Locale[];
  change: (fn: (v: VerbProfile) => void) => void;
}) {
  const [selected, setSelected] = useState('indicative:present'),
    [mood, tense] = selected.split(':') as [Mood, string];
  const table =
    verb.conjugations.find((t) => `${t.mood}:${t.tense}` === selected) ??
    blankTable(groupId, mood, tense);
  const editTable = (fn: (t: typeof table) => void) =>
    change((v) => {
      let t = v.conjugations.find((t) => `${t.mood}:${t.tense}` === selected);
      if (!t) {
        t = blankTable(groupId, mood, tense);
        v.conjugations.push(t);
      }
      fn(t);
    });
  const rowPersons =
    mood === 'imperative'
      ? (['2s', '1p', '2p'] as const)
      : ['infinitive', 'participle', 'gerund'].includes(mood)
        ? (['none'] as const)
        : persons;
  const input = (label: string, value: string, fn: (s: string) => void) => (
    <label>
      {label}
      <input aria-label={label} value={value} onChange={(e) => fn(e.target.value)} />
    </label>
  );
  return (
    <details className="editor-disclosure">
      <summary>{text(mode, '动词属性与变位', 'Verb properties and conjugation')}</summary>
      <div className="form-grid two">
        <label>
          {text(mode, '助动词', 'Auxiliary')}
          <select
            value={verb.auxiliary}
            onChange={(e) =>
              change((v) => {
                v.auxiliary = e.target.value as typeof v.auxiliary;
              })
            }
          >
            <option value="">—</option>
            <option>avoir</option>
            <option>être</option>
            <option value="variable">{text(mode, '依用法变化', 'Varies by construction')}</option>
          </select>
        </label>
        {input(text(mode, '过去分词', 'Past participle'), verb.pastParticiple, (s) =>
          change((v) => {
            v.pastParticiple = s;
          }),
        )}
        {input(text(mode, '现在分词', 'Present participle'), verb.presentParticiple, (s) =>
          change((v) => {
            v.presentParticiple = s;
          }),
        )}
        <label>
          {text(mode, '代词式用法', 'Pronominal usage')}
          <select
            value={verb.pronominalUse}
            onChange={(e) =>
              change((v) => {
                v.pronominalUse = e.target.value as typeof v.pronominalUse;
              })
            }
          >
            {['', 'reflexive', 'reciprocal', 'lexicalized', 'passive', 'unspecified'].map((s) => (
              <option value={s} key={s}>
                {text(
                  mode,
                  {
                    '': '不适用',
                    reflexive: '自反',
                    reciprocal: '相互',
                    lexicalized: '词汇化／意义变化',
                    passive: '被动',
                    unspecified: '待判断',
                  }[s] ?? s,
                  s || 'Not applicable',
                )}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={verb.pronounRequired}
          onChange={(e) =>
            change((v) => {
              v.pronounRequired = e.target.checked;
            })
          }
        />
        {text(mode, '代词必须保留', 'Pronoun required')}
      </label>
      {locales.map((l) => (
        <div key={l}>
          {input(
            `${text(mode, '与原动词的意义差别', 'Meaning difference from base')}${locales.length > 1 ? ` · ${l}` : ''}`,
            verb.meaningDifference[l],
            (s) =>
              change((v) => {
                v.meaningDifference[l] = s;
              }),
          )}
          {input(
            `${text(mode, '过去分词配合说明', 'Participle agreement note')}${locales.length > 1 ? ` · ${l}` : ''}`,
            verb.agreementNote[l],
            (s) =>
              change((v) => {
                v.agreementNote[l] = s;
              }),
          )}
        </div>
      ))}
      <label>
        {text(mode, '编辑变位', 'Edit conjugation')}
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          {conjugationSlots.map(([m, t]) => (
            <option value={`${m}:${t}`} key={`${m}:${t}`}>
              {moodNames[m][mode === 'enOnly' ? 1 : 0]} ·{' '}
              {tenseNames[t]?.[mode === 'enOnly' ? 1 : 0] ?? t}
            </option>
          ))}
          {verb.conjugations
            .filter((t) => !conjugationSlots.some(([m, k]) => m === t.mood && k === t.tense))
            .map((t) => (
              <option key={t.id} value={`${t.mood}:${t.tense}`}>
                {moodNames[t.mood][mode === 'enOnly' ? 1 : 0]} · {t.tense}
              </option>
            ))}
        </select>
      </label>
      <label>
        {text(mode, '收录状态', 'Availability')}
        <select
          value={table.status}
          onChange={(e) =>
            editTable((t) => {
              t.status = e.target.value as typeof t.status;
              if (t.status !== 'provided') t.rows = [];
              else t.rows = rowPersons.map((p) => ({ person: p, forms: [''] }));
            })
          }
        >
          <option value="not-provided">{text(mode, '未收录', 'Not provided')}</option>
          <option value="provided">{text(mode, '已收录', 'Provided')}</option>
          <option value="not-applicable">{text(mode, '不适用', 'Not applicable')}</option>
        </select>
      </label>
      {table.status === 'provided' && (
        <>
          <p className="muted">
            {text(
              mode,
              '填写完整法语形式；多个可用形式以 | 分隔。',
              'Enter complete French forms; separate alternatives with |.',
            )}
          </p>
          {rowPersons.map((p) =>
            input(
              p === 'none' ? text(mode, '形式', 'Form') : p,
              table.rows.find((r) => r.person === p)?.forms.join(' | ') ?? '',
              (s) =>
                editTable((t) => {
                  const row = t.rows.find((r) => r.person === p);
                  if (row) row.forms = s.split('|').map((x) => x.trim());
                  else t.rows.push({ person: p, forms: s.split('|').map((x) => x.trim()) });
                }),
            ),
          )}
        </>
      )}
      {locales.map((l) =>
        input(
          `${text(mode, '变位说明', 'Conjugation notes')}${locales.length > 1 ? ` · ${l}` : ''}`,
          table.notes[l],
          (s) =>
            editTable((t) => {
              t.notes[l] = s;
            }),
        ),
      )}
      {input(text(mode, '变位核对来源（网址）', 'Conjugation source (URL)'), table.source, (s) =>
        editTable((t) => {
          t.source = s;
        }),
      )}
    </details>
  );
}

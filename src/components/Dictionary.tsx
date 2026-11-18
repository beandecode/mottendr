import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronLeft, FileUp, Info, Plus, RotateCcw, Search, X } from 'lucide-react';
import type { AppState } from '../domain/types';
import { localeFor } from '../domain/types';
import {
  dictionaryRecords,
  dictionaryManifest,
  displayDictionaryEntry,
  learningDictionaryIndex,
  lookupKey,
  searchFold as fold,
  learnedDictionaryEntry,
  recordMeanings,
  dictionaryRecord,
  letterOf,
  type DictionaryRecord,
} from '../domain/dictionary';
import { ContentInfo, LexiconDetails } from './Lexicon';
import { translator, posLabel } from '../i18n';
import { AutoLoad, MoreMenu, StickySearch } from '../app/ui';
import { pushRecent, readRecent, writeRecent } from '../app/recent';
import type { ToolTab } from '../pages/AddTools';
import { isDemo } from '../app/demo';
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const POS = [
  'noun',
  'verb',
  'adjective',
  'adverb',
  'expression',
  'pronoun',
  'preposition',
  'conjunction',
  'interjection',
];
// Look words up. With nothing typed the page shows recent lookups and an A–Z grid; a letter opens
// the whole selection grouped by letter, with an A–Z rail for jumping. A record opens in a sheet
// (DictionarySheet, shown by App), so the list keeps its place. Adding, importing, restoring and
// the data credits live in the header menu: the lists load more as they scroll and have no end.
export default function DictionaryPage({
  state,
  openRecord,
  openTools,
  openAttribution,
}: {
  state: AppState;
  openRecord: (id: string) => void;
  openTools: (tab: ToolTab) => void;
  openAttribution: () => void;
}) {
  const mode = state.prefs.mode,
    en = mode === 'enOnly',
    locale = localeFor(mode),
    t = translator(mode);
  const [query, setQuery] = useState(''),
    [pos, setPos] = useState(''),
    [count, setCount] = useState(60),
    [browsing, setBrowsing] = useState(false),
    [letter, setLetter] = useState('A'),
    [jump, setJump] = useState<string | null>(null),
    [recent, setRecent] = useState(readRecent);
  const learnedIndex = useMemo(() => learningDictionaryIndex(state), [state.entries]);
  const searching = Boolean(query.trim() || pos);
  const results = useMemo(() => {
    if (!searching) return [];
    const q = fold(query.trim());
    return dictionaryRecords
      .filter(
        (r) =>
          (!pos ||
            r.lexemes.some((l) => l.pos === pos) ||
            r.morphology.some((m) => m.pos === pos)) &&
          (!q ||
            fold(
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
                    l.senses.flatMap((s) =>
                      mode === 'zhEnAssist' ? [...s.zh, ...s.en] : s[locale],
                    ),
                  )),
              ].join(' '),
            ).includes(q)),
      )
      .sort((a, b) => Number(fold(b.word) === q) - Number(fold(a.word) === q));
  }, [searching, query, pos, locale, mode, state.entries]);
  // The whole selection by letter, in French alphabetical order (accents after the plain letter).
  const byLetter = useMemo(() => {
    if (!browsing) return [];
    const collator = new Intl.Collator('fr');
    return dictionaryRecords
      .map((r) => ({ r, letter: letterOf(r.word) }))
      .sort((a, b) => a.letter.localeCompare(b.letter) || collator.compare(a.r.word, b.r.word));
  }, [browsing]);
  const letters = useMemo(() => new Set(byLetter.map((x) => x.letter)), [byLetter]);

  const open = (id: string) => {
    const next = pushRecent(recent, id);
    setRecent(next);
    writeRecent(next);
    openRecord(id);
  };
  const startBrowsing = (to: string) => {
    setBrowsing(true);
    setQuery('');
    setPos('');
    setJump(to);
  };
  // Jumping to a letter first renders far enough down the list, then scrolls so its heading sits
  // under the top bar and the search bar.
  useEffect(() => {
    if (!jump || !browsing) return;
    const index = byLetter.findIndex((x) => x.letter === jump);
    if (index < 0) return setJump(null);
    if (count < index + 60) return setCount(index + 60);
    const heading = document.getElementById(`letter-${jump}`),
      list = heading?.nextElementSibling;
    if (!heading || !list) return;
    // Rows above are only estimated until they render (content-visibility), so align on the
    // group's first row and correct again over the next frames as their real heights arrive.
    const align = () => {
      if (!heading.isConnected) return;
      if (index === 0) return window.scrollTo(0, 0);
      const bar = document.querySelector('.topbar')?.getBoundingClientRect().height ?? 0,
        search = document.querySelector<HTMLElement>('.sticky-search')?.offsetHeight ?? 0,
        gap = list.getBoundingClientRect().top - (bar + search + heading.offsetHeight + 8);
      if (Math.abs(gap) > 1) window.scrollBy(0, gap);
    };
    align();
    requestAnimationFrame(() => requestAnimationFrame(align));
    setTimeout(align, 150);
    setLetter(jump);
    setJump(null);
  }, [jump, browsing, byLetter, count]);

  const row = (r: DictionaryRecord) => {
    const learned = learnedIndex.get(lookupKey(r.word)),
      meaning = recordMeanings(r, learned, locale);
    return (
      <button
        className="dictionary-row"
        key={r.id}
        data-testid="dictionary-result"
        onClick={() => open(r.id)}
      >
        <span className="row-word" lang="fr">
          {r.word}
          <small>
            {[...new Set([...r.lexemes, ...r.morphology].map((l) => posLabel(l.pos, mode)))].join(
              ' / ',
            )}
          </small>
        </span>
        {learned ? <small className="badge">{en ? 'Added' : '已加入'}</small> : <span />}
        <span className={`row-meaning ${meaning.text ? '' : 'dictionary-no-meaning'}`}>
          {meaning.fallback && (
            <abbr className="meaning-fallback" title="English">
              EN
            </abbr>
          )}
          {meaning.text || t('noMeaning')}
        </span>
      </button>
    );
  };
  const recentRecords = recent
    .map((id) => dictionaryRecord(id))
    .filter((r): r is DictionaryRecord => Boolean(r));

  return (
    <div className="dictionary">
      <div className="page-heading heading-with-menu">
        <div>
          {browsing ? (
            <button
              className="text-button back-link"
              onClick={() => {
                setBrowsing(false);
                setCount(60);
                window.scrollTo(0, 0);
              }}
            >
              <ChevronLeft size={18} />
              {t('dictionary')}
            </button>
          ) : (
            <p className="eyebrow">LE DICTIONNAIRE</p>
          )}
          <h1>{browsing ? t('browseAz') : t('dictionary')}</h1>
          <p>
            {browsing
              ? en
                ? `${dictionaryRecords.length.toLocaleString()} headwords`
                : `${dictionaryRecords.length.toLocaleString()} 个词头`
              : en
                ? 'Look up a word. Add it when you want to learn it.'
                : '先查词，想学的时候再加入。'}
          </p>
        </div>
        <div className="heading-actions">
          <MoreMenu
            label={t('dictionaryMenu')}
            items={[
              {
                label: t('manual'),
                icon: <Plus size={16} />,
                testId: 'dictionary-tools',
                run: () => openTools('manual'),
              },
              // The public demo has no import or restore.
              ...(isDemo
                ? []
                : [
                    {
                      label: t('import'),
                      icon: <FileUp size={16} />,
                      run: () => openTools('import'),
                    },
                    {
                      label: t('restore'),
                      icon: <RotateCcw size={16} />,
                      run: () => openTools('restore'),
                    },
                  ]),
              { label: t('attribution'), icon: <Info size={16} />, run: openAttribution },
            ]}
          />
        </div>
      </div>
      <StickySearch>
        <div className="search-field">
          <Search size={18} />
          <input
            data-testid="dictionary-search"
            aria-label={t('search')}
            placeholder={en ? 'French word or meaning' : '法语单词或释义'}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCount(60);
            }}
          />
          {query && (
            <button
              className="search-clear"
              aria-label={t('clearSearch')}
              onClick={() => setQuery('')}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </StickySearch>
      {(searching || browsing) && (
        <div className="chip-row">
          <label className={`chip scope-chip ${pos ? 'set' : ''}`}>
            <span>{en ? 'Part of speech: ' : '词性：'}</span>
            <select
              aria-label={en ? 'Part of speech' : '词性'}
              value={pos}
              onChange={(e) => {
                setPos(e.target.value);
                setCount(60);
              }}
            >
              <option value="">{en ? 'All' : '全部'}</option>
              {POS.map((p) => (
                <option key={p} value={p}>
                  {posLabel(p, mode)}
                </option>
              ))}
            </select>
            <ChevronDown size={16} />
          </label>
        </div>
      )}
      <p className="muted dictionary-result-count">
        {searching
          ? `${results.length.toLocaleString()} ${t('words')}`
          : en
            ? `Offline selection of ${dictionaryRecords.length.toLocaleString()} headwords, not a complete dictionary`
            : `离线精选 ${dictionaryRecords.length.toLocaleString()} 个词头，不是完整的法语词典`}
      </p>
      {searching ? (
        <>
          <div className="word-list dictionary-list">{results.slice(0, count).map(row)}</div>
          {!results.length && (
            <div className="empty-state">
              <p>
                {en
                  ? 'This word is not in the offline selection. You can add it yourself.'
                  : '离线精选包暂未收录这个词，可以自己添加。'}
              </p>
              <button className="secondary-button" onClick={() => openTools('manual')}>
                <Plus size={17} />
                {t('manual')}
              </button>
            </div>
          )}
          {results.length > count && (
            <AutoLoad
              onLoad={() => setCount((n) => n + 60)}
              label={`${t('showMore')} (${count}/${results.length})`}
            />
          )}
        </>
      ) : browsing ? (
        <>
          {byLetter
            .slice(0, count)
            .reduce<{ letter: string; records: DictionaryRecord[] }[]>((groups, x) => {
              const last = groups.at(-1);
              if (last?.letter === x.letter) last.records.push(x.r);
              else groups.push({ letter: x.letter, records: [x.r] });
              return groups;
            }, [])
            .map((g) => (
              <section className="letter-group" key={g.letter}>
                <h2 className="letter-head" id={`letter-${g.letter}`}>
                  {g.letter}
                </h2>
                <div className="word-list dictionary-list">{g.records.map(row)}</div>
              </section>
            ))}
          {byLetter.length > count && (
            <AutoLoad
              onLoad={() => setCount((n) => n + 120)}
              label={`${t('showMore')} (${count}/${byLetter.length})`}
            />
          )}
          {/* In a portal: the page's entry animation would make "fixed" relative to the page. */}
          {createPortal(
            <LetterRail letters={letters} current={letter} jump={setJump} />,
            document.body,
          )}
        </>
      ) : (
        <>
          {recentRecords.length > 0 && (
            <>
              <p className="group-label">
                {t('recentLookups')}
                <button
                  className="text-button"
                  onClick={() => {
                    setRecent([]);
                    writeRecent([]);
                  }}
                >
                  {t('clearRecent')}
                </button>
              </p>
              <div className="word-list dictionary-list">{recentRecords.map(row)}</div>
            </>
          )}
          <p className="group-label">
            {t('browseAz')}
            <span>
              {en
                ? `${dictionaryRecords.length.toLocaleString()} headwords`
                : `${dictionaryRecords.length.toLocaleString()} 个词头`}
            </span>
          </p>
          <div className="letter-grid">
            {LETTERS.map((l) => (
              <button key={l} onClick={() => startBrowsing(l)}>
                {l}
              </button>
            ))}
            <button className="all" onClick={() => startBrowsing('A')}>
              {en ? 'All' : '全部'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// The A–Z rail on the right while browsing: tap a letter, or slide a finger along it, as in
// Contacts.
function LetterRail({
  letters,
  current,
  jump,
}: {
  letters: Set<string>;
  current: string;
  jump: (letter: string) => void;
}) {
  const at = (x: number, y: number) =>
    (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-letter]')
      ?.dataset.letter;
  const pressed = useRef(false),
    last = useRef('');
  const go = (letter?: string) => {
    if (!letter || letter === last.current || !letters.has(letter)) return;
    last.current = letter;
    jump(letter);
  };
  return (
    <nav
      className="letter-rail"
      aria-label="A–Z"
      onPointerDown={(e) => {
        pressed.current = true;
        last.current = '';
        e.currentTarget.setPointerCapture(e.pointerId);
        go(at(e.clientX, e.clientY));
      }}
      onPointerMove={(e) => pressed.current && go(at(e.clientX, e.clientY))}
      onPointerUp={() => (pressed.current = false)}
      onPointerCancel={() => (pressed.current = false)}
    >
      {LETTERS.map((l) => (
        <button
          key={l}
          data-letter={l}
          className={l === current ? 'on' : ''}
          disabled={!letters.has(l)}
          aria-label={l}
          onClick={() => go(l)}
        >
          {l}
        </button>
      ))}
    </nav>
  );
}

// One dictionary record in the detail sheet: add it to learning, or open the learned entry.
export function DictionarySheet({
  state,
  record,
  busy,
  speak,
  add,
  openLearning,
}: {
  state: AppState;
  record: DictionaryRecord;
  busy: boolean;
  speak: (s: string) => void;
  add: (record: DictionaryRecord) => Promise<void>;
  openLearning: (id: string) => void;
}) {
  const mode = state.prefs.mode,
    en = mode === 'enOnly',
    locale = localeFor(mode);
  const entry = useMemo(() => displayDictionaryEntry(state, record), [record, state]),
    learned = learnedDictionaryEntry(state, record);
  const canAdd = entry?.groups.some((g) =>
    g.senses.some((s) => s.definitions[locale].short.trim()),
  );
  const actions = (
    <div className="dictionary-add">
      {learned ? (
        <button
          className="secondary-button"
          data-testid="dictionary-added"
          onClick={() => openLearning(learned.id)}
        >
          {learned.archived
            ? en
              ? 'Archived · view'
              : '已归档 · 查看'
            : en
              ? 'In my words · view'
              : '已在词库 · 查看'}
        </button>
      ) : (
        <button
          className="primary-button"
          data-testid="dictionary-add"
          disabled={busy || !canAdd}
          onClick={() => void add(record)}
        >
          <Plus size={17} />
          {en ? 'Add to learning' : '加入学习'}
        </button>
      )}
      {!canAdd && !learned && (
        <p className="muted">
          {en
            ? 'No English meaning in this record yet. Add the word yourself, or use a Chinese mode.'
            : '这条记录还没有中文释义。可以自己添加这个词，或切换到英文模式。'}
        </p>
      )}
    </div>
  );
  return (
    <div className="dictionary-sheet" data-testid="dictionary-detail">
      {entry ? (
        <>
          <LexiconDetails
            entry={entry}
            state={state}
            speak={speak}
            openLinked={openLearning}
            afterHero={actions}
          />
          <ContentInfo entry={entry} state={state} />
        </>
      ) : (
        actions
      )}
    </div>
  );
}

// What the offline dictionary covers and where its data comes from.
export function DictionaryAttribution({ state }: { state: AppState }) {
  const en = state.prefs.mode === 'enOnly';
  return (
    <div className="dictionary-attribution">
      <p>
        {en
          ? `Offline selection: ${dictionaryRecords.length.toLocaleString()} headwords, covering the current collection and selected related words. Not a complete French dictionary.`
          : `离线精选包：${dictionaryRecords.length.toLocaleString()} 个词头，覆盖当前词库及部分关联词，不是完整的法语词典。`}
      </p>
      {dictionaryManifest.sources.map((s) => (
        <p key={s.id}>
          <a href={s.url} target="_blank" rel="noreferrer">
            {s.label}
          </a>{' '}
          ·{' '}
          <a href={s.licenseUrl} target="_blank" rel="noreferrer">
            {s.license}
          </a>
          <small>{s.attribution}</small>
        </p>
      ))}
    </div>
  );
}

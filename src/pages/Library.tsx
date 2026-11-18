import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Archive,
  ArchiveRestore,
  ArrowRight,
  Check,
  ChevronDown,
  Download,
  Pause,
  Play,
  Search,
  Star,
  StarOff,
  X,
} from 'lucide-react';
import type { AppState, Entry } from '../domain/types';
import { localeFor } from '../domain/types';
import { exportTsv } from '../domain/import-export';
import { isSpecial, shortDefinition } from '../domain/lexicon';
import { inScope, scopeOptions } from '../domain/collections';
import { openIssues } from '../domain/issues';
import {
  entryProgresses,
  entryTag,
  LEECH_LAPSES,
  setEntryFlag,
  type EntryTag,
} from '../domain/learning';
import { posLabel, tagLabel, translator, type Label } from '../i18n';
import { download } from '../app/download';
import type { Modal, Mutate } from '../app/types';
import { AutoLoad, Empty, MoreMenu, StickySearch, SwipeRow } from '../app/ui';

const FILTERS = [
  'all',
  'favorites',
  'due',
  'seen',
  'forgotten',
  'irregular',
  'suspended',
  'archived',
  'issues',
] as const;
const filterLabel: Record<(typeof FILTERS)[number], Label> = {
  all: 'all',
  favorites: 'favorites',
  due: 'filterDue',
  seen: 'filterSeen',
  forgotten: 'filterForgotten',
  irregular: 'irregular',
  suspended: 'suspended',
  archived: 'archived',
  issues: 'issues',
};
const statusLabel: Record<EntryTag, Label> = {
  new: 'statusNew',
  seen: 'statusSeen',
  learning: 'statusLearning',
  due: 'statusDue',
  mature: 'statusMature',
  paused: 'statusPaused',
  archived: 'archived',
};

// The learner's words: a compact header, a search bar that stays under the top bar, one row of
// filters, and two-line rows with the learning status. Rows slide left for favorite, pause and
// archive; "选择" turns on checkboxes for batch changes.
export default function LibraryPage({
  state,
  mutate,
  busy,
  open,
  now,
  onStudy,
}: {
  state: AppState;
  mutate: Mutate;
  busy: boolean;
  open: (m: Modal) => void;
  now: number;
  onStudy: (scope: string) => void;
}) {
  const mode = state.prefs.mode,
    en = mode === 'enOnly',
    t = translator(mode),
    locale = localeFor(mode);
  const [visibleCount, setVisibleCount] = useState(100);
  const [search, setSearch] = useState(''),
    [tag, setTag] = useState(''),
    [filter, setFilter] = useState<(typeof FILTERS)[number]>('all'),
    [selecting, setSelecting] = useState(false),
    [selected, setSelected] = useState<Set<string>>(() => new Set()),
    [openRow, setOpenRow] = useState<string | null>(null);
  useEffect(() => setVisibleCount(100), [search, tag, filter]);
  const tags = useMemo(() => scopeOptions(state.entries, true), [state.entries]);
  const flagged = useMemo(() => new Set(openIssues(state).map((i) => i.entryId)), [state.issues]);
  const progress = useMemo(() => entryProgresses(state, now), [state.tasks, state.entries, now]);
  const entries = useMemo(
    () =>
      state.entries
        .filter((e) => (filter === 'archived' ? e.archived : !e.archived))
        .filter(
          (e) =>
            inScope(e, tag) &&
            (filter !== 'favorites' || e.favorite) &&
            (filter !== 'irregular' || isSpecial(e)) &&
            (filter !== 'due' || (progress.get(e.id)!.due && !e.suspended)) &&
            (filter !== 'seen' || progress.get(e.id)!.stage === 'seen') &&
            (filter !== 'forgotten' || progress.get(e.id)!.lapses >= LEECH_LAPSES) &&
            (filter !== 'suspended' || e.suspended) &&
            (filter !== 'issues' || flagged.has(e.id)),
        )
        .filter((e) =>
          [
            e.word,
            shortDefinition(e, locale),
            ...(mode === 'zhEnAssist' ? [shortDefinition(e, 'en')] : []),
          ]
            .join(' ')
            .toLowerCase()
            .includes(search.toLowerCase()),
        ),
    [state.entries, filter, tag, search, locale, mode, progress, flagged],
  );
  const learned = (list: Entry[]) => list.filter((e) => progress.get(e.id)!.stage !== 'new').length;
  const dueCount = (list: Entry[]) =>
    list.filter((e) => progress.get(e.id)!.due && !e.suspended && !e.archived).length;
  const scoped = useMemo(
    () => (tag ? state.entries.filter((e) => !e.archived && inScope(e, tag)) : []),
    [state.entries, tag],
  );

  // Close an open row when the page scrolls, as iOS does.
  useEffect(() => {
    if (!openRow) return;
    const close = () => setOpenRow(null);
    window.addEventListener('scroll', close, { passive: true, once: true });
    return () => window.removeEventListener('scroll', close);
  }, [openRow]);

  const flag = (
    ids: Iterable<string>,
    which: 'favorite' | 'suspended' | 'archived',
    value: boolean,
  ) => mutate((d) => setEntryFlag(d, ids, which, value));
  const finishSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  const allSelected = entries.length > 0 && entries.every((e) => selected.has(e.id));

  return (
    <div className="library">
      <div className="page-heading heading-with-menu">
        <div>
          <p className="eyebrow">LES MOTS</p>
          <h1>{t('library')}</h1>
          <p className="library-counts">
            {tag && `${tagLabel(tag, mode)} · `}
            {entries.length.toLocaleString()} {t('words')} · {t('learnedShort')}{' '}
            {learned(entries).toLocaleString()} · {t('dueShort')}{' '}
            {dueCount(entries).toLocaleString()}
          </p>
        </div>
        <div className="heading-actions">
          <button
            className="text-button"
            data-testid="library-select"
            onClick={() => (selecting ? finishSelecting() : setSelecting(true))}
          >
            {t(selecting ? 'done' : 'select')}
          </button>
          {!selecting && (
            <MoreMenu
              label={t('exportMenu')}
              items={[
                {
                  label: t('export'),
                  icon: <Download size={16} />,
                  run: () => download('francais-entries.json', JSON.stringify(entries, null, 2)),
                },
                {
                  label: t('exportTsv'),
                  icon: <Download size={16} />,
                  run: () =>
                    download(
                      'francais-entries.tsv',
                      exportTsv(entries),
                      'text/tab-separated-values',
                    ),
                },
              ]}
            />
          )}
        </div>
      </div>
      <StickySearch>
        <div className="search-field">
          <Search size={18} />
          <input
            aria-label={t('search')}
            placeholder={t('search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              className="search-clear"
              aria-label={t('clearSearch')}
              onClick={() => setSearch('')}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </StickySearch>
      <div className="chip-row" role="toolbar" aria-label={t('scope')}>
        <label className={`chip scope-chip ${tag ? 'set' : ''}`}>
          <span>{t('scopeShort')}：</span>
          <select aria-label={t('scope')} value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">{t('all')}</option>
            {tags.map((tag) => (
              <option key={tag} value={tag}>
                {tagLabel(tag, mode)}
              </option>
            ))}
          </select>
          <ChevronDown size={16} />
        </label>
        {FILTERS.map((f) => (
          <button
            className={`chip ${filter === f ? 'on' : ''}`}
            aria-pressed={filter === f}
            key={f}
            onClick={() => {
              setFilter(f);
              setSelected(new Set());
            }}
          >
            {t(filterLabel[f])}
          </button>
        ))}
      </div>
      {tag && !selecting && (
        <div className="scope-study">
          <p>
            <strong>{en ? `Only ${tagLabel(tag, mode)}` : `只学${tagLabel(tag, mode)}`}</strong>
            {en
              ? `${dueCount(scoped)} due today; new words up to the daily limit`
              : `今天到期 ${dueCount(scoped)} 个，新词按每日上限补充`}
          </p>
          <button className="primary-button" onClick={() => onStudy(tag)}>
            {t('studyScope')}
            <ArrowRight size={16} />
          </button>
        </div>
      )}
      <div className={`word-list library-list ${selecting ? 'selecting' : ''}`}>
        {entries.slice(0, visibleCount).map((e) => {
          const status = entryTag(progress.get(e.id)!),
            isSelected = selected.has(e.id);
          const row = (
            <button
              className="library-row"
              data-testid="library-row"
              aria-pressed={selecting ? isSelected : undefined}
              onClick={() => {
                if (!selecting) return open({ type: 'detail', id: e.id });
                setSelected((previous) => {
                  const next = new Set(previous);
                  if (next.has(e.id)) next.delete(e.id);
                  else next.add(e.id);
                  return next;
                });
              }}
            >
              {selecting && (
                <span className={`select-mark ${isSelected ? 'on' : ''}`} aria-hidden>
                  {isSelected && <Check size={16} />}
                </span>
              )}
              <span className="row-word" lang="fr">
                {e.word}
                <small>{e.groups.map((g) => posLabel(g.pos, mode)).join(' / ')}</small>
              </span>
              <span className={`status-tag ${status}`}>{t(statusLabel[status])}</span>
              <span className="row-meaning">{shortDefinition(e, locale) || t('missing')}</span>
            </button>
          );
          const actions = [
            {
              label: t(e.favorite ? 'unfavorite' : 'favorites'),
              icon: e.favorite ? <StarOff size={20} /> : <Star size={20} />,
              run: () => void flag([e.id], 'favorite', !e.favorite),
            },
            {
              label: t(e.suspended ? 'unpause' : 'pause'),
              icon: e.suspended ? <Play size={20} /> : <Pause size={20} />,
              run: () => void flag([e.id], 'suspended', !e.suspended),
            },
            {
              label: t(e.archived ? 'unarchive' : 'archive'),
              icon: e.archived ? <ArchiveRestore size={20} /> : <Archive size={20} />,
              run: () => void flag([e.id], 'archived', !e.archived),
            },
          ];
          return selecting ? (
            <div className="library-item" key={e.id}>
              {row}
            </div>
          ) : (
            <div className="library-item" key={e.id}>
              <SwipeRow
                open={openRow === e.id}
                onOpenChange={(o) => setOpenRow(o ? e.id : null)}
                actions={actions}
              >
                {row}
                {/* With a mouse, the same actions show on hover instead of a swipe. */}
                <span className="row-tools" role="group" aria-label={t('rowActions')}>
                  {actions.map((a) => (
                    <button
                      key={a.label}
                      className="icon-button"
                      title={a.label}
                      aria-label={`${a.label}: ${e.word}`}
                      disabled={busy}
                      onClick={a.run}
                    >
                      {a.icon}
                    </button>
                  ))}
                </span>
              </SwipeRow>
            </div>
          );
        })}
      </div>
      {!entries.length && <Empty title={t('noEntries')} />}
      {entries.length > visibleCount && (
        <AutoLoad
          onLoad={() => setVisibleCount((n) => n + 100)}
          label={`${t('showMore')} (${visibleCount}/${entries.length})`}
        />
      )}
      {/* In a portal: the page's entry animation would make "fixed" relative to the page. */}
      {selecting &&
        createPortal(
          <div className="select-bar" role="toolbar" aria-label={t('select')}>
            <span>{en ? `${selected.size} selected` : `已选 ${selected.size} 个`}</span>
            <button
              disabled={busy || !selected.size}
              onClick={async () => {
                if (await flag(selected, 'suspended', true)) finishSelecting();
              }}
            >
              <Pause size={17} />
              {t('pause')}
            </button>
            <button
              disabled={busy || !selected.size}
              onClick={async () => {
                if (await flag(selected, 'archived', filter !== 'archived')) finishSelecting();
              }}
            >
              {filter === 'archived' ? <ArchiveRestore size={17} /> : <Archive size={17} />}
              {t(filter === 'archived' ? 'unarchive' : 'archive')}
            </button>
            <button
              onClick={() =>
                setSelected(allSelected ? new Set() : new Set(entries.map((e) => e.id)))
              }
            >
              {t(allSelected ? 'selectNone' : 'selectAll')}
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}

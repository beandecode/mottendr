import { useMemo } from 'react';
import { ArrowRight, CircleHelp, Leaf } from 'lucide-react';
import type { AppState, Direction } from '../domain/types';
import { localeFor } from '../domain/types';
import { CURRENT_COLLECTION } from '../domain/builtin';
import { buildQueue, dayKey, ensureTasks, newRemainingToday, stats } from '../domain/learning';
import { hasExplanation } from '../domain/lexicon';
import { inScope, isTopTier, scopeOptions } from '../domain/collections';
import { tagLabel, translator } from '../i18n';
import type { Mutate } from '../app/types';
import { RollingNumber } from '../app/ui';
import { isDemo } from '../app/demo';
import { addSampleProgress } from '../domain/sample-progress';

export default function Today({
  state,
  mutate,
  busy,
  now,
  scope,
  setScope,
  dueCount,
  start,
  resume,
  openSettings,
  openDictionary,
  openLibrary,
}: {
  state: AppState;
  mutate: Mutate;
  busy: boolean;
  now: number;
  scope: string;
  setScope: (scope: string) => void;
  dueCount: number;
  start: (direction: Direction) => void;
  resume: () => void;
  openSettings: () => void;
  openDictionary: () => void;
  openLibrary: () => void;
}) {
  const mode = state.prefs.mode,
    t = translator(mode),
    locale = localeFor(mode),
    today = dayKey(now);
  // stats only depends on the calendar day of its time argument.
  const todayStats = useMemo(() => stats(state, now, scope), [state, today, scope]);
  const queueLength = useMemo(
    () => buildQueue(state, state.prefs.direction, now, scope).length,
    [state, now, scope],
  );
  const newLeft = useMemo(() => newRemainingToday(state, now), [state, today]);
  const tags = useMemo(() => scopeOptions(state.entries), [state.entries]);
  const hasActiveEntries = useMemo(
    () =>
      state.entries.some(
        (e) => !e.archived && !e.suspended && inScope(e, scope) && hasExplanation(e, locale),
      ),
    [state.entries, scope, locale],
  );
  const offModeDue = useMemo(() => {
    const active = new Set(
      state.entries.filter((e) => !e.archived && !e.suspended).map((e) => e.id),
    );
    return state.tasks.filter(
      (task) =>
        task.direction === 'production' &&
        task.promptLanguage !== locale &&
        task.learnedAt &&
        task.card.due <= now &&
        active.has(task.entryId),
    ).length;
  }, [state.tasks, state.entries, locale, now]);
  const localDate = new Intl.DateTimeFormat(mode === 'enOnly' ? 'en-US' : 'zh-CN', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(now);
  const missingEnglish = mode === 'enOnly' && (scope === CURRENT_COLLECTION || isTopTier(scope));
  // The big number is what Start does first: due reviews come before new words.
  const sessionLeft = state.session ? state.session.queue.length + state.session.pending.length : 0;
  const figure = state.session
    ? { value: sessionLeft, label: t('remaining') }
    : dueCount > 0
      ? { value: dueCount, label: t('heroDue'), sub: `${t('newLeft')} ${newLeft}` }
      : queueLength > 0 && newLeft > 0
        ? { value: newLeft, label: t('dailyNewProgress') }
        : queueLength > 0
          ? { value: queueLength, label: t('heroReady') }
          : null;
  return (
    <>
      <div className="page-heading today-heading">
        <p className="eyebrow">{localDate}</p>
        <h1>{t('today')}</h1>
        <p className="today-slogan">{t('greeting')}</p>
      </div>
      <section className="study-hero today-hero">
        <div className="hero-top">
          <p className="eyebrow">LA PETITE PRATIQUE</p>
          <Leaf size={20} />
        </div>
        {figure ? (
          <div className="hero-figure" data-testid="hero-figure">
            <strong>
              <RollingNumber id="today-hero" value={figure.value} />
            </strong>
            <span>{figure.label}</span>
          </div>
        ) : (
          <div className="hero-figure hero-done" data-testid="hero-figure">
            <strong>{t('allDone')}</strong>
            <span>{t('allDoneHint')}</span>
          </div>
        )}
        {figure?.sub && <p className="hero-sub">{figure.sub}</p>}
        <div className="hero-controls">
          <div className="segmented">
            {(['recognition', 'production'] as Direction[]).map((d) => (
              <button
                key={d}
                className={state.prefs.direction === d ? 'selected' : ''}
                disabled={busy}
                onClick={() =>
                  mutate((s) => {
                    s.prefs.direction = d;
                    ensureTasks(s, d);
                  })
                }
              >
                {t(d === 'recognition' ? 'meaning' : 'output')}
              </button>
            ))}
          </div>
          <label className="scope-label">
            {t('scope')}
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="">{t('all')}</option>
              {tags.map((tag) => (
                <option key={tag} value={tag}>
                  {tagLabel(tag, mode)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {state.session || queueLength ? (
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => (state.session ? resume() : start(state.prefs.direction))}
          >
            {t(state.session ? 'resume' : 'start')}
            <ArrowRight size={18} />
          </button>
        ) : (
          <button className="secondary-button" onClick={openLibrary}>
            {t('browse')}
            <ArrowRight size={18} />
          </button>
        )}
      </section>
      <div className="today-chips" aria-label={t('today')}>
        <span>
          <strong>{todayStats.reviews}</strong> {t('reviews')}
        </span>
        <span>
          <strong>{Math.round(todayStats.seconds / 60)}</strong> {t('minutes')}
        </span>
        <span>
          <strong>{todayStats.introductions}</strong> {t('new')}
        </span>
      </div>
      {isDemo && (
        <div className="info-note demo-note" data-testid="demo-note">
          <CircleHelp size={17} />
          <span>
            <strong>{t('demoTitle')}</strong> {t('demoBody')}
          </span>
          {!state.events.length && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() => mutate((s) => addSampleProgress(s, Date.now()))}
            >
              {t('demoSample')}
            </button>
          )}
        </div>
      )}
      {!hasActiveEntries && (
        <div className="info-note">
          <CircleHelp size={17} />
          {t(missingEnglish ? 'collectionMissingEnglish' : 'noStudyEntries')}
          <button
            className="text-button"
            onClick={() => (missingEnglish ? openSettings() : openDictionary())}
          >
            {t(missingEnglish ? 'settings' : 'add')}
          </button>
        </div>
      )}
      {!!state.contentReview?.length && (
        <div className="info-note" data-testid="content-review-note">
          <CircleHelp size={17} />
          {state.contentReview.length} {t('contentReviewPending')}
          <button className="text-button" onClick={openSettings}>
            {t('settings')}
          </button>
        </div>
      )}
      {offModeDue > 0 && (
        <div className="info-note">
          <CircleHelp size={17} />
          {t('offMode')}: {offModeDue}
        </div>
      )}
    </>
  );
}

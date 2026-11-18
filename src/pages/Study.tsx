import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { RotateCcw, X } from 'lucide-react';
import type { AppState } from '../domain/types';
import {
  dayKey,
  promotePending,
  sessionNeedsRefresh,
  skipTask,
  stats,
  undoLast,
} from '../domain/learning';
import { continuousOptions } from '../domain/study-preferences';
import StudyCard from '../components/StudyCard';
import { cardControls, useTouchInput } from '../platform/input';
import { translator } from '../i18n';
import type { Mutate } from '../app/types';
import { useNow } from '../app/useNow';
import { Empty } from '../app/ui';

// How long the width must stay unchanged before the blur lifts.
const RELAYOUT_SETTLE_MS = 150;
type Translate = ReturnType<typeof translator>;
function formatInterval(t: Translate, due: number, from: number) {
  const s = Math.max(0, Math.round((due - from) / 1000));
  if (s < 5) return t('ready');
  if (s < 60) return `${s} ${t('sec')}`;
  if (s < 3600) return `${Math.ceil(s / 60)} ${t('min')}`;
  if (s < 86400) return `${Math.round(s / 3600)} ${t('hr')}`;
  return `${Math.round(s / 86400)} ${t('days')}`;
}

export default function Study(props: {
  state: AppState;
  mutate: Mutate;
  busy: boolean;
  onDetail: (id: string) => void;
  onIssue: (entryId: string, senseId?: string) => void;
  speak: (s: string) => void;
  autoSpeak: (s: string) => void;
  blocked: boolean;
  speechReady: boolean;
  speaking: boolean;
  finish: () => void;
}) {
  const { state, mutate, busy, finish } = props,
    t = translator(state.prefs.mode),
    session = state.session!;
  const now = useNow(1000),
    interval = (due: number, from = now) => formatInterval(t, due, from);
  const task = state.tasks.find((t) => t.id === session.queue[0]),
    entry = state.entries.find((e) => e.id === task?.entryId);
  const canUndo = useMemo(
    () => state.events.some((e) => !e.voidedAt && e.sessionBefore.id === session.id),
    [state.events, session.id],
  );
  useEffect(() => {
    if (!busy && !props.blocked && sessionNeedsRefresh(state, now))
      void mutate((d) => promotePending(d, Date.now()));
  }, [now, state.revision, busy, props.blocked]);
  const continuation = continuousOptions(state.prefs),
    today = dayKey(now);
  // stats only depends on the calendar day of its time argument.
  const dailyIntroductions = useMemo(() => stats(state, now).introductions, [state, today]);
  const touch = useTouchInput(),
    controls = cardControls(state.prefs, touch);
  const nextDue = session.pending.length
    ? Math.min(...session.pending.map((id) => state.tasks.find((t) => t.id === id)!.card.due))
    : null;
  const remaining = session.queue.length + session.pending.length,
    total = session.completed + remaining;
  // When the window width changes (rotation, resizing), blur the page under a green veil until the
  // width has settled, so the card and its headword re-lay out unseen (StudyCard redraws the
  // letters). Height-only changes, such as browser bars, do not reflow the word.
  const [relayout, setRelayout] = useState(false);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let width = window.innerWidth,
      settle = 0;
    const resized = () => {
      if (window.innerWidth === width) return;
      width = window.innerWidth;
      setRelayout(true);
      window.clearTimeout(settle);
      settle = window.setTimeout(() => setRelayout(false), RELAYOUT_SETTLE_MS);
    };
    window.addEventListener('resize', resized);
    return () => {
      window.removeEventListener('resize', resized);
      window.clearTimeout(settle);
    };
  }, []);
  return (
    <>
      {createPortal(
        <div className="relayout-veil" data-active={relayout || undefined} aria-hidden="true" />,
        document.body,
      )}
      <div className="study-page" data-relayout={relayout || undefined}>
        <div className="study-header">
          <div className="study-toolbar">
            <button className="text-button study-finish" disabled={busy} onClick={finish}>
              <X size={17} />
              {t('finish')}
            </button>
            <div
              className="study-progress"
              role="progressbar"
              aria-label={`${session.completed} ${t('learnedCount')} · ${remaining} ${t('remaining')}`}
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={session.completed}
            >
              <span className="study-progress-track">
                <span style={{ width: `${total ? (session.completed / total) * 100 : 0}%` }} />
              </span>
              <span
                className="study-progress-count"
                title={`${session.completed} ${t('learnedCount')} · ${remaining} ${t('remaining')}`}
              >
                {session.completed} / {total}
              </span>
            </div>
            <button
              className="text-button"
              disabled={busy || !canUndo}
              onClick={() => mutate((d) => undoLast(d, Date.now()))}
            >
              <RotateCcw size={15} />
              {t('undo')}
            </button>
            {!controls.buttons && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() => mutate((d) => skipTask(d))}
              >
                {t('skip')}
              </button>
            )}
          </div>
          {task && (
            <p className="study-meta" data-testid="continuous-status">
              <span className="tiny-dot" />
              {t(task.learnedAt ? 'reviewPhase' : 'first')} ·{' '}
              {t(task.direction === 'recognition' ? 'recognition' : 'production')}
              {continuation.enabled &&
                ` · ${t('dailyNewProgress')} ${dailyIntroductions}/${state.prefs.newLimit}`}
            </p>
          )}
        </div>
        {task && entry ? (
          <StudyCard
            key={`${task.id}:${task.card.reps}:${task.learnedAt ?? 0}`}
            task={task}
            entry={entry}
            {...props}
            now={now}
            interval={interval}
          />
        ) : (
          <Empty title={t(nextDue ? 'waiting' : session.completed ? 'sessionDone' : 'emptyQueue')}>
            <p>
              {t(
                continuation.enabled
                  ? 'continuousWaitingHint'
                  : nextDue
                    ? 'waitingHint'
                    : 'tagline',
              )}
            </p>
            {nextDue && <div className="waiting-countdown">{interval(nextDue)}</div>}
            <div className="button-row">
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => mutate((d) => promotePending(d, Date.now()))}
              >
                {t('refresh')}
              </button>
              <button className="primary-button" disabled={busy} onClick={finish}>
                {t('back')}
              </button>
            </div>
          </Empty>
        )}
      </div>
    </>
  );
}

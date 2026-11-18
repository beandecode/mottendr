import { useState } from 'react';
import { Archive, Flag, Pause, Pencil, Play } from 'lucide-react';
import type { AppState, Entry } from '../domain/types';
import { localeFor } from '../domain/types';
import { ContentInfo, LexiconDetails } from '../components/Lexicon';
import { dayKey, entryProgress, entryTag, entryTask, setEntryFlag } from '../domain/learning';
import { notStudiedByDefault } from '../domain/pack';
import { recall } from '../scheduler';
import { translator, type Label } from '../i18n';
import type { Mutate } from '../app/types';
import { MoreMenu } from '../app/ui';
import IssueList from './IssueList';
import EditHistory from './EditHistory';
import ContentOrigin from './ContentOrigin';

const DAY = 86_400_000;

export default function EntryDetail({
  entry,
  state,
  mutate,
  busy,
  speak,
  openLinked,
  openEdit,
}: {
  entry: Entry;
  state: AppState;
  mutate: Mutate;
  busy: boolean;
  speak: (s: string) => void;
  openLinked: (id: string) => void;
  openEdit: (entryId: string, issueId?: string, senseId?: string) => void;
}) {
  const mode = state.prefs.mode,
    locale = localeFor(mode),
    t = translator(mode);
  const [note, setNote] = useState(entry.localizedNotes[locale] ?? ''),
    [touched, setTouched] = useState(false);
  return (
    <>
      <LexiconDetails
        entry={entry}
        state={state}
        speak={speak}
        openLinked={openLinked}
        afterHero={<StatusCard entry={entry} state={state} />}
      />
      <label className="note-field">
        {t('note')}
        <textarea
          rows={3}
          placeholder={t('noNote')}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setTouched(true);
          }}
        />
      </label>
      {touched && (
        <button
          className="secondary-button"
          disabled={busy}
          onClick={async () => {
            if (
              await mutate((d) => {
                const e = d.entries.find((e) => e.id === entry.id)!;
                e.localizedNotes = { ...e.localizedNotes, [locale]: note };
              })
            )
              setTouched(false);
          }}
        >
          {t('save')}
        </button>
      )}
      <IssueList state={state} mutate={mutate} busy={busy} entryId={entry.id} openEdit={openEdit} />
      <EditHistory state={state} entry={entry} mutate={mutate} busy={busy} />
      <ContentInfo entry={entry} state={state} />
      <ContentOrigin state={state} entry={entry} />
    </>
  );
}

// The entry's actions, in the details sheet's "…" menu.
export function EntryMenu({
  entry,
  state,
  mutate,
  edit,
  report,
}: {
  entry: Entry;
  state: AppState;
  mutate: Mutate;
  edit: () => void;
  report: () => void;
}) {
  const t = translator(state.prefs.mode);
  const setFlag = (flag: 'suspended' | 'archived') =>
    mutate((d) => setEntryFlag(d, [entry.id], flag, !entry[flag]));
  return (
    <MoreMenu
      label={t('entryMenu')}
      items={[
        { label: t('edit'), icon: <Pencil size={16} />, run: edit },
        {
          label: t(entry.suspended ? 'unpause' : 'pause'),
          icon: entry.suspended ? <Play size={16} /> : <Pause size={16} />,
          run: () => void setFlag('suspended'),
        },
        {
          label: t(entry.archived ? 'unarchive' : 'archive'),
          icon: <Archive size={16} />,
          run: () => void setFlag('archived'),
        },
        { label: t('reportIssue'), icon: <Flag size={16} />, danger: true, run: report },
      ]}
    />
  );
}

const statusLabel: Record<ReturnType<typeof entryTag>, Label> = {
  new: 'statusNew',
  seen: 'statusSeen',
  learning: 'statusLearning',
  due: 'statusDue',
  mature: 'statusMature',
  paused: 'statusPaused',
  archived: 'archived',
};

// When the entry comes back and how likely it is remembered now, with its forgetting curve.
function StatusCard({ entry, state }: { entry: Entry; state: AppState }) {
  const mode = state.prefs.mode,
    t = translator(mode),
    now = Date.now(),
    progress = entryProgress(state, entry, now),
    status = entryTag(progress),
    task = entryTask(state, entry.id),
    grammarWord = !entry.archived && notStudiedByDefault(entry.id);
  if (progress.paused || progress.archived || !task?.learnedAt)
    return (
      <section className="status-card plain" data-testid="entry-status">
        <strong>
          {t(
            !progress.paused && !progress.archived
              ? 'notLearned'
              : entry.archived
                ? 'archived'
                : grammarWord
                  ? 'notStudiedDefault'
                  : 'statusPaused',
          )}
        </strong>
        <p>
          {t(
            !progress.paused && !progress.archived
              ? 'notLearnedHint'
              : grammarWord
                ? 'notStudiedHint'
                : 'pausedHint',
          )}
        </p>
      </section>
    );
  const due = task.card.due,
    days = Math.round((new Date(dayKey(due)).getTime() - new Date(dayKey(now)).getTime()) / DAY),
    when =
      due <= now
        ? t('dueNow')
        : days <= 0
          ? t('laterToday')
          : days === 1
            ? t('tomorrow')
            : mode === 'enOnly'
              ? `In ${days} days`
              : `${days} 天后`,
    date = new Intl.DateTimeFormat(mode === 'enOnly' ? 'en' : 'zh-CN', {
      month: 'short',
      day: 'numeric',
    }).format(due);
  const chance = recall(task.card, now, state.prefs.retention);
  // A word seen once but never reviewed has no memory estimate yet.
  return (
    <section
      className={`status-card ${chance === null ? 'single' : ''}`}
      data-testid="entry-status"
    >
      <div>
        <span className="label">{t('nextReview')}</span>
        <strong>
          {when}
          <small>{date}</small>
        </strong>
        {chance === null ? (
          <span className="label">{t(statusLabel[status])}</span>
        ) : (
          <>
            <span className="label">{t('recallChance')}</span>
            <strong>
              {`${Math.round(chance * 100)}%`}
              <small>{t(statusLabel[status])}</small>
            </strong>
          </>
        )}
      </div>
      {chance !== null && <Curve state={state} entry={entry} now={now} />}
      {chance !== null && <p className="status-note">{t('model')}</p>}
    </section>
  );
}

// The forgetting curve from the last review to twice the memory's stability, with "now" marked.
function Curve({ state, entry, now }: { state: AppState; entry: Entry; now: number }) {
  const task = entryTask(state, entry.id)!,
    t = translator(state.prefs.mode),
    last = task.card.last_review;
  if (!last) return null;
  const horizon = Math.max(2, task.card.stability * 2) * DAY,
    end = Math.max(last + horizon, now + DAY),
    x = (at: number) => 4 + ((at - last) / (end - last)) * 112,
    y = (at: number) => 6 + (1 - (recall(task.card, at, state.prefs.retention) ?? 1)) * 56;
  const points = Array.from({ length: 33 }, (_, i) => last + ((end - last) * i) / 32);
  const line = points.map((at) => `${x(at).toFixed(1)},${y(at).toFixed(1)}`).join(' ');
  return (
    <svg className="status-curve" viewBox="0 0 120 70" role="img" aria-label={t('curve')}>
      <line x1="4" y1="64" x2="116" y2="64" />
      <polygon points={`4,64 ${line} 116,64`} />
      <polyline points={line} />
      <circle cx={x(Math.min(now, end))} cy={y(Math.min(now, end))} r="4.5" />
    </svg>
  );
}

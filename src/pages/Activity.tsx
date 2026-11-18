import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { AppState } from '../domain/types';
import {
  addDays,
  dailyCounts,
  dayKey,
  dueForecast,
  progressBreakdown,
  streak,
  weekStart,
  weekStats,
} from '../domain/learning';
import { translator } from '../i18n';
import type { Modal } from '../app/types';
import { AutoLoad, RollingNumber } from '../app/ui';

const WEEKS = 16;
const level = (n: number) => (n === 0 ? '' : n < 15 ? 'l1' : n < 35 ? 'l2' : 'l3');

// The record of practice: the current streak and this week, progress through the library, this
// week against last, sixteen weeks of days, what comes due next, and recent answers by day.
export default function Activity({
  state,
  now,
  open,
}: {
  state: AppState;
  now: number;
  open: (m: Modal) => void;
}) {
  const mode = state.prefs.mode,
    en = mode === 'enOnly',
    t = translator(mode),
    todayKey = dayKey(now);
  const days = useMemo(() => dailyCounts(state), [state.events]);
  const run = useMemo(() => streak(state, now), [state.events, todayKey]);
  const progress = useMemo(() => progressBreakdown(state, now), [state.tasks, state.entries, now]);
  const [thisWeek, lastWeek] = useMemo(
    () => [weekStats(state, now), weekStats(state, now, 1)],
    [state.events, todayKey],
  );
  const monday = weekStart(now);
  const weekdays = en
    ? ['M', 'T', 'W', 'T', 'F', 'S', 'S']
    : ['一', '二', '三', '四', '五', '六', '日'];
  const short = new Intl.DateTimeFormat(en ? 'en' : 'zh-CN', { month: 'short', day: 'numeric' });
  const month = new Intl.DateTimeFormat(en ? 'en' : 'zh-CN', { month: 'short' }),
    clock = new Intl.DateTimeFormat(en ? 'en' : 'zh-CN', { hour: '2-digit', minute: '2-digit' });

  // Sixteen weeks, Monday to Sunday down each column, ending with this week.
  const first = addDays(monday, -7 * (WEEKS - 1));
  const columns = Array.from({ length: WEEKS }, (_, c) => {
    const cells = Array.from({ length: 7 }, (_, r) => addDays(first, c * 7 + r));
    const monthStart = cells.find((d) => new Date(d).getDate() === 1);
    return {
      cells,
      // A month is named in the column holding its 1st; the first column always names one.
      label: monthStart ? month.format(monthStart) : c === 0 ? month.format(first) : '',
    };
  });
  const [picked, setPicked] = useState<number | null>(null);

  const future = useMemo(() => dueForecast(state, now), [state.tasks, state.entries, todayKey]);
  const most = Math.max(1, ...future.map((d) => d.count));

  const [shown, setShown] = useState(20);
  const recent = useMemo(() => [...state.events].reverse(), [state.events]);
  const groups = recent
    .slice(0, shown)
    .reduce<{ key: string; at: number; events: typeof recent }[]>((all, e) => {
      const key = dayKey(e.at),
        last = all.at(-1);
      if (last?.key === key) last.events.push(e);
      else all.push({ key, at: e.at, events: [e] });
      return all;
    }, []);
  const dayLabel = (at: number) =>
    dayKey(at) === todayKey
      ? t('todayWord')
      : dayKey(at) === dayKey(addDays(now, -1))
        ? t('yesterday')
        : short.format(at);
  const change = (current: number, previous: number) =>
    previous === 0 ? null : Math.round(((current - previous) / previous) * 100);
  const total = progress.mature + progress.learning + progress.seen + progress.new;

  return (
    <div className="activity">
      <div className="page-heading">
        <p className="eyebrow">PETIT À PETIT</p>
        <h1>{t('activity')}</h1>
        <p>{t('footprint')}</p>
      </div>

      <section className="activity-card streak-card" data-testid="streak">
        <div className="streak-top">
          <strong className="streak-number">
            <RollingNumber id="streak" value={run.current} />
            <small>{t('days')}</small>
          </strong>
          <p>
            {t('streakLabel')}
            <small>
              {run.current === 0
                ? t('streakStart')
                : en
                  ? `Longest: ${run.longest} days`
                  : `最长一次 ${run.longest} 天`}
            </small>
          </p>
        </div>
        <div className="week-dots">
          {weekdays.map((label, i) => {
            const day = addDays(monday, i),
              key = dayKey(day),
              isToday = key === todayKey;
            return (
              <span key={i} className={day > now && !isToday ? 'later' : ''}>
                <i className={`${days.has(key) ? 'done' : ''} ${isToday ? 'today' : ''}`} />
                {isToday ? <b>{t('todayWord')}</b> : label}
              </span>
            );
          })}
        </div>
      </section>

      <section className="activity-card">
        <h3>
          {t('progressTitle')}
          <small>
            {total.toLocaleString()} {t('words')}
          </small>
        </h3>
        <div
          className="progress-bar"
          role="img"
          aria-label={`${t('statusMature')} ${progress.mature}, ${t('statusLearning')} ${progress.learning}, ${t('statusSeen')} ${progress.seen}, ${t('statusNew')} ${progress.new}`}
        >
          <span className="mature" style={{ flexGrow: progress.mature }} />
          <span className="learning" style={{ flexGrow: progress.learning }} />
          <span className="seen" style={{ flexGrow: progress.seen }} />
          <span className="new" style={{ flexGrow: progress.new }} />
        </div>
        <div className="progress-legend">
          {(['mature', 'learning', 'seen', 'new'] as const).map((k) => (
            <div key={k}>
              <i className={k} />
              {t(
                k === 'mature'
                  ? 'statusMature'
                  : k === 'learning'
                    ? 'statusLearning'
                    : k === 'seen'
                      ? 'statusSeen'
                      : 'statusNew',
              )}
              <b>{progress[k].toLocaleString()}</b>
            </div>
          ))}
        </div>
        <p className="card-note">
          {en
            ? `Mature: remembered for 21 days or more. Seen: read once, not rated yet. ${progress.due} due now. Not counted: ${progress.paused} paused, ${progress.archived} archived.`
            : `熟练：记忆能保持 21 天以上；已读：读过一次、还没评过分。现在到期 ${progress.due} 词。不计：已暂停 ${progress.paused}、已归档 ${progress.archived}。`}
        </p>
      </section>

      <section className="activity-card">
        <h3>
          {t('thisWeek')}
          <small>{t('vsLastWeek')}</small>
        </h3>
        <div className="week-compare">
          {[
            {
              label: t('reviews'),
              value: thisWeek.reviews.toLocaleString(),
              delta: change(thisWeek.reviews, lastWeek.reviews),
              unit: '%',
            },
            {
              label: t('recallRate'),
              value: thisWeek.success === null ? '—' : `${Math.round(thisWeek.success * 100)}%`,
              delta:
                thisWeek.success === null || lastWeek.success === null
                  ? null
                  : Math.round((thisWeek.success - lastWeek.success) * 100),
              unit: en ? ' pts' : ' 点',
            },
            {
              label: t('minutes'),
              value: Math.round(thisWeek.seconds / 60).toLocaleString(),
              delta: change(thisWeek.seconds, lastWeek.seconds),
              unit: '%',
            },
          ].map((m) => (
            <div key={m.label}>
              {m.label}
              <b>{m.value}</b>
              {m.delta === null ? (
                <span className="flat">{t('noLastWeek')}</span>
              ) : (
                <span className={m.delta >= 0 ? 'up' : 'down'}>
                  {m.delta >= 0 ? '↑' : '↓'} {Math.abs(m.delta)}
                  {m.unit}
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="activity-card">
        <h3>
          {t('heatTitle')}
          <small>{t('heatHint')}</small>
        </h3>
        <div
          className="heatmap"
          style={{ gridTemplateColumns: `20px repeat(${WEEKS}, minmax(0, 1fr))` }}
        >
          <span />
          {columns.map((c, i) => (
            <span className="heat-month" key={i}>
              {c.label}
            </span>
          ))}
          {weekdays.map((label, r) => (
            <div className="heat-row" key={r} style={{ display: 'contents' }}>
              <span className="heat-weekday">{r % 2 === 0 ? label : ''}</span>
              {columns.map((c) => {
                const day = c.cells[r],
                  key = dayKey(day),
                  n = days.get(key) ?? 0;
                if (day > now && key !== todayKey)
                  return <span className="heat-cell later" key={key} />;
                return (
                  <button
                    key={key}
                    className={`heat-cell ${level(n)} ${key === todayKey ? 'today' : ''} ${picked === day ? 'picked' : ''}`}
                    aria-label={`${short.format(day)} · ${n}`}
                    onClick={() => setPicked(picked === day ? null : day)}
                  />
                );
              })}
            </div>
          ))}
        </div>
        <div className="heat-foot">
          <span>
            {picked === null
              ? t('heatPick')
              : `${short.format(picked)} · ${
                  days.get(dayKey(picked))
                    ? en
                      ? `${days.get(dayKey(picked))} answers`
                      : `${days.get(dayKey(picked))} 次`
                    : t('noPractice')
                }`}
          </span>
          <span className="heat-scale" aria-hidden>
            {t('less')}
            <i />
            <i className="l1" />
            <i className="l2" />
            <i className="l3" />
            {t('more')}
          </span>
        </div>
      </section>

      <section className="activity-card">
        <h3>
          {t('forecastTitle')}
          <small>{t('forecastShort')}</small>
        </h3>
        <div className="forecast">
          {future.map((d, i) => (
            <div key={d.at}>
              <div className="forecast-track">
                <span
                  className={`${i === 0 ? 'today' : ''} ${d.count === 0 ? 'zero' : ''}`}
                  style={
                    d.count ? { height: `${Math.max(6, (d.count / most) * 80)}px` } : undefined
                  }
                />
              </div>
              <strong>{d.count}</strong>
              <small>{i === 0 ? t('todayWord') : new Date(d.at).getDate()}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="activity-card">
        <h3>{t('history')}</h3>
        {groups.length ? (
          groups.map((g) => (
            <div key={g.key}>
              <p className="history-day">{dayLabel(g.at)}</p>
              {g.events.map((event) => {
                const entry = state.entries.find((e) => e.id === event.entryId);
                return (
                  <button
                    className={`history-row ${event.voidedAt ? 'voided' : ''}`}
                    key={event.id}
                    disabled={!entry}
                    onClick={() => entry && open({ type: 'detail', id: entry.id })}
                  >
                    <i
                      className={`history-dot grade-${event.kind === 'exposure' ? 0 : event.rating}`}
                    />
                    <strong lang="fr">{entry?.word ?? '—'}</strong>
                    <span>
                      {t(
                        event.voidedAt
                          ? 'voided'
                          : event.kind === 'exposure'
                            ? 'exposure'
                            : (['again', 'hard', 'good', 'easy'] as const)[event.rating! - 1],
                      )}{' '}
                      · <time>{clock.format(event.at)}</time>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                );
              })}
            </div>
          ))
        ) : (
          <p className="card-note">{t('noReviews')}</p>
        )}
        {recent.length > shown && (
          <AutoLoad
            onLoad={() => setShown((n) => n + 30)}
            label={`${t('showMore')} (${shown}/${recent.length})`}
          />
        )}
      </section>
    </div>
  );
}

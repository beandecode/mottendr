import { useState } from 'react';
import type { AppState, Entry } from '../domain/types';
import { localeFor } from '../domain/types';
import { ISSUE_KINDS, type Issue } from '../domain/user-layer';
import { addIssue } from '../domain/issues';
import { packEntries } from '../domain/pack';
import { posLabel, translator } from '../i18n';
import type { Mutate } from '../app/types';

// Opened from a study card or an entry's details. Saving never affects the review schedule.
export default function IssueForm({
  state,
  entry,
  senseId,
  mutate,
  busy,
  done,
  fixNow,
}: {
  state: AppState;
  entry: Entry;
  senseId?: string;
  mutate: Mutate;
  busy: boolean;
  done: () => void;
  fixNow: (issueId: string, senseId?: string) => void;
}) {
  const mode = state.prefs.mode,
    t = translator(mode),
    locale = localeFor(mode);
  const [kind, setKind] = useState<Issue['kind']>('meaning'),
    [sense, setSense] = useState(senseId ?? ''),
    [note, setNote] = useState(''),
    [context, setContext] = useState('');
  const senses = entry.groups.flatMap((g) =>
    g.senses.map((s) => ({
      id: s.id,
      label: `${posLabel(g.pos, mode)} · ${s.definitions[locale].short || s.definitions.zh.short}`,
    })),
  );
  async function submit(now: boolean) {
    let id = '';
    const ok = await mutate((d) => {
      id = addIssue(
        d,
        { entryId: entry.id, senseId: sense || undefined, kind, note, context },
        packEntries(),
      );
    });
    if (!ok) return;
    if (now) fixNow(id, sense || undefined);
    else done();
  }
  return (
    <div className="issue-form" data-testid="issue-form">
      <label>
        {t('issueKind')}
        <select value={kind} onChange={(e) => setKind(e.target.value as Issue['kind'])}>
          {ISSUE_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`issue_${k}`)}
            </option>
          ))}
        </select>
      </label>
      {senses.length > 1 && (
        <label>
          {t('issueSense')}
          <select value={sense} onChange={(e) => setSense(e.target.value)}>
            <option value="">{t('issueWholeEntry')}</option>
            {senses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        {t('issueNote')}
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <label>
        {t('issueContext')}
        <textarea rows={2} lang="fr" value={context} onChange={(e) => setContext(e.target.value)} />
      </label>
      <div className="button-row">
        <button className="secondary-button" disabled={busy} onClick={() => void submit(false)}>
          {t('issueLater')}
        </button>
        <button className="primary-button" disabled={busy} onClick={() => void submit(true)}>
          {t('issueFixNow')}
        </button>
      </div>
    </div>
  );
}

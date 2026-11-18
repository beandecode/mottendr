import type { AppState } from '../domain/types';
import { closeIssue, maybeFixed, openIssues } from '../domain/issues';
import { packEntries } from '../domain/pack';
import { translator } from '../i18n';
import type { Mutate } from '../app/types';

// Open problems, either all of them (Settings) or those of one entry (details).
export default function IssueList({
  state,
  mutate,
  busy,
  entryId,
  openEdit,
}: {
  state: AppState;
  mutate: Mutate;
  busy: boolean;
  entryId?: string;
  openEdit: (entryId: string, issueId: string, senseId?: string) => void;
}) {
  const mode = state.prefs.mode,
    t = translator(mode);
  const issues = openIssues(state, entryId);
  if (!issues.length) return null;
  const words = new Map(state.entries.map((e) => [e.id, e.word]));
  const date = new Intl.DateTimeFormat(mode === 'enOnly' ? 'en-US' : 'zh-CN', {
    month: 'short',
    day: 'numeric',
  });
  return (
    <div className="issue-list" data-testid="issue-list">
      {issues.map((issue) => (
        <div className="review-item" key={issue.id}>
          <p>
            {!entryId && <strong>{words.get(issue.entryId)} </strong>}
            <span className="badge amber">{t(`issue_${issue.kind}`)}</span>{' '}
            <span className="muted">{date.format(issue.createdAt)}</span>
          </p>
          {issue.note && <p>{issue.note}</p>}
          {issue.context && (
            <p className="muted" lang="fr">
              « {issue.context} »
            </p>
          )}
          {maybeFixed(issue, packEntries()) && <p className="muted">{t('issueMaybeFixed')}</p>}
          <div className="button-row">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => openEdit(issue.entryId, issue.id, issue.senseId)}
            >
              {t('edit')}
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => mutate((d) => closeIssue(d, issue.id, 'resolved'))}
            >
              {t('issueResolve')}
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => mutate((d) => closeIssue(d, issue.id, 'dismissed'))}
            >
              {t('issueDismiss')}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

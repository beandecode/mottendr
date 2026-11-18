import type { AppState, Entry } from '../domain/types';
import { entryLog, undoable, undoContentChange } from '../domain/content-log';
import { translator } from '../i18n';
import type { Mutate } from '../app/types';
import { describePath } from './describe';

// Content changes to one entry, newest first; the latest can be undone while still in place.
export default function EditHistory({
  state,
  entry,
  mutate,
  busy,
}: {
  state: AppState;
  entry: Entry;
  mutate: Mutate;
  busy: boolean;
}) {
  const mode = state.prefs.mode,
    t = translator(mode);
  const records = entryLog(state, entry.id).reverse().slice(0, 10);
  if (!records.length) return null;
  const latest = undoable(state, entry.id);
  const date = new Intl.DateTimeFormat(mode === 'enOnly' ? 'en-US' : 'zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <section className="edit-history" data-testid="edit-history">
      <h3>{t('editHistory')}</h3>
      {records.map((record) => {
        const fields = [
          ...new Set(record.changes.map((c) => describePath(c.path, entry, mode)).filter(Boolean)),
        ];
        return (
          <div className="review-item" key={record.id}>
            <p>
              <span className="badge">{t(record.kind === 'undo' ? 'logUndo' : 'logEdit')}</span>{' '}
              <span className="muted">{date.format(record.at)}</span>
              {record.undoneBy && <span className="muted"> · {t('logUndone')}</span>}
            </p>
            <p>
              {fields.slice(0, 3).join('；')}
              {fields.length > 3 ? ` …（${fields.length}）` : ''}
            </p>
            {record.id === latest?.id && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() => mutate((d) => undoContentChange(d, record.id))}
              >
                {t(record.kind === 'undo' ? 'redoEdit' : 'undoEdit')}
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}

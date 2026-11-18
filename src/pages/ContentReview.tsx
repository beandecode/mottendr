import { RefreshCw } from 'lucide-react';
import type { AppState } from '../domain/types';
import { resolveReview } from '../domain/user-data';
import { translator } from '../i18n';
import { describePath, show } from './describe';
import type { Mutate } from '../app/types';

export default function ContentReview({
  state,
  mutate,
  busy,
}: {
  state: AppState;
  mutate: Mutate;
  busy: boolean;
}) {
  const mode = state.prefs.mode,
    t = translator(mode);
  const items = state.contentReview ?? [];
  if (!items.length) return null;
  return (
    <section data-testid="content-review">
      <h3>
        <RefreshCw size={18} />
        {t('contentReview')}
      </h3>
      <p className="muted">{t('contentReviewHint')}</p>
      {items.map((item) => {
        const entry = state.entries.find((e) => e.id === item.entryId);
        return (
          <div className="review-item" key={item.id}>
            <p>
              <strong>{item.word}</strong>{' '}
              <span className="muted">{describePath(item.path, entry, mode)}</span>
            </p>
            {item.kind === 'retired' ? (
              <p>
                {t('reviewRetired')}{' '}
                {((item.pack as string[] | undefined) ?? [])
                  .map((id) => state.entries.find((e) => e.id === id)?.word ?? id)
                  .join('、') || t('noValue')}
              </p>
            ) : item.kind === 'changed' ? (
              <dl className="review-values">
                <dt>{t('reviewBase')}</dt>
                <dd>{show(item.base, t('noValue'))}</dd>
                <dt>{t('reviewPack')}</dt>
                <dd>{show(item.pack, t('noValue'))}</dd>
                <dt>{t('reviewMine')}</dt>
                <dd>{show(item.mine, t('noValue'))}</dd>
              </dl>
            ) : (
              <p>
                {t('reviewRemoved')} {show(item.mine, t('noValue'))}
              </p>
            )}
            <div className="button-row">
              {item.kind === 'changed' && (
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => mutate((d) => resolveReview(d, item.id, 'pack'))}
                >
                  {t('usePack')}
                </button>
              )}
              <button
                className="text-button"
                disabled={busy}
                onClick={() => mutate((d) => resolveReview(d, item.id, 'mine'))}
              >
                {t(item.kind === 'changed' ? 'keepMine' : 'noted')}
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}

import type { AppState } from '../domain/types';
import { needsLegacyUpgrade, replaceWithBackup } from '../domain/builtin';
import { loadContent } from '../content/files';
import { mergeBackup } from '../domain/import-export';
import { translator } from '../i18n';
import type { Mutate } from '../app/types';
import { Stat } from '../app/ui';

export default function RestorePreview({
  state,
  data,
  mutate,
  busy,
  merged,
  replaced,
}: {
  state: AppState;
  data: AppState;
  mutate: Mutate;
  busy: boolean;
  merged: () => void;
  replaced: () => void;
}) {
  const t = translator(state.prefs.mode);
  return (
    <div className="restore-preview">
      <div className="mini-stats">
        <Stat value={data.entries.length} label={t('words')} />
        <Stat value={data.events.length} label={t('history')} />
      </div>
      <p>{t('restoreHint')}</p>
      <p className="muted">{t('mergeHint')}</p>
      <div className="button-row">
        <button
          className="secondary-button"
          disabled={busy}
          onClick={async () => {
            if (await mutate((d) => mergeBackup(d, data))) merged();
          }}
        >
          {t('merge')}
        </button>
        <button
          className="primary-button"
          disabled={busy}
          onClick={async () => {
            // The current data is kept in storage (Settings → export pre-restore backup), not
            // downloaded: on an iPhone home-screen app a download interrupts the restore.
            if (needsLegacyUpgrade(data)) await loadContent('legacy-upgrade');
            if (await mutate((d) => replaceWithBackup(d, data), { backupAs: 'before-restore' }))
              replaced();
          }}
        >
          {t('replace')}
        </button>
      </div>
    </div>
  );
}

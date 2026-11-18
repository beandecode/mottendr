import type { AppState } from '../domain/types';
import { packEntries } from '../domain/pack';
import { backupOf } from '../domain/user-data';
import { exportFile } from '../platform/native';

export function download(name: string, text: string, type = 'application/json') {
  void exportFile(name, text, type).catch(() =>
    window.dispatchEvent(new Event('francais-export-error')),
  );
}
// Full backups hold the learner's data only; built-in content comes from the app.
export const backupText = (state: AppState) =>
  JSON.stringify(backupOf(state, packEntries()), null, 2);
export const backup = (state: AppState) =>
  download(
    `francais-backup-${new Date().toISOString().replaceAll(':', '-')}.json`,
    backupText(state),
  );

import type { AppState } from '../domain/types';
import { packEntries } from '../domain/pack';
import { backupOf } from '../domain/user-data';

// Saves a file through the browser's download.
export function download(name: string, text: string, type = 'application/json') {
  try {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch {
    window.dispatchEvent(new Event('francais-export-error'));
  }
}
// Full backups hold the learner's data only; built-in content comes from the app.
export const backupText = (state: AppState) =>
  JSON.stringify(backupOf(state, packEntries()), null, 2);
export const backup = (state: AppState) =>
  download(
    `francais-backup-${new Date().toISOString().replaceAll(':', '-')}.json`,
    backupText(state),
  );

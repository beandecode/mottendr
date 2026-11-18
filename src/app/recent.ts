// Words looked up in the dictionary, newest first. Kept only in this browser (localStorage): a
// convenience, not learning data, so it is not part of backups and may come back empty.
const KEY = 'francais.dictionary.recent';
export const RECENT_LIMIT = 20;

export function pushRecent(list: string[], id: string, limit = RECENT_LIMIT): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, limit);
}

export function readRecent(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function writeRecent(list: string[]) {
  try {
    if (list.length) localStorage.setItem(KEY, JSON.stringify(list));
    else localStorage.removeItem(KEY);
  } catch {
    // Private mode or blocked storage: the list just is not kept.
  }
}

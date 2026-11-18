import wordList from '../../content/demo/word-list.json';
import legacyUpgrade from '../../content/demo/legacy-upgrade.json';
import dictionary from '../../content/demo/dictionary.json';
import type { ContentFiles } from './files';

// The showcase repository ships the demo content as ready-made JSON (content/demo/); the full word list, the
// content tools and the sources behind them are not part of it. Vite and the tests read the same files the
// running app downloads.
export function contentFiles(): ContentFiles {
  return {
    'word-list': wordList as unknown as ContentFiles['word-list'],
    'legacy-upgrade': legacyUpgrade as unknown as ContentFiles['legacy-upgrade'],
    dictionary: dictionary as unknown as ContentFiles['dictionary'],
  };
}

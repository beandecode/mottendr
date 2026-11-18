import type { Entry } from '../domain/types';

// Large content ships as JSON files generated at build time (vite.config.ts), not inside
// the JavaScript bundle. The app downloads them (the service worker keeps them offline);
// tests fill the same slots directly from the source files (tests/setup.ts).

export type SenseOrigin = 'ai-edited' | 'human-checked';
export interface WordListFile {
  version: number;
  // Revision of each entry is its contentVersion (see content/manifest.ts).
  entries: Entry[];
  // How each sense was produced; senses not listed were converted by rule.
  senseOrigins: Record<string, SenseOrigin>;
  // Edition of each finished entry ("1.0.0"); entries not listed are not finished yet.
  editions: Record<string, string>;
  // Word frequency order of the built-in entries (1 = most frequent), for "按词频".
  frequency: Record<string, number>;
  // Lexique lemma rank of the built-in entries (1 = most frequent lemma), for "高频 2000".
  // Missing in files built before 2026-10-18.
  lemmaRanks?: Record<string, number>;
  // Built-in entries not studied by default (grammar words): paused unless the learner
  // resumes them. Missing in files built before 2026-10-18.
  notStudied?: string[];
  // Retired IDs: replacements, and the last content of retired entries.
  retired: {
    entries: Record<string, { replacedBy: string[]; entry: Entry }>;
    senses: Record<string, string[]>;
  };
}
// Patches for data saved by older versions; only needed while upgrading such data.
export interface LegacyUpgradeFile {
  enrichment: { version: number; changes: unknown[] };
  definitions: { version: number; changes: unknown[] };
  verbs: { version: number; changes: unknown[] };
}
export interface DictionaryFile {
  records: unknown[];
  manifest: {
    version: string;
    sources: {
      id: string;
      label: string;
      version: string;
      license: string;
      licenseUrl: string;
      url: string;
      attribution: string;
    }[];
  } & Record<string, unknown>;
  conflicts: unknown;
}
export interface ContentFiles {
  'word-list': WordListFile;
  'legacy-upgrade': LegacyUpgradeFile;
  dictionary: DictionaryFile;
}
export type ContentName = keyof ContentFiles;

// Hashed file names, defined by the build (see vite.config.ts).
declare const __CONTENT_FILES__: Record<ContentName, string>;

const loaded: Partial<ContentFiles> = {};
const pending = new Map<ContentName, Promise<unknown>>();
const listeners = new Set<(name: ContentName) => void>();

export function setContent<N extends ContentName>(name: N, data: ContentFiles[N]) {
  loaded[name] = data;
  listeners.forEach((listener) => listener(name));
}
export const hasContent = (name: ContentName) => loaded[name] !== undefined;
export function content<N extends ContentName>(name: N): ContentFiles[N] {
  const data = loaded[name];
  if (!data) throw new Error('CONTENT_NOT_LOADED:' + name);
  return data as ContentFiles[N];
}
export function onContentLoaded(listener: (name: ContentName) => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
export function loadContent<N extends ContentName>(name: N): Promise<ContentFiles[N]> {
  if (loaded[name]) return Promise.resolve(loaded[name] as ContentFiles[N]);
  if (!pending.has(name))
    pending.set(
      name,
      fetch(__CONTENT_FILES__[name])
        .then((r) => {
          if (!r.ok) throw new Error('CONTENT_UNAVAILABLE:' + name);
          return r.json();
        })
        .then((data) => setContent(name, data))
        .finally(() => pending.delete(name)),
    );
  return pending.get(name)!.then(() => content(name));
}

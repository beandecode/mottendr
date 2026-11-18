import { completeReviewedVerb } from './reviewed-verbs';
import { upgradeDefinitions } from './definition-upgrade';
import { normalizeHeadword } from './headword';
import { content } from '../content/files';
import { initialState } from './seed';
import { ensureTasks } from './learning';
import { validateLinks } from './validation';
import { snapshot } from './draft';
import { packEntries, packVersion } from './pack';
import type { AppState, Entry } from './types';

export const CURRENT_COLLECTION = 'word-list';
interface EnrichmentPatches {
  version: number;
  changes: {
    id: string;
    originalWord: string;
    patches: {
      path: string[];
      before?: unknown;
      after?: unknown;
      guards?: { path: string[]; value: unknown }[];
    }[];
  }[];
}
// Stable collection IDs keep this collection independent of all legacy words and progress.
export function installCurrentCollection(state: AppState, at = Date.now()): boolean {
  if (state.installedCollections?.some((c) => c.id === CURRENT_COLLECTION)) return false;
  const entries = [...packEntries().values()].map((e) => structuredClone(e)),
    ids = new Set(state.entries.map((e) => e.id));
  validateLinks(entries);
  // The build checks the pack against pack-manifest.json; the count changes as entries are
  // retired or added (3,361 → 3,360 when ouvre merged into ouvrir), so only require some.
  if (!entries.length) throw new Error('INVALID_BUILTIN_COLLECTION');
  const previousSession = snapshot(state.session);
  state.entries.push(...entries.filter((e) => !ids.has(e.id)));
  state.installedCollections ??= [];
  state.installedCollections.push({
    id: CURRENT_COLLECTION,
    version: packVersion(),
    at,
    previousSession,
  });
  state.session = null;
  state.prefs.mode = 'zhOnly';
  ensureTasks(state, 'recognition', at);
  return true;
}
export function freshLearningState(at = Date.now()) {
  const state = initialState(at);
  state.entries = [];
  state.tasks = [];
  state.events = [];
  state.importBatches = [];
  state.prefs.speechEngine = 'browser';
  state.prefs.voice = '';
  installCurrentCollection(state, at);
  return state;
}

// Data saved before the current pack version needs the legacy-upgrade file.
export function needsLegacyUpgrade(state: Pick<AppState, 'installedCollections'>) {
  const collection = state.installedCollections?.find((c) => c.id === CURRENT_COLLECTION);
  return !!collection && collection.version < packVersion();
}

// Field comparisons protect manual edits. IDs, tasks, events and the active session are untouched.
export function upgradeCurrentCollection(state: AppState, at = Date.now()): boolean {
  let changed = false;
  const collection = state.installedCollections?.find((c) => c.id === CURRENT_COLLECTION);
  const priorVersion = collection?.version ?? packVersion();
  if (collection && collection.version < 2) {
    const map = new Map(state.entries.map((e) => [e.id, e]));
    const patches = content('legacy-upgrade').enrichment as EnrichmentPatches;
    for (const change of patches.changes) {
      const entry = map.get(change.id);
      if (!entry || entry.word !== change.originalWord) continue;
      let touched = false;
      const original = snapshot(entry),
        applied = new Set<string>();
      for (const patch of change.patches.filter((p) => p.path[0] !== 'contentProvenance')) {
        const read = (path: string[]) =>
          path.reduce<unknown>(
            (value, key) =>
              value && typeof value === 'object'
                ? (value as Record<string, unknown>)[key]
                : undefined,
            original,
          );
        const guards = ('guards' in patch ? patch.guards : []) as {
          path: string[];
          value: unknown;
        }[];
        if (
          guards.some((guard) => JSON.stringify(read(guard.path)) !== JSON.stringify(guard.value))
        )
          continue;
        let parent: Record<string, unknown> = entry as unknown as Record<string, unknown>;
        for (const key of patch.path.slice(0, -1)) {
          const next = parent?.[key];
          if (!next || typeof next !== 'object') {
            parent = {};
            break;
          }
          parent = next as Record<string, unknown>;
        }
        const key = patch.path.at(-1)!;
        const before = 'before' in patch ? patch.before : undefined;
        if (JSON.stringify(parent[key]) !== JSON.stringify(before)) continue;
        if ('after' in patch) parent[key] = structuredClone(patch.after);
        else delete parent[key];
        applied.add(patch.path.join('.'));
        touched = true;
      }
      const evidence = change.patches.find((p) => p.path[0] === 'contentProvenance');
      if (evidence && 'after' in evidence && original.contentProvenance === undefined) {
        const proposed = evidence.after as unknown as NonNullable<Entry['contentProvenance']>;
        const actual = proposed.filter((p) => applied.has(p.path));
        if (actual.length) entry.contentProvenance = structuredClone(actual);
      }
      if (touched) {
        entry.contentVersion++;
        entry.updatedAt = at;
        changed = true;
      }
    }
    collection.version = 2;
    changed = true;
  }
  if (upgradeDefinitions(state, at)) changed = true;
  if (collection && priorVersion < packVersion())
    for (const entry of state.entries)
      if (completeReviewedVerb(entry)) {
        entry.contentVersion++;
        entry.updatedAt = at;
        changed = true;
      }
  for (const entry of state.entries)
    if (normalizeHeadword(entry)) {
      entry.contentVersion++;
      entry.updatedAt = at;
      changed = true;
    }
  return changed;
}

// "Replace" restore: the backup's data takes over, keeping the stored revision, and the
// built-in collection is brought up to date. Call loadContent('legacy-upgrade') first
// when needsLegacyUpgrade(data).
export function replaceWithBackup(d: AppState, data: AppState) {
  const incoming = structuredClone(data);
  incoming.revision = d.revision;
  delete d.installedCollections;
  Object.assign(d, incoming);
  installCurrentCollection(d);
  upgradeCurrentCollection(d);
}

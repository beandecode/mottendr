import type { AppState, Task } from './types';
import { validateLegacyState } from './legacy-validation';
import { upgradeEntry } from './lexicon';
import { object, validateStateV2 } from './validation';
import { enrichUneditedSamples } from './seed';
import { stripCollectionTags } from './collections';
import { packEntries } from './pack';
import { stateFromBackup } from './user-data';
export const TYPOGRAPHY_VERSION = 3;
export const FONT_SCALES = [0.85, 1, 1.15, 1.3];
// Typography v2 made the original 150% the new 100%; v3 makes v2's 115% the new 100%.
// Rebase old preferences once, keeping the text the same size on screen, without changing
// tasks, events, sessions or later user-selected text sizes.
function migrateTypography(state: AppState): AppState {
  const p = state.prefs;
  if (p.typographyVersion === TYPOGRAPHY_VERSION) return state;
  if (p.typographyVersion === 2) {
    const target = (p.fontScale ?? 1) / 1.15;
    p.fontScale = FONT_SCALES.reduce((best, scale) =>
      Math.abs(scale - target) < Math.abs(best - target) ? scale : best,
    );
  } else p.fontScale = 1;
  p.typographyVersion = TYPOGRAPHY_VERSION;
  return state;
}
// Before 0.7.5 "新词乱序" was a switch; it became one of three new-word orders.
function migrateNewWordOrder(state: AppState): AppState {
  const p = state.prefs;
  if (p.shuffleNewWords !== undefined) {
    if (p.newWordOrder === undefined && p.shuffleNewWords) p.newWordOrder = 'shuffle';
    delete p.shuffleNewWords;
  }
  return state;
}
// Every loaded or imported state is normalized the same way.
const normalize = (state: AppState) => {
  stripCollectionTags(state);
  return migrateNewWordOrder(migrateTypography(state));
};
export function migrateState(value: unknown, enrichSamples = false): AppState {
  if (!object(value)) throw new Error('INVALID_FILE');
  if (value.schemaVersion === 3)
    return normalize(validateStateV2(stateFromBackup(value, packEntries())));
  if (value.schemaVersion === 2) return normalize(validateStateV2(value));
  if (value.schemaVersion !== 1) throw new Error('UNSUPPORTED_VERSION');
  const legacy = validateLegacyState(value);
  const task = (t: (typeof legacy.tasks)[number]): Task => ({ ...t, target: { kind: 'entry' } });
  const next: AppState = {
    ...legacy,
    schemaVersion: 2,
    entries: legacy.entries.map(upgradeEntry),
    tasks: legacy.tasks.map(task),
    events: legacy.events.map((e) => ({ ...e, before: task(e.before), after: task(e.after) })),
  };
  if (enrichSamples) enrichUneditedSamples(next, legacy.entries);
  return normalize(validateStateV2(next));
}

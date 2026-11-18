import { freeze, produce } from 'immer';
import type { AppState } from './types';
import { diffState, type StateChanges } from './changes';
import { validateChanges } from './validation';
import { journal } from './content-log';

// The live state is deeply frozen. Besides catching accidental in-place edits, this lets
// immer skip unchanged subtrees; on an unfrozen state it walks all ~10 MB after every change.
export const freezeState = (state: AppState) => freeze(state, true);

// Runs an operation without copying the whole state: only touched records are copied,
// everything else is shared with `state`. Content changes are added to the content log.
// Returns null when nothing changed.
export function applyOperation(
  state: AppState,
  operation: (draft: AppState) => unknown,
  at = Date.now(),
): { next: AppState; changes: StateChanges } | null {
  let next = produce(state, (draft) => {
    operation(draft);
  });
  if (next === state) return null;
  const records = journal(state, next, at);
  if (records.length)
    next = produce(next, (draft) => {
      (draft.contentLog ??= []).push(...records);
    });
  const changes = diffState(state, next);
  validateChanges(state, next, changes);
  return { next, changes };
}

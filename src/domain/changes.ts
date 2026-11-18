import type { AppState } from './types';

// Which records of a list changed between two states. `rewrite` means the list was
// shortened or reordered, so the whole list has to be replaced.
export interface ListChange {
  rewrite: boolean;
  indexes: number[];
}
export interface StateChanges {
  entries: ListChange;
  tasks: ListChange;
  events: ListChange;
  issues: ListChange;
  contentLog: ListChange;
}

const unchanged: ListChange = { rewrite: false, indexes: [] };
const none: never[] = [];
const rewrite: ListChange = { rewrite: true, indexes: [] };
export const fullRewrite: StateChanges = {
  entries: rewrite,
  tasks: rewrite,
  events: rewrite,
  issues: rewrite,
  contentLog: rewrite,
};

function diffList<T extends { id: string }>(before: T[], after: T[]): ListChange {
  if (before === after) return unchanged;
  if (after.length < before.length) return rewrite;
  const indexes: number[] = [];
  for (let i = 0; i < after.length; i++) {
    if (i >= before.length) indexes.push(i);
    else if (before[i] !== after[i]) {
      if (before[i].id !== after[i].id) return rewrite;
      indexes.push(i);
    }
  }
  return { rewrite: false, indexes };
}

// Relies on structural sharing (immer): records that were not modified keep their identity.
export const diffState = (before: AppState, after: AppState): StateChanges => ({
  entries: diffList(before.entries, after.entries),
  tasks: diffList(before.tasks, after.tasks),
  events: diffList(before.events, after.events),
  issues: diffList(before.issues ?? none, after.issues ?? none),
  contentLog: diffList(before.contentLog ?? none, after.contentLog ?? none),
});

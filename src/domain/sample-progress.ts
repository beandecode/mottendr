import type { AppState } from './types';
import { addDays, beginSession, commitAnswer, refreshSession } from './learning';
import { preview } from '../scheduler';

// Sample progress for the public demo: replays about a month of study through the app's own session and answer
// functions, so every screen (Activity, forecast, heat map, Library tags) shows a real-looking history.
// It is deterministic: the same words give the same history. Only the demo offers it.
export const SAMPLE_DAYS = 28;
const NEW_PER_DAY = 6;
const REST_DAYS = [9, 16, 23]; // days ago with no study (the last streak is 8 days); today stays free for the visitor

export function addSampleProgress(state: AppState, now: number, days = SAMPLE_DAYS) {
  const { newLimit, sessionLimit } = state.prefs;
  state.prefs.newLimit = NEW_PER_DAY;
  state.prefs.sessionLimit = 60;
  let seed = 20261115;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  for (let d = days; d >= 1; d--) {
    if (REST_DAYS.includes(d)) continue;
    let at = addDays(now, -d) + (9 + Math.floor(random() * 10)) * 3_600_000;
    beginSession(state, state.prefs.direction, at);
    const wanted = 18 + Math.floor(random() * 14);
    for (let n = 0; n < wanted; n++) {
      if (!state.session!.queue.length) {
        // Cards answered "again" or seen for the first time come back a minute later.
        at += 61_000;
        refreshSession(state, at, true);
        if (!state.session!.queue.length) break;
      }
      const id = state.session!.queue[0];
      const task = state.tasks.find((t) => t.id === id)!;
      at += 8_000 + Math.floor(random() * 12_000);
      const eventId = `sample-${d}-${n}`;
      if (!task.learnedAt) {
        commitAnswer(state, id, eventId, at, 9_000);
      } else {
        const roll = random();
        const rating = roll < 0.06 ? 1 : roll < 0.2 ? 2 : roll < 0.85 ? 3 : 4;
        const outcomes = preview(task.card, at, state.prefs.retention);
        commitAnswer(state, id, eventId, at, 6_000, rating, outcomes, at);
      }
    }
    state.session = null;
  }
  state.prefs.newLimit = newLimit;
  state.prefs.sessionLimit = sessionLimit;
}

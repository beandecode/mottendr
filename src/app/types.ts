import type { AppState } from '../domain/types';
import type { ToolTab } from '../pages/AddTools';

// 'settings' is a page only in the iOS app, where Settings is a tab; elsewhere it is a sheet.
export type View = 'today' | 'library' | 'dictionary' | 'activity' | 'study' | 'settings';
export type Modal =
  | { type: 'settings' }
  | { type: 'detail'; id: string }
  // issueId: opened to fix a flagged problem, which is resolved when the edit is saved.
  | { type: 'edit'; id: string; issueId?: string; senseId?: string }
  | { type: 'issue'; entryId: string; senseId?: string }
  | { type: 'restore'; data: AppState }
  | { type: 'dictionary'; recordId: string }
  | { type: 'tools'; tab: ToolTab }
  | { type: 'attribution' }
  | null;
// `backupAs`: keep the state before this change in storage under that key.
export type Mutate = (
  operation: (draft: AppState) => void,
  options?: { backupAs?: string },
) => Promise<boolean>;

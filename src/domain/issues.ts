import type { AppState, Entry } from './types';
import type { Issue } from './user-layer';
import { newId } from './id';
import { collectionOf } from './collections';

export type IssueInput = Pick<Issue, 'entryId' | 'senseId' | 'kind' | 'note' | 'context'>;

// Flagging never touches tasks or events, so it cannot change the review schedule.
export function addIssue(
  state: AppState,
  input: IssueInput,
  pack: ReadonlyMap<string, Entry>,
  at = Date.now(),
): string {
  const id = newId();
  const builtIn = pack.get(input.entryId);
  const issue: Issue = {
    id,
    entryId: input.entryId,
    kind: input.kind,
    note: input.note.trim(),
    context: input.context.trim(),
    status: 'open',
    createdAt: at,
  };
  if (input.senseId) issue.senseId = input.senseId;
  if (builtIn) issue.packVersion = builtIn.contentVersion;
  (state.issues ??= []).push(issue);
  return id;
}

export function closeIssue(
  state: AppState,
  id: string,
  status: 'resolved' | 'dismissed',
  at = Date.now(),
) {
  const issue = state.issues?.find((i) => i.id === id);
  if (!issue || issue.status !== 'open') return;
  issue.status = status;
  issue.closedAt = at;
}

export const openIssues = (state: Pick<AppState, 'issues'>, entryId?: string) =>
  (state.issues ?? []).filter((i) => i.status === 'open' && (!entryId || i.entryId === entryId));

// The built-in entry changed since the problem was flagged: worth checking again.
export const maybeFixed = (issue: Issue, pack: ReadonlyMap<string, Entry>) =>
  issue.packVersion !== undefined &&
  (pack.get(issue.entryId)?.contentVersion ?? issue.packVersion) > issue.packVersion;

// For the next round of content work: what was flagged and what the entry says now.
export function exportIssues(state: AppState, format: 'json' | 'tsv') {
  const entries = new Map(state.entries.map((e) => [e.id, e]));
  const rows = (state.issues ?? []).map((issue) => {
    const entry = entries.get(issue.entryId);
    const sense = entry?.groups.flatMap((g) => g.senses).find((s) => s.id === issue.senseId);
    return {
      word: entry?.word ?? '',
      collection: entry ? collectionOf(entry) : '',
      entryId: issue.entryId,
      senseId: issue.senseId ?? '',
      kind: issue.kind,
      status: issue.status,
      note: issue.note,
      context: issue.context,
      createdAt: new Date(issue.createdAt).toISOString(),
      currentZh: sense?.definitions.zh.short ?? '',
      currentEn: sense?.definitions.en.short ?? '',
    };
  });
  if (format === 'json') return JSON.stringify(rows, null, 2);
  const columns = Object.keys(rows[0] ?? { word: '' }) as (keyof (typeof rows)[number])[];
  const cell = (v: string) => v.replace(/[\t\r\n]+/g, ' ');
  return [columns.join('\t'), ...rows.map((r) => columns.map((c) => cell(r[c])).join('\t'))].join(
    '\n',
  );
}

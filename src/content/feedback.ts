import { applyPatches, reviewPatches } from '../domain/layers';
import {
  validateBackupShape,
  validateIssue,
  validatePatchDoc,
  type ContentPatch,
  type ContentPatchDoc,
  type Issue,
  type PathSegment,
} from '../domain/user-layer';
import { validateEntry } from '../domain/validation';
import type { Entry } from '../domain/types';

// Learner feedback from a full backup: the problems flagged while
// studying and the learner's own edits to built-in entries. readFeedback only reports;
// adoptEdits folds chosen edits into the pack, refusing any the pack has changed since.

export interface IssueRow {
  word: string;
  entryId: string;
  sense: string;
  kind: Issue['kind'];
  note: string;
  context: string;
  createdAt: number;
  // The built-in entry has a newer revision than when the problem was flagged.
  packChanged: boolean;
  edited: boolean;
}
export interface EditRow {
  word: string;
  entryId: string;
  // Where the edit is, and for a changed value: before → after.
  changes: string[];
  conflict: boolean;
  issues: number;
}
export interface FeedbackReport {
  openIssues: IssueRow[];
  closedIssues: number;
  edits: EditRow[];
  // Edits to entries that are no longer in the pack.
  orphanEdits: string[];
  userEntries: number;
}

interface Feedback {
  docs: ContentPatchDoc[];
  issues: Issue[];
  userEntries: number;
}
function parse(backup: unknown): Feedback {
  validateBackupShape(backup);
  const docs = backup.contentPatches;
  docs.forEach(validatePatchDoc);
  const issues = backup.issues ?? [];
  issues.forEach(validateIssue);
  return {
    docs: docs as ContentPatchDoc[],
    issues: issues as Issue[],
    userEntries: backup.userEntries.length,
  };
}

// groups[…:group:verb]/senses[…:sense:1]/definitions/zh/short
export const pathText = (entryId: string, path: PathSegment[]) =>
  path
    .map((s) => (typeof s === 'string' ? s : `[${s.id.replace(entryId + ':', '')}]`))
    .join('/')
    .replace(/\/\[/g, '[');

const brief = (v: unknown) => {
  const s = typeof v === 'string' ? v : (JSON.stringify(v) ?? '（无）');
  return s.length > 60 ? s.slice(0, 60) + '…' : s;
};
const senseText = (entry: Entry | undefined, senseId: string | undefined) => {
  const sense = entry?.groups.flatMap((g) => g.senses).find((s) => s.id === senseId);
  return sense ? sense.definitions.zh.short || sense.definitions.en.short : '';
};

export function readFeedback(
  backup: unknown,
  pack: ReadonlyMap<string, Entry>,
  revisions: Record<string, number>,
): FeedbackReport {
  const { docs, issues, userEntries } = parse(backup);
  const edited = new Set(docs.map((d) => d.id));
  const open = issues.filter((i) => i.status === 'open');
  return {
    openIssues: open.map((i) => {
      const entry = pack.get(i.entryId);
      return {
        word: entry?.word ?? '',
        entryId: i.entryId,
        sense: senseText(entry, i.senseId),
        kind: i.kind,
        note: i.note,
        context: i.context,
        createdAt: i.createdAt,
        packChanged:
          i.packVersion !== undefined && (revisions[i.entryId] ?? i.packVersion) > i.packVersion,
        edited: edited.has(i.entryId),
      };
    }),
    closedIssues: issues.length - open.length,
    edits: docs
      .filter((d) => pack.has(d.id))
      .map((d) => ({
        word: pack.get(d.id)!.word,
        entryId: d.id,
        changes: d.patches.map(
          (p) =>
            pathText(d.id, p.path) +
            (p.op === 'set' ? `：${brief(p.base)} → ${brief(p.value)}` : `（${p.op}）`),
        ),
        conflict: reviewPatches(pack.get(d.id)!, d).stale,
        issues: issues.filter((i) => i.entryId === d.id).length,
      })),
    orphanEdits: docs.filter((d) => !pack.has(d.id)).map((d) => d.id),
    userEntries,
  };
}

// The senses an adopted edit counts as checked by a person, by where it changed: a sense
// (or anything inside it) marks that sense; a part-of-speech group (gender, conjugation,
// forms…) marks every sense of the group; anything else on the entry (headword, IPA…)
// marks every sense of the entry. `entry` is the entry after the edit.
export function sensesTouched(entry: Entry, patches: ContentPatch[]): string[] {
  const ids = new Set<string>();
  const group = (id: string) => entry.groups.find((g) => g.id === id);
  for (const p of patches) {
    const [first, groupSeg, third, senseSeg] = p.path;
    const item = p.op === 'add' ? (p.item as { id?: string }) : undefined;
    if (first === 'groups' && typeof groupSeg === 'object') {
      if (third === 'senses' && typeof senseSeg === 'object') ids.add(senseSeg.id);
      else if (third === 'senses' && p.path.length === 3 && item?.id) ids.add(item.id);
      else group(groupSeg.id)?.senses.forEach((s) => ids.add(s.id));
    } else if (first === 'groups' && p.path.length === 1 && item?.id)
      group(item.id)?.senses.forEach((s) => ids.add(s.id));
    else entry.groups.forEach((g) => g.senses.forEach((s) => ids.add(s.id)));
  }
  const present = new Set(entry.groups.flatMap((g) => g.senses.map((s) => s.id)));
  return [...ids].filter((id) => present.has(id));
}

export interface Adoption {
  entries: Entry[];
  adopted: string[];
  // Sense ids to record as human-checked (see sensesTouched).
  checked: string[];
  skipped: { item: string; reason: 'conflict' | 'not-applicable' | 'invalid' | 'no-edit' }[];
}
// `select` names entries by id or headword. Only content edits are folded in; favourites,
// notes and other personal data stay with the learner.
export function adoptEdits(pack: Entry[], backup: unknown, select: 'all' | string[]): Adoption {
  const { docs } = parse(backup);
  const index = new Map(pack.map((e, i) => [e.id, i]));
  const entries = [...pack];
  const result: Adoption = { entries, adopted: [], checked: [], skipped: [] };
  const chosen =
    select === 'all'
      ? docs
      : docs.filter((d) => select.some((s) => s === d.id || s === pack[index.get(d.id)!]?.word));
  if (select !== 'all')
    for (const s of select)
      if (!chosen.some((d) => d.id === s || pack[index.get(d.id)!]?.word === s))
        result.skipped.push({ item: s, reason: 'no-edit' });
  for (const doc of chosen) {
    const at = index.get(doc.id);
    if (at === undefined) continue;
    const base = pack[at];
    if (reviewPatches(base, doc).stale) {
      result.skipped.push({ item: base.word, reason: 'conflict' });
      continue;
    }
    const next = structuredClone(base);
    if (!applyPatches(next, doc.patches)) {
      result.skipped.push({ item: base.word, reason: 'not-applicable' });
      continue;
    }
    try {
      // Source entries carry no revision; the manifest gives them one at build time.
      validateEntry({ ...next, contentVersion: next.contentVersion ?? 1 });
    } catch {
      result.skipped.push({ item: base.word, reason: 'invalid' });
      continue;
    }
    entries[at] = next;
    result.adopted.push(base.word);
    result.checked.push(...sensesTouched(next, doc.patches));
  }
  return result;
}

const KIND_LABEL: Record<Issue['kind'], string> = {
  meaning: '释义',
  'gender-pos': '性别或词性',
  example: '例句',
  conjugation: '变位',
  missing: '缺内容',
  other: '其他',
};
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
const day = (t: number) => new Date(t).toISOString().slice(0, 10);

export function renderReport(r: FeedbackReport, title: string): string {
  const lines = [`# 学习反馈报告 ${title}`, ''];
  lines.push(`## 未处理的问题（${r.openIssues.length}）`, '');
  if (r.openIssues.length) {
    lines.push('| 词 | 义项 | 类型 | 说明 | 原句 | 标记后词包已改 | 有修改 | 日期 |');
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const i of r.openIssues)
      lines.push(
        `| ${cell(i.word || i.entryId)} | ${cell(i.sense)} | ${KIND_LABEL[i.kind]} | ${cell(i.note)} | ${cell(i.context)} | ${i.packChanged ? '是' : ''} | ${i.edited ? '是' : ''} | ${day(i.createdAt)} |`,
      );
    lines.push('');
  }
  lines.push(`## 对内置词条的修改（${r.edits.length}）`, '');
  if (r.edits.length) {
    lines.push(
      '| 词 | 修改（位置：原来 → 现在） | 与当前词包冲突 | 关联问题 |',
      '|---|---|---|---|',
    );
    for (const e of r.edits)
      lines.push(
        `| ${cell(e.word)} | ${cell(e.changes.join('<br>'))} | ${e.conflict ? '是' : ''} | ${e.issues || ''} |`,
      );
    lines.push('');
  }
  lines.push('## 其他', '');
  lines.push(`- 已关闭的问题：${r.closedIssues} 条`);
  lines.push(`- 自建词条：${r.userEntries} 个（不收进词包）`);
  if (r.orphanEdits.length)
    lines.push(`- 指向已不在词包里的词条的修改：${r.orphanEdits.join('、')}`);
  return lines.join('\n') + '\n';
}

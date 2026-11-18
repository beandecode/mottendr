import { normalizeHeadword } from './headword';
import type { AppState, Entry } from './types';
import { uid, ensureTasks } from './learning';
import { blankEntry, entryKey, shortDefinition, upgradeEntry, newVerb } from './lexicon';
import { assert, object, string, validateEntry, validateLinks } from './validation';
import { validateLegacyEntry } from './legacy-validation';
import { migrateState } from './migration';
export { blankEntry, entryKey } from './lexicon';
export { validateEntry } from './validation';
export const validateBackup = (value: unknown): AppState => migrateState(value);
export interface ImportPreview {
  entries: Entry[];
  duplicates: number;
  errors: { row: number; reason: string }[];
}
function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (quoted) {
        quoted = false;
      } else if (!cell) {
        quoted = true;
      } else throw new Error('INVALID_FILE');
    } else if (!quoted && c === delimiter) {
      row.push(cell);
      cell = '';
    } else if (!quoted && (c === '\n' || c === '\r')) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (quoted) throw new Error('INVALID_FILE');
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}

export function parseEntries(
  text: string,
  format: 'json' | 'csv' | 'tsv',
  existing: Entry[],
): ImportPreview {
  if (text.length > 100_000_000) throw new Error('FILE_TOO_LARGE');
  let records: unknown[];
  if (format === 'json') {
    const raw = JSON.parse(text.replace(/^\uFEFF/, ''));
    records = Array.isArray(raw) ? raw : raw.entries;
    if (!Array.isArray(records)) throw new Error('INVALID_FILE');
  } else {
    const [header, ...rows] = parseDelimited(
      text.replace(/^\uFEFF/, ''),
      format === 'tsv' ? '\t' : ',',
    );
    if (!header || !header.includes('word')) throw new Error('INVALID_FILE');
    records = rows.map((row) => Object.fromEntries(header.map((k, i) => [k.trim(), row[i] ?? ''])));
  }
  if (records.length > 10_000) throw new Error('FILE_TOO_LARGE');
  const result: ImportPreview = { entries: [], duplicates: 0, errors: [] },
    keys = new Map(existing.filter((e) => !e.archived).map((e) => [entryKey(e), e.id])),
    ids = new Map<string, string>(),
    rows = new Map<string, number>(),
    inputIds = new Set<string>();
  records.forEach((raw, i) => {
    try {
      assert(object(raw));
      let e: Entry;
      if (Array.isArray(raw.groups)) {
        validateEntry(raw);
        e = structuredClone(raw);
      } else if (object(raw.zh) && object(raw.en)) {
        validateLegacyEntry(raw);
        e = upgradeEntry(raw);
      } else {
        e = blankEntry();
        for (const k of ['word', 'ipa', 'source'] as const)
          if (raw[k] !== undefined) {
            assert(string(raw[k]));
            e[k] = raw[k] as string;
          }
        e.kind =
          raw.kind === 'pronominal' || /^(se |s['’])/.test(e.word) ? 'pronominal' : 'lexical';
        const g = e.groups[0];
        g.pos = String(raw.pos ?? (e.kind === 'pronominal' ? 'verb' : 'noun'));
        if (g.pos === 'verb') {
          g.verb = newVerb();
          g.verb.pronounRequired = e.kind === 'pronominal';
        }
        g.gender = String(raw.gender ?? '') as typeof g.gender;
        if (raw.groups_json) {
          g.senses = [];
          e.groups = JSON.parse(String(raw.groups_json));
        } else {
          for (const locale of ['zh', 'en'] as const) {
            g.senses[0].definitions[locale] = {
              short: String(raw[locale] ?? ''),
              detail: String(raw[`detail_${locale}`] ?? ''),
              usage: String(raw[`usage_${locale}`] ?? ''),
            };
            g.specialNotes[locale] = String(raw[`irregular_${locale}`] ?? '');
          }
          if (raw.example) {
            g.senses[0].examples = [
              {
                id: uid(),
                text: String(raw.example),
                translations: {
                  zh: String(raw.translation_zh ?? ''),
                  en: String(raw.translation_en ?? ''),
                },
                note: { zh: '', en: '' },
                source: '',
              },
            ];
          }
          if (raw.irregular === true || raw.irregular === 'true') g.features = ['special-use'];
        }
        for (const [column, key] of [
          ['relations_json', 'relations'],
          ['families_json', 'families'],
          ['sources_json', 'sources'],
        ] as const)
          if (raw[column]) e[key] = JSON.parse(String(raw[column]));
        for (const [column, field] of [
          ['headword_json', 'headword'],
          ['dictionary_refs_json', 'dictionaryRefs'],
          ['provenance_json', 'contentProvenance'],
          ['card_display_json', 'cardDisplay'],
        ] as const)
          if (raw[column])
            (e as unknown as Record<string, unknown>)[field] = JSON.parse(String(raw[column]));
        e.tags = Array.isArray(raw.tags)
          ? (raw.tags as string[])
          : String(raw.tags ?? '')
              .split('|')
              .map((t) => t.trim())
              .filter(Boolean);
        if (raw.content_status)
          e.contentStatus = String(raw.content_status) as typeof e.contentStatus;
      }
      normalizeHeadword(e);
      e.sourceStatus = 'imported';
      e.favorite = false;
      e.suspended = false;
      e.archived = false;
      e.importBatchId = undefined;
      validateEntry(e);
      const oldId =
          typeof raw.id === 'string'
            ? raw.id
            : typeof (raw as Record<string, unknown>).entry_id === 'string'
              ? ((raw as Record<string, unknown>).entry_id as string)
              : e.id,
        key = entryKey(e);
      assert(!inputIds.has(oldId));
      inputIds.add(oldId);
      if (keys.has(key)) {
        ids.set(oldId, keys.get(key)!);
        result.duplicates++;
        return;
      }
      e.id = uid();
      ids.set(oldId, e.id);
      keys.set(key, e.id);
      rows.set(e.id, i + 1);
      result.entries.push(e);
    } catch {
      result.errors.push({ row: i + 1, reason: 'INVALID_ROW' });
    }
  });
  for (const e of result.entries)
    e.relations = e.relations.map((r) => ({ ...r, targetId: ids.get(r.targetId) ?? r.targetId }));
  let changed = true;
  while (changed) {
    changed = false;
    const all = new Map([...existing, ...result.entries].map((e) => [e.id, e]));
    result.entries = result.entries.filter((e) => {
      let malformed = false;
      try {
        validateEntry(e);
      } catch {
        malformed = true;
      }
      const bad =
        malformed ||
        e.relations.some((r) => {
          const target = all.get(r.targetId);
          return (
            !target ||
            (r.type === 'pronominal-of' &&
              (target.kind !== 'lexical' || !target.groups.some((g) => g.pos === 'verb')))
          );
        });
      if (bad) {
        result.errors.push({ row: rows.get(e.id)!, reason: 'MISSING_RELATION_TARGET' });
        changed = true;
      }
      return !bad;
    });
  }
  validateLinks([...existing, ...result.entries]);
  return result;
}
export function commitImport(state: AppState, entries: Entry[]) {
  const batchId = uid(),
    keys = new Map(state.entries.filter((e) => !e.archived).map((e) => [entryKey(e), e.id])),
    ids = new Map<string, string>(),
    added: Entry[] = [];
  for (const item of entries) {
    validateEntry(item);
    const key = entryKey(item);
    if (keys.has(key)) {
      ids.set(item.id, keys.get(key)!);
      continue;
    }
    const e = { ...structuredClone(item), id: uid(), importBatchId: batchId };
    ids.set(item.id, e.id);
    keys.set(key, e.id);
    added.push(e);
  }
  for (const e of added)
    e.relations = e.relations.map((r) => ({ ...r, targetId: ids.get(r.targetId) ?? r.targetId }));
  validateLinks([...state.entries, ...added]);
  state.entries.push(...added);
  state.importBatches.push({ id: batchId, at: Date.now(), entryIds: added.map((e) => e.id) });
  ensureTasks(state, 'recognition');
}
export function mergeBackup(current: AppState, incoming: AppState) {
  const ids = new Set(current.entries.map((e) => e.id)),
    keys = new Set(current.entries.map(entryKey));
  let newEntries = incoming.entries.filter((e) => !ids.has(e.id) && !keys.has(entryKey(e)));
  let changed = true;
  while (changed) {
    const accepted = new Set([...ids, ...newEntries.map((e) => e.id)]),
      before = newEntries.length;
    newEntries = newEntries.filter((e) => e.relations.every((r) => accepted.has(r.targetId)));
    changed = before !== newEntries.length;
  }
  const accepted = new Set(newEntries.map((e) => e.id)),
    newTasks = incoming.tasks.filter(
      (t) => accepted.has(t.entryId) && !current.tasks.some((old) => old.id === t.id),
    ),
    taskIds = new Set(newTasks.map((t) => t.id));
  validateLinks([...current.entries, ...newEntries]);
  current.entries.push(...structuredClone(newEntries));
  current.tasks.push(...structuredClone(newTasks));
  current.events.push(
    ...structuredClone(
      incoming.events.filter(
        (e) =>
          taskIds.has(e.taskId) &&
          !current.events.some((old) => old.id === e.id) &&
          [...e.sessionBefore.queue, ...e.sessionBefore.pending, ...e.sessionBefore.skipped].every(
            (id) => taskIds.has(id),
          ),
      ),
    ),
  );
  current.importBatches.push(
    ...structuredClone(
      incoming.importBatches
        .filter((b) => !current.importBatches.some((old) => old.id === b.id))
        .map((b) => ({ ...b, entryIds: b.entryIds.filter((id) => accepted.has(id)) }))
        .filter((b) => b.entryIds.length),
    ),
  );
}
export function exportTsv(entries: Entry[]) {
  const fields = [
    'entry_id',
    'word',
    'kind',
    'zh',
    'en',
    'ipa',
    'tags',
    'source',
    'content_status',
    'groups_json',
    'relations_json',
    'families_json',
    'sources_json',
    'headword_json',
    'dictionary_refs_json',
    'provenance_json',
    'card_display_json',
  ];
  const escape = (s: string) => `"${s.replaceAll('"', '""')}"`;
  return [
    fields.join('\t'),
    ...entries.map((e) =>
      [
        e.id,
        e.word,
        e.kind,
        shortDefinition(e, 'zh'),
        shortDefinition(e, 'en'),
        e.ipa,
        e.tags.join('|'),
        e.source,
        e.contentStatus,
        JSON.stringify(e.groups),
        JSON.stringify(e.relations),
        JSON.stringify(e.families),
        JSON.stringify(e.sources),
        JSON.stringify(e.headword) ?? '',
        JSON.stringify(e.dictionaryRefs) ?? '',
        JSON.stringify(e.contentProvenance) ?? '',
        JSON.stringify(e.cardDisplay) ?? '',
      ]
        .map(escape)
        .join('\t'),
    ),
  ].join('\n');
}

import type { Entry, LanguageMode } from '../domain/types';
import type { PathSegment } from '../domain/user-layer';
import { posLabel } from '../i18n';

// Human-readable descriptions of entry fields and values, for review and edit history.
const fieldNames: Record<string, [string, string]> = {
  zh: ['中文', 'Chinese'],
  en: ['英文', 'English'],
  short: ['简释', 'short'],
  detail: ['详释', 'detail'],
  usage: ['用法', 'usage'],
  text: ['法语', 'French'],
  translations: ['翻译', 'translation'],
  note: ['说明', 'note'],
  notes: ['说明', 'notes'],
  gender: ['性别', 'gender'],
  pos: ['词性', 'part of speech'],
  ipa: ['音标', 'IPA'],
  word: ['词形', 'headword'],
  auxiliary: ['助动词', 'auxiliary'],
  pastParticiple: ['过去分词', 'past participle'],
  presentParticiple: ['现在分词', 'present participle'],
  rows: ['变位', 'forms'],
  specialNotes: ['特别提示', 'special notes'],
  features: ['特殊属性', 'features'],
  sources: ['来源', 'sources'],
  headword: ['词头', 'headword'],
};
const itemNames: Record<string, [string, string]> = {
  senses: ['义项', 'Sense'],
  examples: ['例句', 'Example'],
  collocations: ['搭配', 'Collocation'],
  forms: ['词形', 'Form'],
  conjugations: ['变位表', 'Conjugation table'],
  relations: ['关系', 'Relation'],
  families: ['词族', 'Family'],
};

// "动词 · 义项 1 · 中文 · 简释" from the stable-id path of an edit.
export function describePath(path: PathSegment[], entry: Entry | undefined, mode: LanguageMode) {
  const en = mode === 'enOnly' ? 1 : 0,
    parts: string[] = [];
  let node: unknown = entry;
  path.forEach((segment, i) => {
    if (typeof segment === 'string') {
      if (fieldNames[segment]) parts.push(fieldNames[segment][en]);
      node = (node as Record<string, unknown> | undefined)?.[segment];
      return;
    }
    const list = Array.isArray(node) ? (node as { id?: string; key?: string }[]) : [];
    const index = list.findIndex((x) => (x.id ?? x.key) === segment.id);
    const owner = path[i - 1] as string;
    if (owner === 'groups') {
      const group = list[index] as { pos?: string } | undefined;
      if (group?.pos) parts.push(posLabel(group.pos, mode));
    } else if (itemNames[owner])
      parts.push(`${itemNames[owner][en]}${index >= 0 ? ' ' + (index + 1) : ''}`);
    node = list[index];
  });
  return parts.join(' · ');
}
export function show(value: unknown, none: string) {
  if (value === undefined || value === null || value === '') return none;
  if (typeof value === 'string') return value;
  const v = value as { text?: string; short?: string };
  return v.text ?? v.short ?? JSON.stringify(value).slice(0, 160);
}

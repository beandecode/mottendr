import type { AppState, Entry } from '../domain/types';
import { localeFor } from '../domain/types';
import { collectionOf } from '../domain/collections';
import { diffContent } from '../domain/layers';
import { entryEdition, packEntries, senseOrigin } from '../domain/pack';
import { posLabel, translator, type Label } from '../i18n';

const originLabels: Record<string, Label> = {
  source: 'originSource',
  'ai-edited': 'originAi',
  'human-checked': 'originHuman',
};

// Where each sense's wording comes from. Collapsed by default: content is trusted
// for study, and this is here for when the learner wants to know.
export default function ContentOrigin({ state, entry }: { state: AppState; entry: Entry }) {
  const mode = state.prefs.mode,
    t = translator(mode),
    locale = localeFor(mode);
  const builtIn = packEntries().get(entry.id);
  const edits = builtIn ? diffContent(builtIn, entry) : [];
  const edited = (senseId: string) =>
    edits.some(
      (p) =>
        JSON.stringify(p.path).includes(JSON.stringify(senseId)) ||
        (p.op === 'add' && (p.item as { id?: string })?.id === senseId),
    );
  return (
    <details className="content-origin" data-testid="content-origin">
      <summary>{t('contentOrigin')}</summary>
      {builtIn && (
        <p>
          {t('entryEdition')}: {entryEdition(entry.id) ?? t('entryEditionNone')}
        </p>
      )}
      {builtIn ? (
        <ul>
          {entry.groups.flatMap((g) =>
            g.senses.map((s) => (
              <li key={s.id}>
                {posLabel(g.pos, mode)} · {s.definitions[locale].short || s.definitions.zh.short}
                {' — '}
                {t(originLabels[senseOrigin(s.id)])}
                {edited(s.id) && `，${t('originEdited')}`}
              </li>
            )),
          )}
        </ul>
      ) : (
        <p>{t(collectionOf(entry) === 'dictionary' ? 'originDictionary' : 'originOwn')}</p>
      )}
    </details>
  );
}

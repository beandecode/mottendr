import { useState } from 'react';
import { Check, Download, FileUp, Sparkles } from 'lucide-react';
import type { AppState, Entry } from '../domain/types';
import { localeFor } from '../domain/types';
import { packEntries } from '../domain/pack';
import { ensureTasks } from '../domain/learning';
import {
  blankEntry,
  commitImport,
  entryKey,
  parseEntries,
  validateBackup,
  type ImportPreview,
} from '../domain/import-export';
import { shortDefinition } from '../domain/lexicon';
import { EntryEditor } from '../components/Lexicon';
import { translator, type Label } from '../i18n';
import { download } from '../app/download';
import type { Mutate } from '../app/types';
import { Stat } from '../app/ui';
import { isDemo } from '../app/demo';

export type ToolTab = 'manual' | 'import' | 'restore';
// Manual entry, file import and backup restore, opened in a sheet from the dictionary's menu.
export default function AddTools({
  state,
  mutate,
  busy,
  notify,
  restore,
  initialTab = 'manual',
}: {
  state: AppState;
  mutate: Mutate;
  busy: boolean;
  notify: (n: Label) => void;
  restore: (d: AppState) => void;
  initialTab?: ToolTab;
}) {
  const t = translator(state.prefs.mode),
    locale = localeFor(state.prefs.mode);
  const [tab, setTab] = useState<ToolTab>(initialTab),
    [text, setText] = useState(''),
    [format, setFormat] = useState<'json' | 'csv' | 'tsv'>('json'),
    [result, setResult] = useState<ImportPreview | null>(null);
  const [newEntry, setNewEntry] = useState(blankEntry),
    [editingImport, setEditingImport] = useState<Entry | null>(null);
  async function readFile(file: File) {
    if (file.size > 100_000_000) {
      notify('fileError');
      return;
    }
    try {
      const content = await file.text();
      if (tab === 'restore') {
        restore(validateBackup(JSON.parse(content)));
        return;
      }
      const f = file.name.endsWith('.tsv') ? 'tsv' : file.name.endsWith('.csv') ? 'csv' : 'json';
      setFormat(f);
      setText(content);
      setEditingImport(null);
      setResult(parseEntries(content, f, state.entries));
    } catch {
      notify('fileError');
    }
  }
  return (
    <>
      <p className="muted add-intro">{t('addDesc')}</p>
      <div className="generation-reserved">
        <Sparkles size={18} />
        <span>{t('generationReserved')}</span>
      </div>
      <div className="filter-tabs">
        {(isDemo ? (['manual'] as const) : (['manual', 'import', 'restore'] as const)).map(
          (key) => (
            <button
              className={tab === key ? 'active' : ''}
              key={key}
              onClick={() => {
                setTab(key);
                setResult(null);
                setEditingImport(null);
                setText('');
              }}
            >
              {t(key)}
            </button>
          ),
        )}
      </div>
      <section className="content-panel add-panel">
        {tab === 'manual' ? (
          <EntryEditor
            key={`${newEntry.id}-${locale}`}
            entry={newEntry}
            state={state}
            busy={busy}
            notify={notify}
            save={async (e) => {
              if (state.entries.some((old) => !old.archived && entryKey(old) === entryKey(e))) {
                notify('duplicates');
                return false;
              }
              const ok = await mutate((d) => {
                if (d.entries.some((old) => !old.archived && entryKey(old) === entryKey(e)))
                  throw new Error('DUPLICATE');
                d.entries.push(e);
                ensureTasks(d, 'recognition');
              });
              if (ok) {
                setNewEntry(blankEntry());
                notify('saved');
              }
              return ok;
            }}
          />
        ) : (
          <>
            <div className="upload-area">
              <FileUp size={30} />
              <h3>{t(tab === 'restore' ? 'restore' : 'import')}</h3>
              <p>{t(tab === 'restore' ? 'backupHint' : 'formatHint')}</p>
              <label className="secondary-button file-button">
                {t('pickFile')}
                <input
                  type="file"
                  accept={tab === 'restore' ? '.json' : '.json,.csv,.tsv'}
                  onChange={(e) => {
                    if (e.target.files?.[0]) readFile(e.target.files[0]);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
            {tab === 'import' && (
              <>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => {
                    const content = JSON.stringify([...packEntries().values()]);
                    setFormat('json');
                    setText(content);
                    setEditingImport(null);
                    setResult(parseEntries(content, 'json', state.entries));
                  }}
                >
                  {t('loadBuiltin')}
                </button>
                <p className="muted">{t('builtinHint')}</p>
                <div className="button-row">
                  <button
                    className="text-button"
                    onClick={() =>
                      download(
                        'francais-template.tsv',
                        'word\tzh\ten\tdetail_zh\tdetail_en\texample\ttranslation_zh\ttranslation_en\tipa\tpos\tgender\ttags\tsource\niris\t鸢尾花\tiris\t一种花。\tA flowering plant.\tVoici un iris.\t这是一朵鸢尾花。\tHere is an iris.\t\tnoun\tm\tFlowers\tUser notes',
                        'text/tab-separated-values',
                      )
                    }
                  >
                    <Download size={15} />
                    {t('template')}
                  </button>
                  <select
                    aria-label={state.prefs.mode === 'enOnly' ? 'File format' : '文件格式'}
                    value={format}
                    onChange={(e) => {
                      setFormat(e.target.value as typeof format);
                      setResult(null);
                      setEditingImport(null);
                    }}
                  >
                    <option>json</option>
                    <option>csv</option>
                    <option>tsv</option>
                  </select>
                </div>
                <label>
                  {t('paste')}
                  <textarea
                    className="code-input"
                    value={text}
                    onChange={(e) => {
                      setText(e.target.value);
                      setResult(null);
                      setEditingImport(null);
                    }}
                    rows={5}
                    placeholder={
                      state.prefs.mode === 'enOnly'
                        ? '[{"word":"salut","en":"hi"}]'
                        : '[{"word":"salut","zh":"你好","en":"hi"}]'
                    }
                  />
                </label>
                <button
                  className="secondary-button"
                  disabled={!text.trim()}
                  onClick={() => {
                    try {
                      setEditingImport(null);
                      setResult(parseEntries(text, format, state.entries));
                    } catch {
                      notify('fileError');
                    }
                  }}
                >
                  {t('preview')}
                </button>
                {result && (
                  <div className="import-preview">
                    <div className="mini-stats">
                      <Stat value={result.entries.length} label={t('importCount')} />
                      <Stat value={result.duplicates} label={t('duplicateCount')} />
                      <Stat value={result.errors.length} label={t('invalidRows')} />
                    </div>
                    {editingImport ? (
                      <div className="import-editor">
                        <button className="text-button" onClick={() => setEditingImport(null)}>
                          {t('cancel')}
                        </button>
                        <EntryEditor
                          key={editingImport.id}
                          entry={editingImport}
                          state={{ ...state, entries: [...state.entries, ...result.entries] }}
                          busy={busy}
                          notify={notify}
                          save={async (edited) => {
                            setResult((r) =>
                              r
                                ? {
                                    ...r,
                                    entries: r.entries.map((e) =>
                                      e.id === edited.id ? edited : e,
                                    ),
                                  }
                                : r,
                            );
                            setEditingImport(null);
                            return true;
                          }}
                        />
                      </div>
                    ) : (
                      <div className="import-draft-list">
                        {result.entries.map((e) => (
                          <div className="preview-row" key={e.id}>
                            <strong>{e.word}</strong>
                            <span>{shortDefinition(e, locale) || t('missing')}</span>
                            <button
                              className="text-button"
                              aria-label={`${t('edit')}: ${e.word}`}
                              onClick={() => setEditingImport(e)}
                            >
                              {t('edit')}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    {result.errors.length > 0 && (
                      <p className="warning-text">
                        {t('invalidRows')}: {result.errors.map((e) => e.row).join(', ')}
                      </p>
                    )}
                    <button
                      className="primary-button"
                      disabled={busy || !result.entries.length || !!editingImport}
                      onClick={async () => {
                        if (await mutate((d) => commitImport(d, result.entries))) {
                          setResult(null);
                          setText('');
                          notify('saved');
                        }
                      }}
                    >
                      {t('confirmImport')}
                      <Check size={17} />
                    </button>
                  </div>
                )}
              </>
            )}
            {tab === 'restore' && (
              <>
                <p className="muted">{t('restoreHint')}</p>
                <label>
                  {t('paste')}
                  <textarea
                    className="code-input"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={5}
                    placeholder={'{"schemaVersion":2,...}'}
                  />
                </label>
                <button
                  className="secondary-button"
                  disabled={!text.trim()}
                  onClick={() => {
                    try {
                      restore(validateBackup(JSON.parse(text)));
                    } catch {
                      notify('fileError');
                    }
                  }}
                >
                  {t('restorePreview')}
                </button>
              </>
            )}
          </>
        )}
      </section>
      {state.importBatches.length > 0 && (
        <section className="content-panel import-batches">
          <h3>{t('batches')}</h3>
          <p className="muted">{t('revertHint')}</p>
          {state.importBatches
            .slice(-5)
            .reverse()
            .map((batch) => (
              <div className="preview-row" key={batch.id}>
                <span>
                  {new Date(batch.at).toLocaleDateString(
                    state.prefs.mode === 'enOnly' ? 'en-US' : 'zh-CN',
                  )}{' '}
                  · {batch.entryIds.length} {t('words')}
                </span>
                <button
                  className="text-button"
                  disabled={
                    busy ||
                    batch.entryIds.every((id) => state.entries.find((e) => e.id === id)?.archived)
                  }
                  onClick={() =>
                    mutate((d) => {
                      d.entries
                        .filter((e) => batch.entryIds.includes(e.id))
                        .forEach((e) => {
                          e.archived = true;
                        });
                      if (d.session) {
                        const keep = (id: string) =>
                          !d.tasks.some(
                            (task) => task.id === id && batch.entryIds.includes(task.entryId),
                          );
                        d.session.queue = d.session.queue.filter(keep);
                        d.session.pending = d.session.pending.filter(keep);
                      }
                    })
                  }
                >
                  {t('revert')}
                </button>
              </div>
            ))}
        </section>
      )}
    </>
  );
}

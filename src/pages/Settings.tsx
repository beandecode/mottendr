import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Check,
  Download,
  Flag,
  Globe2,
  Layers,
  Leaf,
  Settings,
  Volume2,
} from 'lucide-react';
import type { AppState, LanguageMode, LegacyState, NewWordOrder } from '../domain/types';
import { ensureTasks } from '../domain/learning';
import { continuousOptions } from '../domain/study-preferences';
import { FONT_SCALES } from '../domain/migration';
import { cardControls, useTouchInput } from '../platform/input';
import type { VoiceInfo } from '../platform/speech';
import { translator, type Label } from '../i18n';
import { backup, backupText, download } from '../app/download';
import type { Mutate } from '../app/types';
import { storage } from '../app/useAppState';
import { NumberField, SettingSwitch } from '../app/ui';
import ContentReview from './ContentReview';
import IssueList from './IssueList';
import { exportIssues, openIssues } from '../domain/issues';

const NEW_WORD_ORDER_LABELS: Record<NewWordOrder, Label> = {
  list: 'newWordOrderList',
  frequency: 'newWordOrderFrequency',
  shuffle: 'newWordOrderShuffle',
};

// How often the page was hidden since it started. Switching native tabs must not do that.
let hiddenCount = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') hiddenCount++;
});

// Reads the window size and the safe-area insets the device reports, to see how much of a
// foldable or cover screen the page really gets.
function ScreenInfo({ en }: { en: boolean }) {
  const [info, setInfo] = useState('');
  useEffect(() => {
    const probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;visibility:hidden;pointer-events:none;' +
      'padding:env(safe-area-inset-top) env(safe-area-inset-right) ' +
      'env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.append(probe);
    const read = () => {
      const css = getComputedStyle(probe),
        vv = window.visualViewport,
        standalone =
          window.matchMedia('(display-mode: standalone)').matches ||
          (navigator as Navigator & { standalone?: boolean }).standalone === true;
      setInfo(
        [
          `window ${window.innerWidth}×${window.innerHeight}`,
          `visual ${Math.round(vv?.width ?? 0)}×${Math.round(vv?.height ?? 0)} @${(vv?.scale ?? 1).toFixed(2)}`,
          `screen ${screen.width}×${screen.height} @${window.devicePixelRatio}x`,
          `safe T${css.paddingTop} R${css.paddingRight} B${css.paddingBottom} L${css.paddingLeft}`,
          `${standalone ? 'standalone' : 'browser'} · ${screen.orientation?.type ?? 'n/a'}`,
          `page ${Math.round(performance.timeOrigin)} · hidden ${hiddenCount}x`,
        ].join('\n'),
      );
    };
    read();
    window.addEventListener('resize', read);
    window.visualViewport?.addEventListener('resize', read);
    return () => {
      window.removeEventListener('resize', read);
      window.visualViewport?.removeEventListener('resize', read);
      probe.remove();
    };
  }, []);
  return (
    <p className="muted" data-testid="screen-info" style={{ whiteSpace: 'pre-line' }}>
      {en ? 'Screen: ' : '屏幕信息：'}
      {'\n'}
      {info}
    </p>
  );
}

export default function SettingsPanel({
  state,
  mutate,
  busy,
  voices,
  speak,
  speaking,
  speechDescription,
  openEdit,
  offline,
}: {
  state: AppState;
  mutate: Mutate;
  busy: boolean;
  voices: VoiceInfo[];
  speak: (s: string) => void;
  speaking: boolean;
  speechDescription: string;
  openEdit: (entryId: string, issueId?: string, senseId?: string) => void;
  // Shown here because the page footer is hidden on phones.
  offline: { label: string; failed: boolean; retry: () => void };
}) {
  const p = state.prefs,
    t = translator(p.mode),
    canSwipe = useTouchInput(),
    controls = cardControls(p, canSwipe);
  const activeControlCount = Object.values(controls).filter(Boolean).length,
    continuation = continuousOptions(p);
  const changeControl = (key: 'swipeEnabled' | 'gridEnabled' | 'buttonsEnabled', value: boolean) =>
    mutate((d) => {
      Object.assign(d.prefs, {
        swipeEnabled: controls.swipe,
        gridEnabled: controls.grid,
        buttonsEnabled: controls.buttons,
        [key]: value,
      });
    });
  const french = voices
    .filter((v) => v.lang.startsWith('fr'))
    .filter(
      (v, i, all) => all.findIndex((other) => other.name === v.name && other.lang === v.lang) === i,
    );
  const [showBackup, setShowBackup] = useState(false);
  const ready = performance.getEntriesByName('francais-ready')[0],
    startup = ready ? Math.round(ready.startTime) : undefined;
  const [migrationBackup, setMigrationBackup] = useState<LegacyState | null>(null),
    [contentBackup, setContentBackup] = useState<AppState | null>(null),
    [storageBackup, setStorageBackup] = useState<AppState | LegacyState | null>(null),
    [restoreBackup, setRestoreBackup] = useState<AppState | null>(null);
  useEffect(() => {
    storage
      .readMigrationBackup()
      .then(setMigrationBackup)
      .catch(() => {});
    storage
      .readContentBackup()
      .then(setContentBackup)
      .catch(() => {});
    storage
      .readStorageSplitBackup()
      .then(setStorageBackup)
      .catch(() => {});
    storage
      .readRestoreBackup()
      .then(setRestoreBackup)
      .catch(() => {});
  }, []);
  return (
    <div className="settings-panel">
      <p className="settings-intro">{t('preferences')}</p>
      <ContentReview state={state} mutate={mutate} busy={busy} />
      {!!state.issues?.length && (
        <section data-testid="issues-section">
          <h3>
            <Flag size={18} />
            {t('issuesTitle')} · {openIssues(state).length}
          </h3>
          <p className="muted">{t('issuesHint')}</p>
          <IssueList state={state} mutate={mutate} busy={busy} openEdit={openEdit} />
          <div className="button-row">
            <button
              className="text-button"
              onClick={() => download('francais-issues.json', exportIssues(state, 'json'))}
            >
              {t('exportIssuesJson')}
            </button>
            <button
              className="text-button"
              onClick={() =>
                download(
                  'francais-issues.tsv',
                  exportIssues(state, 'tsv'),
                  'text/tab-separated-values',
                )
              }
            >
              {t('exportIssuesTsv')}
            </button>
          </div>
        </section>
      )}
      <section>
        <h3>
          <Globe2 size={18} />
          {t('language')}
        </h3>
        <div className="language-options">
          {(['zhOnly', 'zhEnAssist', 'enOnly'] as LanguageMode[]).map((mode) => (
            <label key={mode} className={mode === p.mode ? 'selected' : ''}>
              <input
                type="radio"
                name="language"
                value={mode}
                checked={p.mode === mode}
                disabled={busy}
                onChange={() =>
                  mutate((d) => {
                    d.prefs.mode = mode;
                    ensureTasks(d, d.prefs.direction);
                  })
                }
              />
              <span>{t(mode)}</span>
              {mode === p.mode && <Check size={17} />}
            </label>
          ))}
        </div>
        <p className="muted">{t('languageHint')}</p>
      </section>
      <section>
        <h3>
          <Settings size={18} />
          {t('display')}
        </h3>
        <label>
          {t('fontSize')}
          <select
            aria-label={t('fontSize')}
            data-testid="font-scale"
            value={p.fontScale ?? 1}
            disabled={busy}
            onChange={(e) =>
              mutate((d) => {
                d.prefs.fontScale = Number(e.target.value);
              })
            }
          >
            {FONT_SCALES.map((scale) => (
              <option key={scale} value={scale}>
                {Math.round(scale * 100)}%{scale === 1 ? ` · ${t('defaultSize')}` : ''}
              </option>
            ))}
          </select>
        </label>
        <p className="muted">{t('fontHint')}</p>
        <SettingSwitch
          label={t('showGender')}
          testId="show-gender"
          checked={p.showGender !== false}
          disabled={busy}
          change={(value) =>
            mutate((d) => {
              d.prefs.showGender = value;
            })
          }
        />
        <SettingSwitch
          label={t('showArticles')}
          testId="show-articles"
          checked={p.showArticles === true}
          disabled={busy}
          change={(value) =>
            mutate((d) => {
              d.prefs.showArticles = value;
            })
          }
        />
        <p className="muted">{t('articleHint')}</p>
      </section>
      <section>
        <h3>
          <Layers size={18} />
          {t('today')}
        </h3>
        <label>
          {t('newWordOrder')}
          <select
            aria-label={t('newWordOrder')}
            data-testid="new-word-order"
            value={p.newWordOrder ?? 'list'}
            disabled={busy}
            onChange={(e) =>
              mutate((d) => {
                d.prefs.newWordOrder = e.target.value as NewWordOrder;
              })
            }
          >
            {(['list', 'frequency', 'shuffle'] as const).map((order) => (
              <option key={order} value={order}>
                {t(NEW_WORD_ORDER_LABELS[order])}
              </option>
            ))}
          </select>
        </label>
        <p className="muted">{t('newWordOrderHint')}</p>
        <SettingSwitch
          label={t('continuousLearning')}
          testId="continuous-learning"
          checked={continuation.enabled}
          disabled={busy}
          change={(value) =>
            mutate((d) => {
              d.prefs.continuousLearning = value;
            })
          }
        />
        <p className="muted">{t('continuousHint')}</p>
        <div className="form-grid two">
          {(
            [
              { key: 'activeTaskLimit', label: 'activeTaskLimit', value: continuation.activeLimit },
              { key: 'refillLimit', label: 'refillLimit', value: continuation.refillLimit },
            ] as const
          ).map(({ key, label, value }) => (
            <NumberField
              key={key}
              label={t(label)}
              testId={key}
              value={value}
              min={1}
              max={200}
              disabled={!continuation.enabled}
              commit={(n) =>
                mutate((d) => {
                  d.prefs[key] = n;
                })
              }
            />
          ))}
        </div>
        <p className="muted">{t('continuousLimitsHint')}</p>
        <div className="form-grid two">
          <NumberField
            label={t('daily')}
            testId="newLimit"
            value={p.newLimit}
            min={0}
            max={100}
            commit={(n) =>
              mutate((d) => {
                d.prefs.newLimit = n;
              })
            }
          />
          <NumberField
            label={t('sessionLimit')}
            testId="sessionLimit"
            value={p.sessionLimit}
            min={1}
            max={200}
            disabled={continuation.enabled}
            commit={(n) =>
              mutate((d) => {
                d.prefs.sessionLimit = n;
              })
            }
          />
        </div>
        <label>
          {t('target')}
          <select
            value={p.retention}
            disabled={busy}
            onChange={(e) =>
              mutate((d) => {
                d.prefs.retention = Number(e.target.value);
              })
            }
          >
            {[0.8, 0.85, 0.9, 0.95, 0.97].map((n) => (
              <option key={n} value={n}>
                {Math.round(n * 100)}%
              </option>
            ))}
          </select>
        </label>
        <p className="muted">{t('retentionHint')}</p>
      </section>
      <section>
        <h3>
          <Volume2 size={18} />
          {t('speech')}
        </h3>
        {(
          ['autoSpeakQuestion', 'autoSpeakRecognitionAnswer', 'autoSpeakProductionAnswer'] as const
        ).map((key, i) => (
          <SettingSwitch
            key={key}
            label={t(
              (['autoQuestion', 'autoRecognitionAnswer', 'autoProductionAnswer'] as const)[i],
            )}
            testId={key}
            checked={p[key] === true}
            disabled={busy}
            change={(value) =>
              mutate((d) => {
                d.prefs[key] = value;
              })
            }
          />
        ))}
        <p className="muted">{t('autoSpeechHint')}</p>
        <label>
          {t('voice')}
          <select
            disabled={busy || !french.length}
            value={french.some((v) => v.name === p.voice) ? p.voice : ''}
            onChange={(e) =>
              mutate((d) => {
                d.prefs.voice = e.target.value;
              })
            }
          >
            <option value="">
              {french.length ? (p.mode === 'enOnly' ? 'Automatic' : '自动选择') : t('unavailable')}
            </option>
            {french.map((v) => (
              <option key={`${v.name}-${v.lang}`} value={v.name}>
                {v.name} · {v.lang}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('rate')}
          <select
            value={p.speechRate}
            disabled={busy}
            onChange={(e) =>
              mutate((d) => {
                d.prefs.speechRate = Number(e.target.value);
              })
            }
          >
            {[0.6, 0.75, 0.85, 1, 1.25].map((n) => (
              <option key={n} value={n}>
                {n}×
              </option>
            ))}
          </select>
        </label>
        <button
          className="secondary-button"
          onClick={() => speak('Bonjour, je voudrais apprendre le français.')}
        >
          <Volume2 size={17} />
          {t(speaking ? 'stop' : 'testSpeech')}
        </button>
        <p className="speech-status" data-testid="settings-speech-source">
          <strong>{t('currentSpeech')}:</strong> {speechDescription}
        </p>
        <p className="muted">{t('speechHint')}</p>
      </section>
      <section>
        <h3>
          <ArrowRight size={18} />
          {t('cardInput')}
        </h3>
        <p className="muted">{t(canSwipe ? 'inputDefaultTouch' : 'inputDefaultPointer')}</p>
        {(
          [
            { key: 'swipeEnabled', control: 'swipe', label: 'enableSwipe' },
            { key: 'gridEnabled', control: 'grid', label: 'enableGrid' },
            { key: 'buttonsEnabled', control: 'buttons', label: 'enableButtons' },
          ] as const
        ).map(({ key, control, label }) => (
          <SettingSwitch
            key={key}
            label={t(label)}
            testId={key}
            checked={controls[control]}
            disabled={busy || (controls[control] && activeControlCount === 1)}
            change={(value) => changeControl(key, value)}
          />
        ))}
        <button
          className="text-button"
          disabled={busy}
          onClick={() =>
            mutate((d) => {
              delete d.prefs.swipeEnabled;
              delete d.prefs.gridEnabled;
              delete d.prefs.buttonsEnabled;
            })
          }
        >
          {t('inputReset')}
        </button>
        <p className="muted">{t('inputMinimum')}</p>
        <h4>{t('directionMapping')}</h4>
        <div className="swipe-settings">
          {(['left', 'right', 'up', 'down'] as const).map((direction, i) => (
            <label key={direction}>
              {t(direction)}
              <select
                disabled={busy}
                value={p.swipeMap[i]}
                onChange={(e) =>
                  mutate((d) => {
                    const value = Number(e.target.value),
                      other = d.prefs.swipeMap.indexOf(value),
                      old = d.prefs.swipeMap[i];
                    d.prefs.swipeMap[i] = value;
                    d.prefs.swipeMap[other] = old;
                  })
                }
              >
                {(['again', 'hard', 'good', 'easy'] as const).map((grade, j) => (
                  <option key={grade} value={j + 1}>
                    {t(grade)}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </section>
      <section>
        <h3>
          <Download size={18} />
          {t('migration')}
        </h3>
        <p className="muted">{t('migrationHint')}</p>
        {startup !== undefined && (
          <p className="muted" data-testid="startup-time">
            {t('startupTime')}: {startup} ms
          </p>
        )}
        <button className="secondary-button" onClick={() => backup(state)}>
          <Download size={16} />
          {t('backup')}
        </button>
        {migrationBackup && (
          <button
            className="text-button"
            onClick={() =>
              download('francais-before-schema-2.json', JSON.stringify(migrationBackup, null, 2))
            }
          >
            {t('migrationBackup')}
          </button>
        )}
        {contentBackup && (
          <button
            className="text-button"
            onClick={() =>
              download(
                'francais-before-content-update.json',
                JSON.stringify(contentBackup, null, 2),
              )
            }
          >
            {p.mode === 'enOnly' ? 'Export pre-content-update backup' : '导出内容更新前备份'}
          </button>
        )}
        {storageBackup && (
          <button
            className="text-button"
            onClick={() =>
              download('francais-before-storage-split.json', JSON.stringify(storageBackup, null, 2))
            }
          >
            {p.mode === 'enOnly' ? 'Export pre-storage-upgrade backup' : '导出存储升级前备份'}
          </button>
        )}
        {restoreBackup && (
          <button
            className="text-button"
            onClick={() =>
              download('francais-before-restore.json', JSON.stringify(restoreBackup, null, 2))
            }
          >
            {p.mode === 'enOnly' ? 'Export pre-restore backup' : '导出恢复前备份'}
          </button>
        )}
        <button className="text-button backup-text-toggle" onClick={() => setShowBackup((v) => !v)}>
          {t('backupText')}
        </button>
        {showBackup && (
          <label>
            {t('backupText')}
            <textarea
              aria-label={t('backupText')}
              readOnly
              className="code-input"
              rows={6}
              value={backupText(state)}
            />
            <span className="muted">{t('backupTextHint')}</span>
          </label>
        )}
      </section>
      <section className="settings-about" data-testid="settings-about">
        <h3>
          <Leaf size={18} />
          {t('about')}
        </h3>
        <p className="muted">
          {t('localDetails')} · {offline.label}
        </p>
        {offline.failed && (
          <button className="text-button" onClick={offline.retry}>
            {t('offlineRetry')}
          </button>
        )}
        <ScreenInfo en={p.mode === 'enOnly'} />
      </section>
    </div>
  );
}

import { useEffect, useLayoutEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  BookOpen,
  Home,
  Leaf,
  Library,
  Loader2,
  RotateCcw,
  Settings,
  TrendingUp,
  X,
} from 'lucide-react';
import type { Direction, Entry } from './domain/types';
import { localeFor } from './domain/types';
import { availableTasks, beginSession, ensureTasks } from './domain/learning';
import { TOP_2000 } from './domain/collections';
import { addDictionaryEntry, dictionaryRecord } from './domain/dictionary';
import { entryKey } from './domain/import-export';
import { closeIssue } from './domain/issues';
import { undoable, undoContentChange } from './domain/content-log';
import DictionaryPage, { DictionaryAttribution, DictionarySheet } from './components/Dictionary';
import { EntryEditor } from './components/Lexicon';
import { BrandMark, Wordmark } from './components/Brand';
import { ConflictError, dumpLocalDatabase } from './platform/storage';
import { download } from './app/download';
import { speechSource } from './platform/speech';
import {
  applyOfflineUpdate,
  getOfflineStatus,
  registerOffline,
  resetOffline,
  subscribeOfflineStatus,
} from './platform/offline';
import { translator, type Label } from './i18n';
import type { Modal, View } from './app/types';
import { storage, useAppState } from './app/useAppState';
import { useSpeech } from './app/useSpeech';
import { useNow } from './app/useNow';
import { useContent } from './app/useContent';
import { Dialog, Empty } from './app/ui';
import Today from './pages/Today';
import LibraryPage from './pages/Library';
import AddTools from './pages/AddTools';
import EntryDetail, { EntryMenu } from './pages/EntryDetail';
import Study from './pages/Study';
import Activity from './pages/Activity';
import SettingsPanel from './pages/Settings';
import RestorePreview from './pages/RestorePreview';
import IssueForm from './pages/IssueForm';

export default function App() {
  const { state, bootError, busy, mutate, notice, setNotice } = useAppState();
  const { speak, stop, speaking, voices } = useSpeech(state?.prefs, () => setNotice('ttsError'));
  const [view, setView] = useState<View>('today'),
    [modal, setModal] = useState<Modal>(null);
  const [scope, setScope] = useState(TOP_2000);
  const [updateReady, setUpdateReady] = useState(false);
  const [lastEdited, setLastEdited] = useState<string | null>(null);
  const [offlineStatus, setOfflineStatus] = useState(getOfflineStatus);
  // Coarse clock for the due badge and Today/Activity; Study runs its own one-second clock.
  const now = useNow(30_000);
  // The dictionary loads in the background once the app is up.
  const dictionaryReady = useContent('dictionary');
  useEffect(() => subscribeOfflineStatus(setOfflineStatus), []);
  useEffect(() => {
    const updateAvailable = () => setUpdateReady(true);
    window.addEventListener('francais-update-ready', updateAvailable);
    return () => window.removeEventListener('francais-update-ready', updateAvailable);
  }, []);
  useEffect(stop, [view, state?.session?.queue[0], !!modal]);
  const navigate = (target: View) => {
    // Tapping the current tab again scrolls back to the top, as on iOS.
    if (target === view) {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    } else setView(target);
  };
  useEffect(() => {
    document.documentElement.lang = state?.prefs.mode === 'enOnly' ? 'en' : 'zh-CN';
  }, [state?.prefs.mode]);
  useEffect(() => {
    // Typography v3: 100% is the size that was 115% under v2 (itself 1.5× the original).
    document.documentElement.style.setProperty(
      '--ui-font-scale',
      String(1.725 * (state?.prefs.fontScale ?? 1)),
    );
  }, [state?.prefs.fontScale]);
  // Each page opens at its top instead of the previous page's scroll position.
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);
  // As on iOS, the top bar shows the page's name only after its large title scrolls under it.
  const [titleInBar, setTitleInBar] = useState(false);
  const loaded = Boolean(state);
  useEffect(() => {
    const heading = document.querySelector('main .page-heading h1');
    setTitleInBar(!heading);
    if (!heading || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setTitleInBar(!e.isIntersecting), {
      rootMargin: '-72px 0px 0px 0px',
    });
    io.observe(heading);
    return () => io.disconnect();
  }, [view, loaded, dictionaryReady]);
  const taskCandidates = useMemo(
    () => (state ? availableTasks(state, state.prefs.direction, scope) : []),
    [state, scope],
  );
  const dueCount = useMemo(
    () => taskCandidates.filter((task) => task.learnedAt && task.card.due <= now).length,
    [taskCandidates, now],
  );
  if (!state)
    return (
      <div className="boot">
        <BrandMark size={48} />
        <h1>
          <Wordmark />
        </h1>
        {bootError ? (
          <>
            <p>Storage unavailable · 存储不可用</p>
            <p className="boot-detail">{bootError}</p>
            <button onClick={() => location.reload()}>Retry / 重试</button>
            <button
              onClick={() =>
                void dumpLocalDatabase().then((text) =>
                  download(
                    `francais-raw-${new Date().toISOString().replaceAll(':', '-')}.json`,
                    text,
                  ),
                )
              }
            >
              Save raw data / 导出原始数据
            </button>
            {'serviceWorker' in navigator && (
              <button onClick={() => void resetOffline()}>Repair / 修复（保留学习数据）</button>
            )}
          </>
        ) : (
          <Loader2 className="spin" />
        )}
      </div>
    );
  const mode = state.prefs.mode,
    t = translator(mode),
    locale = localeFor(mode);
  const offlineLabel: Label = (
    {
      checking: 'offlinePreparing',
      ready: 'offlineReady',
      unsupported: 'offlineUnsupported',
      failed: 'offlineFailed',
      file: 'offlineFile',
    } as const
  )[offlineStatus];
  const source = speechSource(state.prefs, voices);
  const speechDescription = [
    t('browser'),
    t(
      source.location === 'device'
        ? 'deviceVoice'
        : source.location === 'online'
          ? 'onlineVoice'
          : source.location === 'unknown'
            ? 'unknownVoice'
            : 'noFrenchVoice',
    ),
  ].join(' · ');
  async function start(direction: Direction) {
    if (await mutate((d) => beginSession(d, direction, Date.now(), scope))) setView('study');
  }
  async function saveEdit(entry: Entry, issueId?: string) {
    if (
      state!.entries.some(
        (e) => e.id !== entry.id && !e.archived && entryKey(e) === entryKey(entry),
      )
    ) {
      setNotice('duplicates');
      return false;
    }
    const ok = await mutate((d) => {
      const index = d.entries.findIndex((e) => e.id === entry.id);
      if (index < 0 || d.entries[index].contentVersion !== entry.contentVersion)
        throw new ConflictError();
      const current = d.entries[index];
      d.entries[index] = {
        ...entry,
        favorite: current.favorite,
        suspended: current.suspended,
        archived: current.archived,
        localizedNotes: current.localizedNotes,
        contentVersion: entry.contentVersion + 1,
        updatedAt: Date.now(),
      };
      ensureTasks(d, 'recognition');
      if (issueId) closeIssue(d, issueId, 'resolved');
    });
    if (ok) {
      setLastEdited(entry.id);
      setNotice('entryEdited');
      setModal(null);
    }
    return ok;
  }
  const navItems = [
    ['today', Home],
    ['library', Library],
    ['dictionary', BookOpen],
    ['activity', TrendingUp],
  ] as const;
  const activeEntry =
    modal && (modal.type === 'detail' || modal.type === 'edit')
      ? state.entries.find((e) => e.id === modal.id)
      : modal?.type === 'issue'
        ? state.entries.find((e) => e.id === modal.entryId)
        : undefined;
  const activeRecord = modal?.type === 'dictionary' ? dictionaryRecord(modal.recordId) : undefined;
  const openEdit = (id: string, issueId?: string, senseId?: string) =>
    setModal({ type: 'edit', id, issueId, senseId });
  const settingsPanel = (
    <SettingsPanel
      speechDescription={speechDescription}
      state={state}
      mutate={mutate}
      busy={busy}
      voices={voices}
      speak={speak}
      speaking={speaking}
      openEdit={openEdit}
      offline={{
        label: t(offlineLabel),
        failed: offlineStatus === 'failed',
        retry: () => void registerOffline(),
      }}
    />
  );
  return (
    <>
      <div className="app-shell" data-view={view} inert={!!modal}>
        <aside className="sidebar">
          <a
            className="brand"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              navigate('today');
            }}
          >
            <span className="brand-icon">
              <BrandMark size={28} />
            </span>
            <span>
              <Wordmark />
              <span className="brand-small">
                {mode === 'enOnly' ? 'FRENCH, EVERY DAY' : '法语，每天一点'}
              </span>
            </span>
          </a>
          <div className="sidebar-caption">{t('tagline')}</div>
          <nav>
            {navItems.map(([key, Icon]) => (
              <button
                key={key}
                onClick={() => navigate(key)}
                className={
                  view === key || (view === 'study' && key === 'today')
                    ? 'nav-item active'
                    : 'nav-item'
                }
              >
                <Icon size={20} />
                {t(key)}
                {key === 'today' && dueCount > 0 && <span className="nav-count">{dueCount}</span>}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="local-indicator">
              <span />
              {t('local')}
            </div>
            <button className="nav-item" onClick={() => setModal({ type: 'settings' })}>
              <Settings size={19} />
              {t('settings')}
            </button>
            <small>{t(offlineLabel)}</small>
          </div>
        </aside>
        <div className="workspace">
          <header className="topbar" data-title={titleInBar ? 'shown' : 'hidden'}>
            <span className="breadcrumb">{view === 'study' ? t('today') : t(view)}</span>
            <div className="topbar-actions">
              {updateReady && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => void applyOfflineUpdate()}
                >
                  <RotateCcw size={16} />
                  {t('updateApp')}
                </button>
              )}
              <button
                className="icon-button mobile-settings"
                aria-label={t('settings')}
                onClick={() => setModal({ type: 'settings' })}
              >
                <Settings size={20} />
              </button>
              <span className="avatar">B</span>
            </div>
          </header>
          <main>
            {storage.persistence === 'memory' && (
              <div className="info-note" role="alert">
                {t('temporaryStorage')}
              </div>
            )}
            {offlineStatus === 'failed' && (
              <div className="info-note offline-note" role="status">
                {t('offlineFailed')}
                <button className="text-button" onClick={() => void registerOffline()}>
                  {t('offlineRetry')}
                </button>
              </div>
            )}
            <div className="view" key={view}>
              {view === 'today' && (
                <Today
                  state={state}
                  mutate={mutate}
                  busy={busy}
                  now={now}
                  scope={scope}
                  setScope={setScope}
                  dueCount={dueCount}
                  start={start}
                  resume={() => setView('study')}
                  openSettings={() => setModal({ type: 'settings' })}
                  openDictionary={() => setView('dictionary')}
                  openLibrary={() => setView('library')}
                />
              )}
              {view === 'library' && (
                <LibraryPage
                  state={state}
                  mutate={mutate}
                  busy={busy}
                  open={setModal}
                  now={now}
                  onStudy={async (tag) => {
                    setScope(tag);
                    if (await mutate((d) => beginSession(d, d.prefs.direction, Date.now(), tag)))
                      setView('study');
                  }}
                />
              )}
              {view === 'dictionary' && !dictionaryReady && (
                <Empty title={t('dictionaryLoading')} />
              )}
              {view === 'dictionary' && dictionaryReady && (
                <DictionaryPage
                  state={state}
                  openRecord={(recordId) => setModal({ type: 'dictionary', recordId })}
                  openTools={(tab) => setModal({ type: 'tools', tab })}
                  openAttribution={() => setModal({ type: 'attribution' })}
                />
              )}
              {view === 'study' && state.session && (
                <Study
                  key={state.session.id}
                  state={state}
                  mutate={mutate}
                  busy={busy}
                  onDetail={(id) => setModal({ type: 'detail', id })}
                  onIssue={(entryId, senseId) => setModal({ type: 'issue', entryId, senseId })}
                  speak={speak}
                  autoSpeak={(word) => void speak(word, 'fr-FR', true)}
                  blocked={!!modal}
                  speechReady={source.location !== 'unavailable'}
                  speaking={speaking}
                  finish={async () => {
                    if (
                      await mutate((d) => {
                        d.session = null;
                      })
                    )
                      setView('today');
                  }}
                />
              )}
              {view === 'study' && !state.session && (
                <Empty title={t('emptyQueue')}>
                  <button className="primary-button" onClick={() => setView('today')}>
                    {t('back')}
                  </button>
                </Empty>
              )}
              {view === 'activity' && <Activity state={state} now={now} open={setModal} />}
              {view === 'settings' && (
                <div className="settings-page">
                  <div className="page-heading">
                    <h1>{t('settings')}</h1>
                  </div>
                  {settingsPanel}
                </div>
              )}
            </div>
            <footer className="page-footer">
              <Leaf size={13} />
              <span>{t('localDetails')}</span>
              <span role="status" data-testid="offline-status">
                {t(offlineLabel)}
                {offlineStatus === 'failed' && (
                  <button className="text-button" onClick={() => void registerOffline()}>
                    {t('offlineRetry')}
                  </button>
                )}
              </span>
              <span className="speech-status" data-testid="speech-source">
                {t('currentSpeech')}: {speechDescription}
              </span>
            </footer>
          </main>
        </div>
        <nav
          className="mobile-nav"
          style={
            {
              '--tab': Math.max(
                0,
                navItems.findIndex(([key]) => key === (view === 'study' ? 'today' : view)),
              ),
            } as CSSProperties
          }
        >
          <span className="nav-indicator" aria-hidden="true" />
          {navItems.map(([key, Icon]) => (
            <button
              key={key}
              onClick={() => navigate(key)}
              className={view === key || (view === 'study' && key === 'today') ? 'active' : ''}
            >
              <Icon size={21} />
              <span>{t(key)}</span>
            </button>
          ))}
        </nav>
      </div>
      {modal && (
        <Dialog
          closeLabel={t('close')}
          title={
            modal.type === 'settings'
              ? t('settings')
              : modal.type === 'restore'
                ? t('restore')
                : modal.type === 'issue'
                  ? `${t('issueTitle')} · ${activeEntry?.word ?? ''}`
                  : modal.type === 'tools'
                    ? t('toolsTitle')
                    : modal.type === 'attribution'
                      ? t('attribution')
                      : (activeRecord?.word ?? activeEntry?.word ?? t('detail'))
          }
          close={() => setModal(null)}
          hideTitle={modal.type === 'detail' || modal.type === 'dictionary'}
          actions={
            modal.type === 'detail' && activeEntry ? (
              <EntryMenu
                entry={activeEntry}
                state={state}
                mutate={mutate}
                edit={() => setModal({ type: 'edit', id: activeEntry.id })}
                report={() => setModal({ type: 'issue', entryId: activeEntry.id })}
              />
            ) : undefined
          }
        >
          {modal.type === 'settings' && settingsPanel}
          {modal.type === 'detail' && activeEntry && (
            <EntryDetail
              key={`${activeEntry.id}:${locale}`}
              entry={activeEntry}
              state={state}
              mutate={mutate}
              busy={busy}
              speak={speak}
              openLinked={(id) => setModal({ type: 'detail', id })}
              openEdit={openEdit}
            />
          )}
          {modal.type === 'dictionary' && activeRecord && (
            <DictionarySheet
              key={activeRecord.id}
              state={state}
              record={activeRecord}
              busy={busy}
              speak={speak}
              add={async (record) => {
                if (await mutate((d) => addDictionaryEntry(d, record, locale))) {
                  setScope('dictionary');
                  setNotice('saved');
                }
              }}
              openLearning={(id) => setModal({ type: 'detail', id })}
            />
          )}
          {modal.type === 'tools' && (
            <AddTools
              key={modal.tab}
              state={state}
              mutate={mutate}
              busy={busy}
              notify={setNotice}
              initialTab={modal.tab}
              restore={(data) => setModal({ type: 'restore', data })}
            />
          )}
          {modal.type === 'attribution' && <DictionaryAttribution state={state} />}
          {modal.type === 'issue' && activeEntry && (
            <IssueForm
              state={state}
              entry={activeEntry}
              senseId={modal.senseId}
              mutate={mutate}
              busy={busy}
              done={() => {
                setModal(null);
                setNotice('issueSaved');
              }}
              fixNow={(issueId, senseId) => openEdit(activeEntry.id, issueId, senseId)}
            />
          )}
          {modal.type === 'edit' && activeEntry && (
            <EntryEditor
              key={activeEntry.id}
              entry={activeEntry}
              state={state}
              busy={busy}
              notify={setNotice}
              focusSenseId={modal.senseId}
              save={(entry) => saveEdit(entry, modal.issueId)}
            />
          )}
          {modal.type === 'restore' && (
            <RestorePreview
              state={state}
              data={modal.data}
              mutate={mutate}
              busy={busy}
              merged={() => {
                setModal(null);
                setNotice('saved');
              }}
              replaced={() => {
                setModal(null);
                setView('today');
                setNotice('saved');
              }}
            />
          )}
        </Dialog>
      )}
      {notice && (
        <div role="status" className="toast">
          <span>{t(notice)}</span>
          {notice === 'entryEdited' && lastEdited && undoable(state, lastEdited) && (
            <button
              className="text-button"
              disabled={busy}
              onClick={async () => {
                const record = undoable(state, lastEdited);
                if (record && (await mutate((d) => undoContentChange(d, record.id))))
                  setNotice('editUndone');
              }}
            >
              {t('undoEdit')}
            </button>
          )}
          <button aria-label={t('close')} onClick={() => setNotice(null)}>
            <X size={15} />
          </button>
        </div>
      )}
    </>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppState } from '../domain/types';
import {
  freshLearningState,
  installCurrentCollection,
  needsLegacyUpgrade,
  upgradeCurrentCollection,
} from '../domain/builtin';
import { loadContent } from '../content/files';
import { validateBackup } from '../domain/import-export';
import { migrateState, TYPOGRAPHY_VERSION } from '../domain/migration';
import { applyOperation, freezeState } from '../domain/mutation';
import { ConflictError, PortableStorage } from '../platform/storage';
import type { Label } from '../i18n';
import type { Mutate } from './types';

export const storage = new PortableStorage();
let initialization: Promise<AppState>;
// Start-up failures name the step and the first stack frames, so the boot screen can say why.
async function step<T>(name: string, run: () => T | Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof ConflictError) throw e;
    const error = e instanceof Error ? e : new Error(String(e));
    error.message = `[${name}] ${error.message}`;
    throw error;
  }
}
function initialize() {
  return (initialization ??= (async () => {
    // The built-in pack is needed to read stored data; old data also needs the upgrade file.
    await step('word-list', () => loadContent('word-list'));
    const existing = await step('read', () => storage.read());
    if (existing) {
      const next = await step('migrate', () => migrateState(existing, true));
      if (needsLegacyUpgrade(next))
        await step('legacy-upgrade', () => loadContent('legacy-upgrade'));
      const installed = await step('install', () => installCurrentCollection(next)),
        upgraded = await step('upgrade', () => upgradeCurrentCollection(next));
      if (
        upgraded ||
        existing.schemaVersion === 1 ||
        existing.prefs.typographyVersion !== TYPOGRAPHY_VERSION ||
        installed ||
        storage.needsFullSave
      ) {
        try {
          return await step('save', () => storage.save(next, existing.revision));
        } catch (e) {
          if (e instanceof ConflictError) return validateBackup(await storage.read());
          throw e;
        }
      }
      return next;
    }
    try {
      return await storage.save(freshLearningState(), null);
    } catch (e) {
      if (e instanceof ConflictError) return validateBackup(await storage.read());
      throw e;
    }
  })());
}

// Loads, persists and cross-tab-synchronizes the learning state. Every change goes through
// mutate, which builds the next state, saves only the changed records and publishes the
// result after a successful save.
export function useAppState() {
  const [state, setState] = useState<AppState | null>(null),
    stateRef = useRef<AppState | null>(null);
  const [bootError, setBootError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    busyRef = useRef(false);
  const [notice, setNotice] = useState<Label | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    let alive = true;
    initialize()
      .then((s) => {
        if (alive) {
          stateRef.current = freezeState(s);
          setState(s);
          // Time from page start until the data is ready; shown in Settings.
          performance.mark('francais-ready');
        }
      })
      .catch(
        (e) =>
          alive &&
          setBootError(
            e instanceof Error
              ? [e.message, ...(e.stack ?? '').split('\n').slice(1, 4)].join('\n')
              : String(e),
          ),
      );
    const c =
      typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('francais-state-v1');
    channel.current = c;
    if (c)
      c.onmessage = () => {
        storage
          .read()
          .then((s) => {
            if (alive && s) {
              const current = validateBackup(s);
              stateRef.current = freezeState(current);
              setState(current);
              setNotice('conflict');
            }
          })
          .catch(() => alive && setNotice('readOnly'));
      };
    const exportError = () => setNotice('exportError');
    window.addEventListener('francais-export-error', exportError);
    return () => {
      alive = false;
      c?.close();
      window.removeEventListener('francais-export-error', exportError);
    };
  }, []);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(null), 6500);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  const mutate: Mutate = useCallback(async (operation, options) => {
    if (busyRef.current || !stateRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    try {
      const old = stateRef.current;
      performance.mark('francais-save-start');
      const result = applyOperation(old, operation);
      if (!result) return true;
      const saved = await storage.save(
        result.next,
        old.revision,
        result.changes,
        options?.backupAs,
      );
      performance.measure('francais-save', 'francais-save-start');
      stateRef.current = freezeState(saved);
      setState(saved);
      channel.current?.postMessage(saved.revision);
      return true;
    } catch (e) {
      if (e instanceof ConflictError) {
        const s = await storage.read();
        if (s) {
          const current = validateBackup(s);
          stateRef.current = freezeState(current);
          setState(current);
        }
        setNotice('conflict');
      } else setNotice('error');
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);
  return { state, bootError, busy, mutate, notice, setNotice };
}

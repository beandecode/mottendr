import { isDemo } from '../app/demo';
import type { AppState, Entry, LegacyState } from '../domain/types';
import { fullRewrite, type StateChanges } from '../domain/changes';
import { packEntries } from '../domain/pack';
import { resolveEntry, splitEntry } from '../domain/layers';
import { assembleLayer, metaOf, type Meta } from '../domain/user-data';
import type { Annotation, ContentLogRecord, ContentPatchDoc, Issue } from '../domain/user-layer';
import { isNativeIOS, native, type NativeBridge, type NativeOp } from './native';
export class ConflictError extends Error {
  constructor() {
    super('DATA_CHANGED');
  }
}
export interface StorageProvider {
  read(): Promise<AppState | LegacyState | null>;
  // Without `changes` the whole state is written; with them only the listed records.
  // `backupAs` keeps the state being replaced under that key, in the same transaction.
  save(
    state: AppState,
    expectedRevision: number | null,
    changes?: StateChanges,
    backupAs?: string,
  ): Promise<AppState>;
}

// Layout (IndexedDB version 5):
// - meta: 'current' = everything except the lists; 'entryOrder' = entry ids in order
// - tasks, events, issues, contentLog: one record per item, with its array position
// - built-in entries are not stored: only contentPatches and annotations that differ from
//   the built-in pack; userEntries holds the learner's own entries whole
// - state: backups, and the single `current` record used before 0.7
// - entries: only present in databases from the 0.7 pre-release (one record per entry)
type ListName = 'tasks' | 'events' | 'issues' | 'contentLog';
const lists: ListName[] = ['tasks', 'events', 'issues', 'contentLog'];
const layerStores = ['contentPatches', 'annotations', 'userEntries'];
const stores = ['state', 'meta', ...lists, ...layerStores];
interface ListRecord<T> {
  id: string;
  seq: number;
  value: T;
}
const ordered = <T>(records: ListRecord<T>[]) =>
  records.sort((a, b) => a.seq - b.seq).map((r) => r.value);
type Layout = 'layered' | 'prerelease' | 'legacy' | 'empty';
const layoutOf = (meta: unknown, order: unknown, legacy: unknown): Layout =>
  meta ? (order ? 'layered' : 'prerelease') : legacy ? 'legacy' : 'empty';

interface Raw {
  meta?: Meta;
  order?: string[];
  legacy?: AppState | LegacyState;
  tasks: ListRecord<AppState['tasks'][number]>[];
  events: ListRecord<AppState['events'][number]>[];
  issues: ListRecord<Issue>[];
  contentLog: ListRecord<ContentLogRecord>[];
  patches: ContentPatchDoc[];
  annotations: Annotation[];
  userEntries: Entry[];
  prerelease: ListRecord<Entry>[];
}
// Issues every read in `tx`; `done` runs once the last one has completed.
function readAll(tx: IDBTransaction, done: (raw: Raw) => void) {
  const store = (name: string) => tx.objectStore(name);
  const has = (name: string) => tx.objectStoreNames.contains(name);
  const requests = {
    meta: store('meta').get('current'),
    order: store('meta').get('entryOrder'),
    legacy: store('state').get('current'),
    tasks: store('tasks').getAll(),
    events: store('events').getAll(),
    issues: store('issues').getAll(),
    contentLog: store('contentLog').getAll(),
    patches: store('contentPatches').getAll(),
    annotations: store('annotations').getAll(),
    userEntries: store('userEntries').getAll(),
    prerelease: has('entries') ? store('entries').getAll() : null,
  };
  const last = requests.prerelease ?? requests.userEntries;
  last.onsuccess = () =>
    done({
      meta: requests.meta.result,
      order: requests.order.result,
      legacy: requests.legacy.result,
      tasks: requests.tasks.result,
      events: requests.events.result,
      issues: requests.issues.result,
      contentLog: requests.contentLog.result,
      patches: requests.patches.result,
      annotations: requests.annotations.result,
      userEntries: requests.userEntries.result,
      prerelease: requests.prerelease?.result ?? [],
    });
}
// `stale`: the data needs a full rewrite (older layout, or edits based on an older pack).
function assemble(
  raw: Raw,
  pack: ReadonlyMap<string, Entry>,
): { value: AppState | LegacyState | null; stale: boolean } {
  const layout = layoutOf(raw.meta, raw.order, raw.legacy);
  if (layout === 'legacy') return { value: raw.legacy!, stale: true };
  if (layout === 'empty') return { value: null, stale: false };
  const tasks = ordered(raw.tasks),
    events = ordered(raw.events);
  if (layout === 'prerelease')
    return {
      value: { ...raw.meta!, tasks, events, entries: ordered(raw.prerelease) } as AppState,
      stale: true,
    };
  const { state, stale } = assembleLayer(
    {
      meta: raw.meta!,
      entryOrder: raw.order!,
      tasks,
      events,
      contentPatches: raw.patches,
      annotations: raw.annotations,
      userEntries: raw.userEntries,
      issues: ordered(raw.issues),
      contentLog: ordered(raw.contentLog),
    },
    pack,
  );
  return { value: state, stale };
}

// Content upgrades keep a copy of the state they replace, as before the storage split.
function collectionBackups(
  previous: Pick<AppState, 'installedCollections'> & { schemaVersion: number },
  next: AppState,
) {
  if (previous.schemaVersion !== 2) return [];
  const version = (s: Pick<AppState, 'installedCollections'>) =>
    s.installedCollections?.find((c) => c.id === 'word-list')?.version ?? 0;
  const keys: string[] = [];
  if (
    previous.installedCollections?.some((c) => c.id === 'word-list' && c.version < 2) &&
    next.installedCollections?.some((c) => c.id === 'word-list' && c.version >= 2)
  )
    keys.push('before-word-list-v2');
  if (version(previous) < version(next) && version(next) >= 3)
    keys.push('before-word-list-definitions');
  return keys;
}

// The queued writes of one transaction, whichever store backs it. `key` is the record's key
// (its `id` for the list and layer stores).
export interface RecordWriter {
  put(store: string, value: unknown, key: string): void;
  delete(store: string, key: string): void;
  clear(store: string): void;
}
// Emits the writes that bring the stored layers up to date with `result`. `prerelease`: a leftover
// 0.7 pre-release `entries` store exists and is emptied by a full write.
function writeLayers(
  out: RecordWriter,
  pack: ReadonlyMap<string, Entry>,
  result: AppState,
  plan: StateChanges,
  storedOrderLength: number | undefined,
  prerelease: boolean,
) {
  out.put('meta', metaOf(result), 'current');
  for (const name of lists) {
    const list = (result[name] ?? []) as { id: string }[];
    const put = (i: number) =>
      out.put(name, { id: list[i].id, seq: i, value: list[i] }, list[i].id);
    if (plan[name].rewrite) {
      out.clear(name);
      list.forEach((_, i) => put(i));
    } else plan[name].indexes.forEach(put);
  }
  const [patches, annotations, own] = layerStores;
  // A full write also normalizes: built-in entries without content edits drop their
  // per-entry metadata, and `result` is updated to read back exactly as stored.
  const full = plan.entries.rewrite;
  const writeEntry = (i: number) => {
    const entry = result.entries[i],
      builtIn = pack.get(entry.id);
    if (!builtIn) {
      out.put(own, entry, entry.id);
      return;
    }
    let { doc, annotation } = splitEntry(builtIn, entry);
    if (full && doc && !doc.patches.length) doc = null;
    if (doc) out.put(patches, doc, entry.id);
    else out.delete(patches, entry.id);
    if (annotation) out.put(annotations, annotation, entry.id);
    else out.delete(annotations, entry.id);
    if (full) {
      const resolved = resolveEntry(builtIn, doc, annotation).entry;
      result.entries[i] = resolved === builtIn ? structuredClone(builtIn) : resolved;
    }
  };
  if (full) {
    // `result` is our own object, but its entries array may be the shared, frozen one.
    result.entries = [...result.entries];
    for (const name of layerStores) out.clear(name);
    if (prerelease) out.clear('entries');
    result.entries.forEach((_, i) => writeEntry(i));
  } else plan.entries.indexes.forEach(writeEntry);
  if (full || result.entries.length !== storedOrderLength)
    out.put(
      'meta',
      result.entries.map((e) => e.id),
      'entryOrder',
    );
}

// The demo build keeps its data in its own database, so the older app's data on the same address is never read or changed.
export const LOCAL_DB_NAME = isDemo ? 'mottendr-demo-v1' : 'mots-local-v1';

export class IndexedDbStorage implements StorageProvider {
  private connection?: Promise<IDBDatabase>;
  // Set by read(): the data is in an older layout or holds edits based on an older pack,
  // and the next save should be a full one that brings it up to date.
  needsFullSave = false;
  constructor(
    private name = LOCAL_DB_NAME,
    private pack: ReadonlyMap<string, Entry> = packEntries(),
  ) {}
  private db() {
    return (this.connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(this.name, 5);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('state')) db.createObjectStore('state');
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        for (const name of [...lists, ...layerStores])
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      };
      r.onsuccess = () => {
        r.result.onversionchange = () => r.result.close();
        resolve(r.result);
      };
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('STORAGE_BLOCKED'));
    }));
  }
  private storeNames(db: IDBDatabase) {
    return db.objectStoreNames.contains('entries') ? [...stores, 'entries'] : stores;
  }
  private readKey<T>(key: string): Promise<T | null> {
    return this.db().then(
      (db) =>
        new Promise<T | null>((resolve, reject) => {
          const tx = db.transaction('state', 'readonly'),
            r = tx.objectStore('state').get(key);
          tx.oncomplete = () => resolve(r.result ?? null);
          tx.onabort = () => reject(tx.error);
        }),
    );
  }
  async read() {
    const db = await this.db();
    return new Promise<AppState | LegacyState | null>((resolve, reject) => {
      const tx = db.transaction(this.storeNames(db), 'readonly');
      let raw: Raw;
      readAll(tx, (r) => (raw = r));
      tx.oncomplete = () => {
        try {
          const { value, stale } = assemble(raw, this.pack);
          this.needsFullSave = stale;
          resolve(value);
        } catch (e) {
          reject(e);
        }
      };
      tx.onabort = () => reject(tx.error);
    });
  }
  readMigrationBackup() {
    return this.readKey<LegacyState>('before-schema-2');
  }
  async readContentBackup() {
    return (
      (await this.readKey<AppState>('before-word-list-definitions')) ??
      (await this.readKey<AppState>('before-word-list-v2'))
    );
  }
  readStorageSplitBackup() {
    return this.readKey<AppState | LegacyState>('before-storage-split');
  }
  // The data a "replace" restore overwrote (see RestorePreview).
  readRestoreBackup() {
    return this.readKey<AppState>('before-restore');
  }
  async save(
    state: AppState,
    expectedRevision: number | null,
    changes?: StateChanges,
    backupAs?: string,
  ) {
    const db = await this.db();
    return new Promise<AppState>((resolve, reject) => {
      const tx = db.transaction(this.storeNames(db), 'readwrite'),
        backups = tx.objectStore('state'),
        metaStore = tx.objectStore('meta');
      let failure: Error | null = null,
        incrementalWrite = false,
        result: AppState;
      const metaRead = metaStore.get('current'),
        orderRead = metaStore.get('entryOrder'),
        legacyRead = backups.get('current');
      legacyRead.onsuccess = () => {
        const meta = metaRead.result as Meta | undefined,
          order = orderRead.result as string[] | undefined,
          legacy = legacyRead.result as AppState | LegacyState | undefined;
        const revision = meta?.revision ?? legacy?.revision ?? null;
        if (revision !== expectedRevision) {
          failure = new ConflictError();
          tx.abort();
          return;
        }
        const layout = layoutOf(meta, order, legacy);
        const incremental = !!changes && layout === 'layered';
        incrementalWrite = incremental;
        // A full write returns an independent copy as it will read back; an incremental
        // write returns the caller's (immutable, structurally shared) state.
        result = {
          ...(incremental ? state : structuredClone(state)),
          revision: (revision ?? 0) + 1,
        };
        const write = () => this.write(tx, result, incremental ? changes! : fullRewrite, order);
        if (layout === 'legacy') {
          // From the single-record layout: keep the old record and rewrite everything.
          if (legacy!.schemaVersion === 1 && result.schemaVersion === 2)
            backups.put(legacy, 'before-schema-2');
          for (const key of collectionBackups(legacy!, result)) backups.put(legacy, key);
          if (backupAs) backups.put(legacy, backupAs);
          backups.put(legacy, 'before-storage-split');
          backups.delete('current');
          write();
          return;
        }
        const keys = meta ? collectionBackups(meta, result) : [];
        if (meta && backupAs) keys.push(backupAs);
        if (!keys.length) {
          write();
          return;
        }
        // Rare: a content upgrade or a restore needs the complete previous state as a backup.
        readAll(tx, (raw) => {
          const previous = assemble(raw, this.pack).value;
          for (const key of keys) backups.put(previous, key);
          write();
        });
      };
      tx.oncomplete = () => {
        if (!incrementalWrite) this.needsFullSave = false;
        resolve(result);
      };
      tx.onabort = () => reject(failure ?? tx.error ?? new Error('SAVE_FAILED'));
    });
  }
  private write(
    tx: IDBTransaction,
    result: AppState,
    plan: StateChanges,
    storedOrder: string[] | undefined,
  ) {
    const writer: RecordWriter = {
      put: (store, value, key) => {
        const target = tx.objectStore(store);
        if (target.keyPath === null) target.put(value, key);
        else target.put(value);
      },
      delete: (store, key) => void tx.objectStore(store).delete(key),
      clear: (store) => void tx.objectStore(store).clear(),
    };
    writeLayers(
      writer,
      this.pack,
      result,
      plan,
      storedOrder?.length,
      tx.objectStoreNames.contains('entries'),
    );
  }
}

// The iOS store: the same layout as IndexedDbStorage, kept as records in SQLite. The layering,
// change detection and backups are the shared code above; the Swift side only stores records and
// applies one commit at a time.
type NativeAll = {
  meta: { current: Meta | null; entryOrder: string[] | null };
} & Record<ListName | 'contentPatches' | 'annotations' | 'userEntries', unknown[]>;
const rawOf = (all: NativeAll): Raw => ({
  meta: all.meta.current ?? undefined,
  order: all.meta.entryOrder ?? undefined,
  tasks: all.tasks as Raw['tasks'],
  events: all.events as Raw['events'],
  issues: all.issues as Raw['issues'],
  contentLog: all.contentLog as Raw['contentLog'],
  patches: all.contentPatches as Raw['patches'],
  annotations: all.annotations as Raw['annotations'],
  userEntries: all.userEntries as Raw['userEntries'],
  prerelease: [],
});
type NativeAccess = Pick<NativeBridge, 'readAll' | 'readHead' | 'readKey' | 'commit'>;
export class NativeStorage implements StorageProvider {
  needsFullSave = false;
  // What the last read or save left in the store, so a rating does not read the entry order again.
  private head?: { meta: Meta | null; orderLength: number | null };
  constructor(
    private bridge: NativeAccess = native,
    private pack: ReadonlyMap<string, Entry> = packEntries(),
  ) {}
  private async readRaw() {
    return rawOf(JSON.parse((await this.bridge.readAll()).json));
  }
  async read(): Promise<AppState | LegacyState | null> {
    const raw = await this.readRaw();
    const { value, stale } = assemble(raw, this.pack);
    this.needsFullSave = stale;
    this.head = { meta: raw.meta ?? null, orderLength: raw.order?.length ?? null };
    return value;
  }
  private async readKey<T>(key: string): Promise<T | null> {
    const { json } = await this.bridge.readKey({ store: 'state', key });
    return json === null ? null : JSON.parse(json);
  }
  readMigrationBackup() {
    return this.readKey<LegacyState>('before-schema-2');
  }
  async readContentBackup() {
    return (
      (await this.readKey<AppState>('before-word-list-definitions')) ??
      (await this.readKey<AppState>('before-word-list-v2'))
    );
  }
  readStorageSplitBackup() {
    return this.readKey<AppState | LegacyState>('before-storage-split');
  }
  readRestoreBackup() {
    return this.readKey<AppState>('before-restore');
  }
  async save(
    state: AppState,
    expectedRevision: number | null,
    changes?: StateChanges,
    backupAs?: string,
  ): Promise<AppState> {
    if (!this.head) {
      const { current, entryOrder } = JSON.parse((await this.bridge.readHead()).json) as {
        current: Meta | null;
        entryOrder: string[] | null;
      };
      this.head = { meta: current, orderLength: entryOrder?.length ?? null };
    }
    const { meta, orderLength } = this.head,
      revision = meta?.revision ?? null;
    if (revision !== expectedRevision) throw new ConflictError();
    const incremental = !!changes && !!meta && orderLength !== null;
    const result: AppState = {
      ...(incremental ? state : structuredClone(state)),
      revision: (revision ?? 0) + 1,
    };
    const ops: NativeOp[] = [];
    const writer: RecordWriter = {
      put: (store, value, key) => {
        ops.push({ op: 'put', store, key, json: JSON.stringify(value) });
      },
      delete: (store, key) => {
        ops.push({ op: 'delete', store, key });
      },
      clear: (store) => {
        ops.push({ op: 'clear', store });
      },
    };
    const keys = meta ? collectionBackups(meta, result) : [];
    if (meta && backupAs) keys.push(backupAs);
    if (keys.length) {
      // Rare: a content upgrade or a restore keeps the complete previous state as a backup.
      const previous = assemble(await this.readRaw(), this.pack).value;
      for (const key of keys) writer.put('state', previous, key);
    }
    writeLayers(
      writer,
      this.pack,
      result,
      incremental ? changes! : fullRewrite,
      orderLength ?? undefined,
      false,
    );
    try {
      await this.bridge.commit({ expectedRevision, ops });
    } catch (e) {
      if ((e as { code?: string }).code === 'CONFLICT') throw new ConflictError();
      throw e;
    }
    this.head = { meta: metaOf(result), orderLength: result.entries.length };
    if (!incremental) this.needsFullSave = false;
    return result;
  }
}

// IndexedDB on the web, the native store on iOS. A page opened from a file where
// IndexedDB is unavailable runs in memory and says so; HTTP storage errors stay visible.
export class PortableStorage implements StorageProvider {
  private chosen?: IndexedDbStorage | NativeStorage | 'memory';
  private memory: AppState | LegacyState | null = null;
  persistence: 'persistent' | 'memory' = 'persistent';
  private async select() {
    if (this.chosen) return this.chosen;
    if (isNativeIOS()) return (this.chosen = new NativeStorage());
    const indexed = new IndexedDbStorage();
    try {
      await indexed.read();
      return (this.chosen = indexed);
    } catch (e) {
      if (globalThis.location?.protocol !== 'file:') throw e;
      this.persistence = 'memory';
      return (this.chosen = 'memory');
    }
  }
  get needsFullSave() {
    return !!this.chosen && this.chosen !== 'memory' && this.chosen.needsFullSave;
  }
  async read(): Promise<AppState | LegacyState | null> {
    const provider = await this.select();
    if (provider === 'memory') return structuredClone(this.memory);
    return provider.read();
  }
  async readMigrationBackup(): Promise<LegacyState | null> {
    const provider = await this.select();
    return provider === 'memory' ? null : provider.readMigrationBackup();
  }
  async readContentBackup(): Promise<AppState | null> {
    const provider = await this.select();
    return provider === 'memory' ? null : provider.readContentBackup();
  }
  async readStorageSplitBackup(): Promise<AppState | LegacyState | null> {
    const provider = await this.select();
    return provider === 'memory' ? null : provider.readStorageSplitBackup();
  }
  async readRestoreBackup(): Promise<AppState | null> {
    const provider = await this.select();
    return provider === 'memory' ? null : provider.readRestoreBackup();
  }
  async save(
    state: AppState,
    expectedRevision: number | null,
    changes?: StateChanges,
    backupAs?: string,
  ): Promise<AppState> {
    const provider = await this.select();
    if (provider !== 'memory') return provider.save(state, expectedRevision, changes, backupAs);
    if ((this.memory?.revision ?? null) !== expectedRevision) throw new ConflictError();
    const result = { ...structuredClone(state), revision: (this.memory?.revision ?? 0) + 1 };
    this.memory = structuredClone(result);
    return result;
  }
}

// Every record of the local database as plain JSON, for rescuing data that cannot be opened.
export async function dumpLocalDatabase(name = LOCAL_DB_NAME): Promise<string> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(name);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const names = [...db.objectStoreNames],
    out: Record<string, { key: unknown; value: unknown }[]> = {};
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(names, 'readonly'),
      requests = names.map((n) => {
        const store = tx.objectStore(n);
        return { n, values: store.getAll(), keys: store.getAllKeys() };
      });
    tx.oncomplete = () => {
      for (const { n, values, keys } of requests)
        out[n] = (values.result as unknown[]).map((value, i) => ({ key: keys.result[i], value }));
      resolve();
    };
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
  db.close();
  return JSON.stringify({ database: name, version: db.version, stores: out });
}

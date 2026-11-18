import { describe, it, expect } from 'vitest';
import { runInNewContext } from 'node:vm';
import { createOfflineWorker } from '../scripts/offline-worker.mjs';

describe('offline release cache isolation', () => {
  it.each([true, false])(
    'reports readiness only when all active release resources exist (%s)',
    async (complete) => {
      const base = 'https://local/',
        files = ['./index.html', './assets/new.js'];
      const handlers: Record<string, (event: unknown) => void> = {};
      runInNewContext(createOfflineWorker('francais-current', files), {
        URL,
        self: {
          registration: { scope: base },
          addEventListener: (name: string, handler: (e: unknown) => void) =>
            (handlers[name] = handler),
        },
        caches: {
          open: async () => ({
            match: async (url: URL) =>
              complete || url.pathname === '/index.html' ? {} : undefined,
          }),
          // A previous release cannot make an incomplete current release ready.
          match: async () => ({}),
        },
      });
      let work: Promise<unknown> | undefined;
      const messages: unknown[] = [];
      handlers.message({
        data: 'CHECK_OFFLINE_READY',
        ports: [{ postMessage: (value: unknown) => messages.push(value) }],
        waitUntil: (p: Promise<unknown>) => (work = p),
      });
      await work;
      expect(messages).toEqual([{ ready: complete }]);
    },
  );
  it('uses the active index and retains previous hashed assets across an update', async () => {
    const base = 'http://localhost/',
      all = new Map([
        ['other-app', new Map([[base + 'index.html', 'OTHER_INDEX']])],
        ['francais-older', new Map()],
        [
          'francais-previous',
          new Map([
            [base + 'index.html', 'OLD_INDEX'],
            [base + 'assets/old.js', 'OLD_SCRIPT'],
          ]),
        ],
        [
          'francais-current',
          new Map([
            [base + 'index.html', 'NEW_INDEX'],
            [base + 'assets/new.js', 'NEW_SCRIPT'],
          ]),
        ],
      ]);
    const key = (request: { url: string } | URL | string) =>
      typeof request === 'string' ? request : request instanceof URL ? request.href : request.url;
    const handlers: Record<string, (event: unknown) => void> = {};
    runInNewContext(createOfflineWorker('francais-current', ['./index.html', './assets/new.js']), {
      URL,
      self: {
        location: { origin: 'http://localhost' },
        registration: { scope: base },
        clients: { claim: async () => {} },
        addEventListener: (name: string, handler: (e: unknown) => void) =>
          (handlers[name] = handler),
      },
      caches: {
        keys: async () => [...all.keys()],
        delete: async (name: string) => all.delete(name),
        open: async (name: string) => ({
          match: async (request: Parameters<typeof key>[0]) => all.get(name)?.get(key(request)),
        }),
        match: async (request: Parameters<typeof key>[0]) =>
          [...all.values()].map((c) => c.get(key(request))).find(Boolean),
      },
      fetch: async () => {
        throw new Error('Unexpected network fallback');
      },
    });
    let activation: Promise<unknown> | undefined;
    handlers.activate({ waitUntil: (p: Promise<unknown>) => (activation = p) });
    await activation;
    expect(all.has('francais-older')).toBe(false);
    expect(all.has('other-app')).toBe(true);
    expect(all.has('francais-previous')).toBe(true);
    async function request(path: string, mode = 'cors') {
      let response: Promise<string> | undefined;
      handlers.fetch({
        request: { url: base + path, method: 'GET', mode },
        respondWith: (p: Promise<string>) => (response = p),
      });
      return response;
    }
    expect(await request('', 'navigate')).toBe('NEW_INDEX');
    expect(await request('assets/old.js')).toBe('OLD_SCRIPT');
    expect(await request('assets/new.js')).toBe('NEW_SCRIPT');
  });
  it('reuses unchanged hashed content from an earlier release and downloads the rest', async () => {
    const base = 'http://localhost/',
      earlier = new Map([[base + 'content/word-list.aaa.json', 'OLD_PACK']]),
      current = new Map<string, string>(),
      downloaded: string[] = [];
    let skipped = false;
    const handlers: Record<string, (event: unknown) => void> = {};
    runInNewContext(
      createOfflineWorker('francais-current', [
        './index.html',
        './content/word-list.aaa.json',
        './content/dictionary.bbb.json',
      ]),
      {
        URL,
        self: {
          registration: { scope: base },
          skipWaiting: () => void (skipped = true),
          addEventListener: (name: string, handler: (e: unknown) => void) =>
            (handlers[name] = handler),
        },
        caches: {
          open: async () => ({
            put: async (url: URL, response: string) => void current.set(url.href, response),
            add: async (url: URL) => {
              downloaded.push(url.href);
              current.set(url.href, 'NETWORK');
            },
          }),
          match: async (url: URL) => earlier.get(url.href),
        },
      },
    );
    let install: Promise<unknown> | undefined;
    handlers.install({ waitUntil: (p: Promise<unknown>) => (install = p) });
    await install;
    // A fully cached worker takes over at once, so a stale copy repairs itself.
    expect(skipped).toBe(true);
    expect(current.get(base + 'content/word-list.aaa.json')).toBe('OLD_PACK');
    // index.html is not hashed and is always fetched; new content is downloaded.
    expect(downloaded).toEqual([base + 'index.html', base + 'content/dictionary.bbb.json']);
  });
});

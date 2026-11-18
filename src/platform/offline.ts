import { isNativeIOS } from './native';
export type OfflineStatus = 'checking' | 'ready' | 'unsupported' | 'failed' | 'file' | 'native';
let status: OfflineStatus = 'checking',
  attempt = 0;
const listeners = new Set<(value: OfflineStatus) => void>();
const watched = new WeakSet<ServiceWorkerRegistration>();
export const getOfflineStatus = () => status;
export function subscribeOfflineStatus(listener: (value: OfflineStatus) => void) {
  listeners.add(listener);
  listener(status);
  return () => {
    listeners.delete(listener);
  };
}
function publish(value: OfflineStatus) {
  status = value;
  listeners.forEach((listener) => listener(value));
}
function timeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('OFFLINE_TIMEOUT')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
function cacheReady(worker: ServiceWorker): Promise<boolean> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const finish = (ready: boolean) => {
      clearTimeout(timer);
      channel.port1.close();
      channel.port2.close();
      resolve(ready);
    };
    const timer = setTimeout(() => finish(false), 5000);
    channel.port1.onmessage = (event) => finish(event.data?.ready === true);
    try {
      worker.postMessage('CHECK_OFFLINE_READY', [channel.port2]);
    } catch {
      finish(false);
    }
  });
}
export async function registerOffline() {
  const current = ++attempt;
  if (isNativeIOS()) {
    publish('native');
    return;
  }
  if (location.protocol === 'file:') {
    publish('file');
    return;
  }
  if (!globalThis.isSecureContext || !('serviceWorker' in navigator) || import.meta.env.DEV) {
    publish('unsupported');
    return;
  }
  publish('checking');
  try {
    // Cached launches must work even when the server is off; do not require a fresh registration request.
    const existing = await navigator.serviceWorker.getRegistration('./');
    const registration =
      existing ?? (await timeout(navigator.serviceWorker.register('./sw.js'), 15000));
    if (registration.waiting) window.dispatchEvent(new Event('francais-update-ready'));
    if (!watched.has(registration)) {
      watched.add(registration);
      registration.addEventListener('updatefound', () => {
        const next = registration.installing;
        next?.addEventListener('statechange', () => {
          if (next.state === 'installed' && navigator.serviceWorker.controller)
            window.dispatchEvent(new Event('francais-update-ready'));
        });
      });
    }
    const active =
      registration.active ?? (await timeout(navigator.serviceWorker.ready, 15000)).active;
    const ready = active ? await cacheReady(active) : false;
    if (current === attempt) publish(ready ? 'ready' : 'failed');
    if (existing) void registration.update().catch(() => {});
  } catch {
    if (current === attempt) publish('failed');
  }
}
export async function applyOfflineUpdate() {
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration?.waiting) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), {
    once: true,
  });
  registration.waiting.postMessage('SKIP_WAITING');
}

// Last resort for a copy that cannot start: forget the worker and its cached files (never the
// learning data, which lives in IndexedDB) and load the current release from the server.
export async function resetOffline() {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((r) => r.unregister()));
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('francais-')).map((k) => caches.delete(k)));
  } finally {
    location.reload();
  }
}

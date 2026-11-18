import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/platform/native', () => ({ isNativeIOS: () => false }));
let cached = true;
class TestChannel {
  port1: { onmessage: ((event: { data: unknown }) => void) | null; close: () => void } = {
    onmessage: null,
    close: () => {},
  };
  port2 = { close: () => {}, reply: (data: unknown) => this.port1.onmessage?.({ data }) };
}
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('DEV', false);
  cached = true;
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('location', { protocol: 'https:' });
  vi.stubGlobal('MessageChannel', TestChannel);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const setup = () => {
  const registration = {
    active: {
      postMessage: (_message: string, ports: TestChannel['port2'][]) =>
        ports[0].reply({ ready: cached }),
    },
    addEventListener: vi.fn(),
    update: vi.fn().mockRejectedValue(new Error('Server is offline')),
  };
  const serviceWorker = {
    getRegistration: vi.fn().mockResolvedValue(registration),
    register: vi.fn(),
  };
  vi.stubGlobal('navigator', { serviceWorker });
  return { registration, serviceWorker };
};
describe('offline startup status', () => {
  it('reports cached offline readiness without requiring online registration or update', async () => {
    const { serviceWorker, registration } = setup();
    const offline = await import('../src/platform/offline');
    await offline.registerOffline();
    expect(offline.getOfflineStatus()).toBe('ready');
    expect(serviceWorker.register).not.toHaveBeenCalled();
    expect(registration.update).toHaveBeenCalled();
  });
  it('reports missing resources and permits retry after the cache is repaired', async () => {
    setup();
    cached = false;
    const offline = await import('../src/platform/offline');
    await offline.registerOffline();
    expect(offline.getOfflineStatus()).toBe('failed');
    cached = true;
    await offline.registerOffline();
    expect(offline.getOfflineStatus()).toBe('ready');
  });
  it('does not advertise offline startup for an ordinary HTTP LAN origin', async () => {
    const { serviceWorker } = setup();
    vi.stubGlobal('isSecureContext', false);
    const offline = await import('../src/platform/offline');
    await offline.registerOffline();
    expect(offline.getOfflineStatus()).toBe('unsupported');
    expect(serviceWorker.getRegistration).not.toHaveBeenCalled();
  });
  it('identifies the local standalone distribution without trying to install a worker', async () => {
    const { serviceWorker } = setup();
    vi.stubGlobal('location', { protocol: 'file:' });
    const offline = await import('../src/platform/offline');
    await offline.registerOffline();
    expect(offline.getOfflineStatus()).toBe('file');
    expect(serviceWorker.getRegistration).not.toHaveBeenCalled();
  });
  it('reports registration failure instead of claiming readiness', async () => {
    const { serviceWorker } = setup();
    serviceWorker.getRegistration.mockRejectedValue(new Error('Unavailable'));
    const offline = await import('../src/platform/offline');
    await offline.registerOffline();
    expect(offline.getOfflineStatus()).toBe('failed');
  });
});

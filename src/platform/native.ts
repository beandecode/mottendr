import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export const isNativeIOS = () => Capacitor.getPlatform() === 'ios';
export interface NativeVoice {
  name: string;
  lang: string;
  id: string;
}
// One write of a commit: `json` is the record's JSON text, stored as it is.
export type NativeOp =
  | { op: 'put'; store: string; key: string; json: string }
  | { op: 'delete'; store: string; key: string }
  | { op: 'clear'; store: string };
// The system tab bar around the web app (iOS 18+; the retired Capacitor shell, git tag capacitor-final).
// A button the page puts in a system bar; the side column shows the symbol, long-press and VoiceOver
// the title. A tap comes back as an `action` event with the id.
export interface NativeBarItem {
  id: string;
  title: string;
  symbol: string;
  enabled: boolean;
}
export interface NativeChrome {
  tab: string;
  tabBarHidden: boolean;
  // While a web sheet is open, tab and button taps are refused.
  locked: boolean;
  toolbar: NativeBarItem[];
  progress: { done: number; total: number } | null;
}
// The part of the right-hand column the system draws (outer camera, status bar), in page coordinates;
// foreground content stays out of it, and with the tab bar hidden the space below it is free.
export interface StatusColumn {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface NativeBridge {
  // `native: false` when there is no system tab bar (older iOS); the web keeps its own then.
  getChrome(): Promise<{ native: boolean; tab?: string; statusColumn?: StatusColumn }>;
  setChrome(options: NativeChrome): Promise<{ native: boolean }>;
  // A tap on a native tab; the web decides and answers with setChrome.
  addListener(
    event: 'tabTap',
    listener: (event: { tab: string; reselect: boolean }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: 'action',
    listener: (event: { id: string }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: 'layout',
    listener: (event: { statusColumn: StatusColumn | null }) => void,
  ): Promise<PluginListenerHandle>;
  // The records of every layer store as one JSON text:
  // { meta: { current, entryOrder }, tasks: [...], events: [...], ... } (see NativeStorage).
  readAll(): Promise<{ json: string }>;
  // Just { current, entryOrder } of the meta store.
  readHead(): Promise<{ json: string }>;
  readKey(options: { store: string; key: string }): Promise<{ json: string | null }>;
  // All ops in one transaction, applied only if the stored revision is `expectedRevision`
  // (null: nothing stored yet); otherwise it rejects with code CONFLICT.
  commit(options: { expectedRevision: number | null; ops: NativeOp[] }): Promise<void>;
  listVoices(): Promise<{ voices: NativeVoice[] }>;
  speak(options: { text: string; lang: string; voice: string; rate: number }): Promise<void>;
  stopSpeech(): Promise<void>;
  shareFile(options: { name: string; text: string }): Promise<void>;
  haptic(): Promise<void>;
  requestNotifications(): Promise<{ granted: boolean }>;
  scheduleReminder(options: {
    hour: number;
    minute: number;
    title: string;
    body: string;
  }): Promise<void>;
  cancelReminder(): Promise<void>;
}
export const native = registerPlugin<NativeBridge>('FrancaisNative');
export function feedback() {
  if (isNativeIOS()) void native.haptic().catch(() => {});
}
export async function exportFile(name: string, text: string, type = 'application/json') {
  if (isNativeIOS()) return native.shareFile({ name, text });
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

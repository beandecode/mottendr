import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { View } from './types';
import {
  isNativeIOS,
  native,
  type NativeBarItem,
  type NativeBridge,
  type NativeChrome,
  type StatusColumn,
} from '../platform/native';

const tabs: View[] = ['today', 'library', 'dictionary', 'activity', 'settings'];

// What the current page adds to the system bars: buttons for the bottom toolbar (on iPhone Duo's
// outer display, the lower part of the side column) and a progress bar.
export interface PageChrome {
  toolbar: NativeBarItem[];
  progress: { done: number; total: number } | null;
}

// What the system bars show for the current page: study belongs to Today and hides the tab bar;
// while a sheet is open the bars refuse taps.
export const chromeFor = (view: View, locked: boolean, page?: PageChrome | null): NativeChrome => ({
  tab: view === 'study' ? 'today' : view,
  tabBarHidden: view === 'study',
  locked,
  toolbar: page?.toolbar ?? [],
  progress: page?.progress ?? null,
});
export const viewForTab = (tab: string): View | null =>
  tabs.includes(tab as View) ? (tab as View) : null;

// The system's status column as CSS: `--status-x`, `--status-bottom`, and `data-status-column` while it is
// at the right edge. Nothing uses them yet; the fold handling (P3) reads the same regions.
export function applyStatusColumn(
  root: Pick<HTMLElement, 'style' | 'dataset'>,
  column: StatusColumn | null,
) {
  const atRight = !!column && column.width > 0 && column.height > 0 && column.x > 0;
  if (column && atRight) {
    root.style.setProperty('--status-x', `${column.x}px`);
    root.style.setProperty('--status-bottom', `${column.y + column.height}px`);
    root.dataset.statusColumn = '';
  } else {
    root.style.removeProperty('--status-x');
    root.style.removeProperty('--status-bottom');
    delete root.dataset.statusColumn;
  }
}

type ChromeBridge = Pick<NativeBridge, 'getChrome' | 'setChrome' | 'addListener'>;
interface ChromeEvents {
  onTab: (view: View, reselect: boolean) => void;
  onReady: () => void;
  onLayout?: (column: StatusColumn | null) => void;
  onAction?: (id: string) => void;
}

// Web state drives the native bars: taps come in as events, the web acts, and the new state goes
// back with setChrome. Selecting a tab from code raises no event on the native side, so nothing echoes.
export function connectNativeChrome(bridge: ChromeBridge, events: ChromeEvents) {
  let last = '',
    ready = false,
    pending: NativeChrome | null = null,
    closed = false;
  const send = (chrome: NativeChrome) => {
    const key = JSON.stringify(chrome);
    if (key === last) return;
    last = key;
    void bridge.setChrome(chrome).catch(() => {
      last = '';
    });
  };
  const listeners = [
    bridge.addListener('tabTap', ({ tab, reselect }) => {
      const view = viewForTab(tab);
      if (view) events.onTab(view, reselect);
    }),
    bridge.addListener('layout', ({ statusColumn }) => events.onLayout?.(statusColumn)),
    bridge.addListener('action', ({ id }) => events.onAction?.(id)),
  ];
  void bridge
    .getChrome()
    .then(({ native: available, statusColumn }) => {
      if (!available || closed) return;
      ready = true;
      events.onLayout?.(statusColumn ?? null);
      events.onReady();
      if (pending) send(pending);
    })
    .catch(() => {});
  return {
    update(chrome: NativeChrome) {
      if (ready) send(chrome);
      else pending = chrome;
    },
    close() {
      closed = true;
      for (const l of listeners) void l.then((h) => h.remove()).catch(() => {});
    },
  };
}

// Pages publish their bar items with usePageChrome; App.tsx provides the setter.
type PublishChrome = (chrome: PageChrome | null, onAction?: (id: string) => void) => void;
export const PageChromeContext = createContext<PublishChrome>(() => {});

export function usePageChrome(chrome: PageChrome, onAction: (id: string) => void) {
  const publish = useContext(PageChromeContext);
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;
  const key = JSON.stringify(chrome);
  useEffect(() => {
    publish(chrome, (id) => onActionRef.current(id));
  }, [publish, key]);
  useEffect(() => () => publish(null), [publish]);
}

// True once the iOS app's system tab bar is in charge; then the page hides its own navigation.
export function useNativeChrome(
  view: View,
  locked: boolean,
  page: PageChrome | null,
  onTab: (view: View, reselect: boolean) => void,
  onAction: (id: string) => void,
  bridge: ChromeBridge = native,
) {
  const [active, setActive] = useState(false);
  const handlers = useRef({ onTab, onAction });
  handlers.current = { onTab, onAction };
  const connection = useRef<ReturnType<typeof connectNativeChrome> | null>(null);
  useEffect(() => {
    if (!isNativeIOS()) return;
    const c = connectNativeChrome(bridge, {
      onTab: (v, reselect) => handlers.current.onTab(v, reselect),
      onAction: (id) => handlers.current.onAction(id),
      onReady: () => {
        document.documentElement.dataset.nativeChrome = '';
        setActive(true);
      },
      onLayout: (column) => applyStatusColumn(document.documentElement, column),
    });
    connection.current = c;
    return () => c.close();
  }, [bridge]);
  useEffect(() => {
    connection.current?.update(chromeFor(view, locked, page));
  }, [view, locked, page]);
  return active;
}

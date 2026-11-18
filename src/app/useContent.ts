import { useEffect, useState } from 'react';
import { hasContent, loadContent, onContentLoaded, type ContentName } from '../content/files';

// Starts loading a content file and re-renders once it is available.
export function useContent(name: ContentName) {
  const [ready, setReady] = useState(() => hasContent(name));
  useEffect(() => {
    if (ready) return;
    const off = onContentLoaded((loaded) => loaded === name && setReady(true));
    void loadContent(name).catch(() => {});
    return off;
  }, [name, ready]);
  return ready;
}

import { useEffect, useState } from 'react';

// A clock for countdowns and due counts. Mount it only where time-based output is shown,
// so the rest of the app re-renders on state changes instead of on every tick.
export function useNow(intervalMs: number) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

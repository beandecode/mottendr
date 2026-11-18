import { useEffect, useState } from 'react';
import type { Preferences } from '../domain/types';

export function cardControls(prefs: Preferences, touch: boolean) {
  const controls = {
    swipe: prefs.swipeEnabled ?? touch,
    grid: prefs.gridEnabled ?? !touch,
    buttons: prefs.buttonsEnabled ?? !touch,
  };
  // A backup from another platform must not leave a touch-only device without a rating method.
  if (!controls.swipe && !controls.grid && !controls.buttons) controls.buttons = true;
  return controls;
}
export function arrowDirection(key: string): 0 | 1 | 2 | 3 | null {
  const index = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(key);
  return index < 0 ? null : (index as 0 | 1 | 2 | 3);
}
export const swipeDirection = (x: number, y: number): 0 | 1 | 2 | 3 =>
  Math.abs(x) > Math.abs(y) ? (x < 0 ? 0 : 1) : y < 0 ? 2 : 3;
export const swipeThreshold = (direction: number, width: number, height: number) =>
  Math.min(180, Math.max(125, (direction < 2 ? width : height) * 0.32));
export function confirmedSwipe(
  x: number,
  y: number,
  width: number,
  height: number,
  duration: number,
): 0 | 1 | 2 | 3 | null {
  if (![x, y, width, height, duration].every(Number.isFinite) || width <= 0 || height <= 0)
    return null;
  const major = Math.max(Math.abs(x), Math.abs(y)),
    minor = Math.min(Math.abs(x), Math.abs(y)),
    direction = swipeDirection(x, y);
  return duration >= 120 &&
    major >= swipeThreshold(direction, width, height) &&
    major >= minor * 1.8
    ? direction
    : null;
}

// A typed whole number, clamped into range. Empty or non-numeric text is null (keep the old value).
export function parseBoundedInt(text: string, min: number, max: number): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Math.min(max, Math.max(min, Number(trimmed)));
}

export const touchCapable = (touchPoints: number, coarsePointer: boolean) =>
  touchPoints > 0 || coarsePointer;
export function useTouchInput() {
  const detect = () =>
    touchCapable(navigator.maxTouchPoints ?? 0, window.matchMedia('(any-pointer: coarse)').matches);
  const [touch, setTouch] = useState(detect);
  useEffect(() => {
    const media = window.matchMedia('(any-pointer: coarse)');
    const update = () => setTouch(detect());
    media.addEventListener('change', update);
    window.addEventListener('pointerdown', update);
    return () => {
      media.removeEventListener('change', update);
      window.removeEventListener('pointerdown', update);
    };
  }, []);
  return touch;
}

// Only the four cardinal cells of an equal 3×3 grid rate an answer.
export function cardRegion(
  x: number,
  y: number,
  width: number,
  height: number,
): 0 | 1 | 2 | 3 | null {
  if (
    ![x, y, width, height].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    x < 0 ||
    y < 0 ||
    x >= width ||
    y >= height
  )
    return null;
  const column = Math.floor((x / width) * 3),
    row = Math.floor((y / height) * 3);
  if (row === 1 && column === 0) return 0;
  if (row === 1 && column === 2) return 1;
  if (row === 0 && column === 1) return 2;
  if (row === 2 && column === 1) return 3;
  return null;
}

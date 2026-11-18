import type { Direction, Preferences } from './types';

export function continuousOptions(prefs: Preferences) {
  return {
    enabled: prefs.continuousLearning === true,
    activeLimit: prefs.activeTaskLimit ?? 6,
    refillLimit: prefs.refillLimit ?? 1,
  };
}

export function autoSpeechEnabled(prefs: Preferences, direction: Direction, revealed: boolean) {
  if (!revealed) return direction === 'recognition' && prefs.autoSpeakQuestion === true;
  return (
    (direction === 'recognition'
      ? prefs.autoSpeakRecognitionAnswer
      : prefs.autoSpeakProductionAnswer) === true
  );
}

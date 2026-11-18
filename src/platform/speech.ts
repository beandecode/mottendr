import type { Preferences } from '../domain/types';
export interface VoiceInfo {
  name: string;
  lang: string;
  localService?: boolean;
}
export function selectVoice<T extends VoiceInfo>(
  voices: T[],
  name: string,
  lang = 'fr-FR',
): T | undefined {
  const prefix = lang.slice(0, 2).toLowerCase();
  return (
    voices.find((v) => v.name === name && v.lang.toLowerCase().startsWith(prefix)) ??
    voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase()) ??
    voices.find((v) => v.lang.toLowerCase().startsWith(prefix))
  );
}
// Where the browser's French voice runs: on the device, online, or unknown; 'unavailable' without one.
export function speechSource(prefs: Preferences, voices: VoiceInfo[]) {
  const voice = selectVoice(voices, prefs.voice);
  return {
    engine: 'browser' as const,
    location: !voice
      ? ('unavailable' as const)
      : voice.localService === true
        ? ('device' as const)
        : voice.localService === false
          ? ('online' as const)
          : ('unknown' as const),
  };
}
export interface SpeechProvider {
  speak(text: string, lang: string, prefs: Preferences): Promise<void>;
  stop(): void;
}
export class LocalSpeech implements SpeechProvider {
  private resolve?: () => void;
  stop() {
    window.speechSynthesis?.cancel();
    this.resolve?.();
    this.resolve = undefined;
  }
  async speak(text: string, lang: string, prefs: Preferences) {
    this.stop();
    if (!window.speechSynthesis) throw new Error('TTS_FAILED');
    const voice = selectVoice(speechSynthesis.getVoices(), prefs.voice, lang);
    if (!voice) throw new Error('VOICE_MISSING');
    await new Promise<void>((resolve, reject) => {
      this.resolve = resolve;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.voice = voice;
      u.rate = prefs.speechRate;
      u.onend = () => {
        this.resolve = undefined;
        resolve();
      };
      u.onerror = (ev) => {
        if (ev.error === 'canceled' || ev.error === 'interrupted') resolve();
        else reject(new Error('TTS_FAILED'));
      };
      speechSynthesis.speak(u);
    });
  }
}

import type { Preferences } from '../domain/types';
import { isNativeIOS, native } from './native';
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
export function speechSource(
  prefs: Preferences,
  nativeIOS: boolean,
  macAvailable: boolean,
  voices: VoiceInfo[],
) {
  if (nativeIOS) return { engine: 'ios' as const, location: 'device' as const };
  if (prefs.speechEngine === 'mac' && macAvailable)
    return { engine: 'mac' as const, location: 'device' as const };
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
  private macAvailable = false;
  setMacAvailable(available: boolean) {
    this.macAvailable = available;
  }
  private audio?: HTMLAudioElement;
  private controller?: AbortController;
  private objectUrl?: string;
  private resolve?: () => void;
  stop() {
    if (isNativeIOS()) void native.stopSpeech().catch(() => {});
    this.controller?.abort();
    this.controller = undefined;
    this.audio?.pause();
    this.audio = undefined;
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = undefined;
    window.speechSynthesis?.cancel();
    this.resolve?.();
    this.resolve = undefined;
  }
  async speak(text: string, lang: string, prefs: Preferences) {
    this.stop();
    if (isNativeIOS()) {
      await native.speak({ text, lang, voice: prefs.voice, rate: prefs.speechRate });
      return;
    }
    if (prefs.speechEngine === 'mac' && this.macAvailable) {
      const controller = new AbortController();
      this.controller = controller;
      const response = await fetch('/api/local-tts/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, lang, voice: prefs.voice, rate: prefs.speechRate }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('TTS_FAILED');
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      this.objectUrl = URL.createObjectURL(blob);
      const audio = new Audio(this.objectUrl);
      this.audio = audio;
      await new Promise<void>((resolve, reject) => {
        this.resolve = resolve;
        audio.onended = () => {
          this.resolve = undefined;
          resolve();
        };
        audio.onerror = () => reject(new Error('TTS_FAILED'));
        audio.play().catch(reject);
      });
    } else {
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
}

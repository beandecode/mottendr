import { useCallback, useEffect, useRef, useState } from 'react';
import type { Preferences } from '../domain/types';
import { LocalSpeech, selectVoice, type VoiceInfo } from '../platform/speech';

const speech = new LocalSpeech();

// Voice discovery and playback. Only the latest request may change the speaking flag,
// so stopping or starting another phrase cancels the previous one cleanly.
export function useSpeech(prefs: Preferences | undefined, onError: () => void) {
  const [speaking, setSpeaking] = useState(false),
    speechGeneration = useRef(0);
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const stop = useCallback(() => {
    speechGeneration.current++;
    speech.stop();
    setSpeaking(false);
  }, []);
  useEffect(() => {
    const updateVoices = () =>
      setVoices(
        window.speechSynthesis
          ?.getVoices()
          .map((v) => ({ name: v.name, lang: v.lang, localService: v.localService })) ?? [],
      );
    updateVoices();
    window.speechSynthesis?.addEventListener('voiceschanged', updateVoices);
    const hidden = () => {
      if (document.hidden) stop();
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      window.speechSynthesis?.removeEventListener('voiceschanged', updateVoices);
      speech.stop();
    };
  }, [stop]);
  async function speak(text: string, lang = 'fr-FR', automatic = false) {
    if (speaking && !automatic) {
      stop();
      return;
    }
    const generation = ++speechGeneration.current;
    setSpeaking(true);
    try {
      const selected = selectVoice(voices, prefs!.voice, lang);
      await speech.speak(text, selected?.lang ?? lang, prefs!);
    } catch (e) {
      if ((e as Error).name !== 'AbortError' && generation === speechGeneration.current) onError();
    } finally {
      if (generation === speechGeneration.current) setSpeaking(false);
    }
  }
  return { speak, stop, speaking, voices };
}

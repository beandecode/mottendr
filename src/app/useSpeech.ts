import { useCallback, useEffect, useRef, useState } from 'react';
import type { Preferences } from '../domain/types';
import { isNativeIOS, native } from '../platform/native';
import { LocalSpeech, selectVoice, type VoiceInfo } from '../platform/speech';

const speech = new LocalSpeech();

// Voice discovery and playback. Only the latest request may change the speaking flag,
// so stopping or starting another phrase cancels the previous one cleanly.
export function useSpeech(prefs: Preferences | undefined, onError: () => void) {
  const [speaking, setSpeaking] = useState(false),
    speechGeneration = useRef(0);
  const [macVoices, setMacVoices] = useState<VoiceInfo[]>([]),
    [browserVoices, setBrowserVoices] = useState<VoiceInfo[]>([]);
  const [macAvailable, setMacAvailable] = useState(false);
  const stop = useCallback(() => {
    speechGeneration.current++;
    speech.stop();
    setSpeaking(false);
  }, []);
  useEffect(() => {
    let alive = true;
    if (isNativeIOS())
      native
        .listVoices()
        .then((data) => {
          if (alive) setBrowserVoices(data.voices);
        })
        .catch(() => {});
    else if (location.protocol !== 'file:')
      fetch('/api/local-tts/capabilities')
        .then((r) => r.json())
        .then((data) => {
          if (alive) {
            const available = data.available === true;
            speech.setMacAvailable(available);
            setMacAvailable(available);
            if (available && Array.isArray(data.voices)) setMacVoices(data.voices);
          }
        })
        .catch(() => {});
    const updateVoices = () =>
      !isNativeIOS() &&
      setBrowserVoices(
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
      alive = false;
      document.removeEventListener('visibilitychange', hidden);
      window.speechSynthesis?.removeEventListener('voiceschanged', updateVoices);
      speech.stop();
    };
  }, [stop]);
  const voices = prefs?.speechEngine === 'mac' && macAvailable ? macVoices : browserVoices;
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
  return { speak, stop, speaking, voices, browserVoices, macAvailable };
}

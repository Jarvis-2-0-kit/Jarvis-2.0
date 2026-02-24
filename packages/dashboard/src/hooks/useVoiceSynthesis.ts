/**
 * useVoiceSynthesis — Text-to-Speech
 *
 * Provider priority:
 * 1. ElevenLabs (best quality, needs API key)
 * 2. OpenAI TTS (good quality, needs API key)
 * 3. Browser SpeechSynthesis (free, works immediately)
 *
 * Browser TTS enhanced:
 * - Auto-selects best available voice for the language
 * - Lower pitch for Jarvis-like effect
 * - Queues voices loading
 */

import { useCallback, useRef, useEffect } from 'react';
import { useVoiceStore, type VoiceLanguage, type TTSProvider } from '../store/voice-store.js';

const ELEVENLABS_API = 'https://api.elevenlabs.io/v1';

interface SynthesizeOptions {
  text: string;
  language: VoiceLanguage;
  provider?: TTSProvider;
}

// Cache browser voices
let cachedVoices: SpeechSynthesisVoice[] = [];

function loadVoices(): SpeechSynthesisVoice[] {
  if (cachedVoices.length > 0) return cachedVoices;
  if (!window.speechSynthesis) return [];
  cachedVoices = window.speechSynthesis.getVoices();
  return cachedVoices;
}

// Find the best voice for the language — prefer deep male voices
function findBestVoice(lang: VoiceLanguage): SpeechSynthesisVoice | null {
  const voices = loadVoices();
  if (voices.length === 0) return null;

  const langCode = lang === 'pl' ? 'pl' : 'en';

  // Priority order for voice selection
  const preferredNames = lang === 'pl'
    ? ['Google polski', 'Microsoft', 'Zosia', 'Jan', 'Paulina']
    : ['Google UK English Male', 'Daniel', 'Google US English', 'Alex', 'Microsoft David', 'Male'];

  // Try preferred names first
  for (const name of preferredNames) {
    const found = voices.find((v) => v.lang.startsWith(langCode) && v.name.includes(name));
    if (found) return found;
  }

  // Any voice matching language
  return voices.find((v) => v.lang.startsWith(langCode)) || voices[0] || null;
}

export function useVoiceSynthesis() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const settings = useVoiceStore((s) => s.settings);
  const isMuted = useVoiceStore((s) => s.isMuted);
  const setStatus = useVoiceStore((s) => s.setStatus);
  const setError = useVoiceStore((s) => s.setError);

  // Pre-load voices on mount
  useEffect(() => {
    loadVoices();
    // Chrome loads voices asynchronously
    if (window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = () => {
        cachedVoices = window.speechSynthesis.getVoices();
      };
    }
  }, []);

  // --- ElevenLabs TTS ---
  const synthesizeElevenLabs = useCallback(async (text: string, signal: AbortSignal): Promise<string> => {
    if (!settings.elevenLabsApiKey) {
      throw new Error('ElevenLabs API key not set');
    }

    const voiceId = settings.elevenLabsVoiceId || 'onwK4e9ZLuTAKqWW03F9';
    const response = await fetch(`${ELEVENLABS_API}/text-to-speech/${voiceId}/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': settings.elevenLabsApiKey,
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.65,
          similarity_boost: 0.80,
          style: 0.35,
          use_speaker_boost: true,
        },
      }),
      signal,
    });

    if (!response.ok) throw new Error(`ElevenLabs ${response.status}`);
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  }, [settings.elevenLabsApiKey, settings.elevenLabsVoiceId]);

  // --- OpenAI TTS ---
  const synthesizeOpenAI = useCallback(async (text: string, signal: AbortSignal): Promise<string> => {
    if (!settings.openaiApiKey) {
      throw new Error('OpenAI API key not set');
    }

    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: 'tts-1-hd',
        input: text,
        voice: settings.openaiVoice || 'onyx',
        speed: settings.speed,
        response_format: 'mp3',
      }),
      signal,
    });

    if (!response.ok) throw new Error(`OpenAI TTS ${response.status}`);
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  }, [settings.openaiApiKey, settings.openaiVoice, settings.speed]);

  // --- Browser TTS (enhanced) ---
  const synthesizeBrowser = useCallback((text: string, language: VoiceLanguage): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (!window.speechSynthesis) {
        reject(new Error('Browser TTS not supported'));
        return;
      }

      // Cancel any ongoing speech
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = language === 'pl' ? 'pl-PL' : 'en-US';
      utterance.rate = settings.speed;
      utterance.volume = settings.volume;
      utterance.pitch = 0.8; // Lower for Jarvis effect

      const voice = findBestVoice(language);
      if (voice) {
        utterance.voice = voice;
      }

      utterance.onend = () => resolve();
      utterance.onerror = (e) => {
        // 'interrupted' is normal when we cancel
        if (e.error === 'interrupted') { resolve(); return; }
        reject(new Error(`TTS: ${e.error}`));
      };

      // Chrome bug workaround: long text gets cut off
      // Split into sentences for reliability
      window.speechSynthesis.speak(utterance);

      // Chrome pause/resume hack for long utterances
      if (text.length > 200) {
        const resumeInterval = setInterval(() => {
          if (!window.speechSynthesis.speaking) {
            clearInterval(resumeInterval);
            return;
          }
          window.speechSynthesis.pause();
          window.speechSynthesis.resume();
        }, 14000);

        utterance.onend = () => {
          clearInterval(resumeInterval);
          resolve();
        };
      }
    });
  }, [settings.speed, settings.volume]);

  // --- Main speak function ---
  const speak = useCallback(async (options: SynthesizeOptions): Promise<void> => {
    const { text, language, provider = settings.ttsProvider } = options;

    if (!text.trim()) return;
    if (isMuted) {
      setStatus('idle');
      return;
    }

    // Abort any in-progress
    if (abortRef.current) abortRef.current.abort();
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    window.speechSynthesis?.cancel();

    const abort = new AbortController();
    abortRef.current = abort;

    setStatus('speaking');
    setError(null);

    try {
      if (provider === 'browser') {
        await synthesizeBrowser(text, language);
      } else {
        let audioUrl: string;

        try {
          if (provider === 'elevenlabs') {
            audioUrl = await synthesizeElevenLabs(text, abort.signal);
          } else {
            audioUrl = await synthesizeOpenAI(text, abort.signal);
          }
        } catch (err) {
          // API failed — fall back to browser TTS
          if ((err as Error).name === 'AbortError') return;
          console.warn(`${provider} TTS failed, falling back to browser:`, (err as Error).message);
          await synthesizeBrowser(text, language);
          return;
        }

        // Play audio file
        await new Promise<void>((resolve, reject) => {
          const audio = new Audio(audioUrl);
          audioRef.current = audio;
          audio.volume = settings.volume;
          audio.playbackRate = provider === 'elevenlabs' ? settings.speed : 1;

          audio.onended = () => {
            URL.revokeObjectURL(audioUrl);
            audioRef.current = null;
            resolve();
          };
          audio.onerror = () => {
            URL.revokeObjectURL(audioUrl);
            audioRef.current = null;
            reject(new Error('Playback error'));
          };

          audio.play().catch((e) => {
            URL.revokeObjectURL(audioUrl);
            // Autoplay blocked — fall back to browser TTS
            console.warn('Audio autoplay blocked, falling back to browser TTS');
            synthesizeBrowser(text, language).then(resolve).catch(reject);
          });
        });
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      // Last resort — try browser
      try {
        await synthesizeBrowser(text, language);
      } catch {
        setError(`TTS failed: ${(err as Error).message}`);
      }
    } finally {
      if (!abort.signal.aborted) {
        setStatus('idle');
      }
    }
  }, [settings, isMuted, setStatus, setError, synthesizeElevenLabs, synthesizeOpenAI, synthesizeBrowser]);

  // Stop speaking
  const stopSpeaking = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    window.speechSynthesis?.cancel();
    setStatus('idle');
  }, [setStatus]);

  return { speak, stopSpeaking };
}

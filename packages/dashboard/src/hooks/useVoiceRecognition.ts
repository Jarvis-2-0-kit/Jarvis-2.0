/**
 * useVoiceRecognition — Speech-to-Text using Web Speech API
 *
 * Features:
 * - Polish (pl-PL) and English (en-US)
 * - Real-time interim transcripts
 * - Audio level monitoring with noise gate
 * - Noise suppression via AudioContext constraints
 * - Always-on / continuous mode
 * - Auto-restart on recognition end
 */

import { useCallback, useEffect, useRef } from 'react';
import { useVoiceStore } from '../store/voice-store.js';

// Web Speech API types
interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}
interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}
interface SpeechRecognitionErrorEvent {
  error: string;
  message: string;
}
interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
}

const LANGUAGE_MAP = { pl: 'pl-PL', en: 'en-US' };

// Noise gate threshold — below this level we consider it background noise
const NOISE_GATE_THRESHOLD = 0.04;

export function useVoiceRecognition() {
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number>(0);
  const isStoppingRef = useRef(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFinalResultRef = useRef<string>('');
  const lastFinalTimeRef = useRef<number>(0);

  const status = useVoiceStore((s) => s.status);
  const settings = useVoiceStore((s) => s.settings);
  const setStatus = useVoiceStore((s) => s.setStatus);
  const setTranscript = useVoiceStore((s) => s.setTranscript);
  const setInterimTranscript = useVoiceStore((s) => s.setInterimTranscript);
  const addMessage = useVoiceStore((s) => s.addMessage);
  const setError = useVoiceStore((s) => s.setError);
  const setAudioLevel = useVoiceStore((s) => s.setAudioLevel);

  const isSupported = typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  // Audio monitoring with noise suppression
  const startAudioMonitoring = useCallback(async () => {
    try {
      // Request mic with noise suppression hints
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          // @ts-expect-error - experimental constraint for advanced noise reduction
          googNoiseSuppression: true,
          // @ts-expect-error - experimental
          googHighpassFilter: true,
          // @ts-expect-error - experimental
          googAutoGainControl: true,
        },
      });
      streamRef.current = stream;

      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);

      // Create a biquad filter to cut low-frequency noise (< 85Hz)
      const highPass = audioContext.createBiquadFilter();
      highPass.type = 'highpass';
      highPass.frequency.value = 85;
      highPass.Q.value = 0.7;

      // Create low-pass to cut high-frequency hiss (> 8kHz)
      const lowPass = audioContext.createBiquadFilter();
      lowPass.type = 'lowpass';
      lowPass.frequency.value = 8000;
      lowPass.Q.value = 0.7;

      source.connect(highPass);
      highPass.connect(lowPass);

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.85;
      lowPass.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const updateLevel = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);

        // Calculate RMS with noise gate
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const normalized = dataArray[i] / 255;
          sum += normalized * normalized;
        }
        let rms = Math.sqrt(sum / dataArray.length);

        // Noise gate — suppress below threshold
        if (rms < NOISE_GATE_THRESHOLD) {
          rms = 0;
        } else {
          // Scale remaining signal to 0-1 range
          rms = (rms - NOISE_GATE_THRESHOLD) / (1 - NOISE_GATE_THRESHOLD);
        }

        setAudioLevel(Math.min(1, rms * 2.2));
        animFrameRef.current = requestAnimationFrame(updateLevel);
      };
      updateLevel();
    } catch (err) {
      console.warn('Audio monitoring failed:', err);
    }
  }, [setAudioLevel]);

  const stopAudioMonitoring = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = 0;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    analyserRef.current = null;
    setAudioLevel(0);
  }, [setAudioLevel]);

  // Start listening
  const startListening = useCallback(() => {
    if (!isSupported) {
      setError('Speech recognition not supported. Use Chrome.');
      return;
    }

    // Cleanup any existing instance AND pending auto-restart timers
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch { /* */ }
      recognitionRef.current = null;
    }

    isStoppingRef.current = false;

    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognitionCtor();

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = LANGUAGE_MAP[settings.language];
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setStatus('listening');
      setError(null);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalTranscript = '';
      let interimTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interimTranscript += result[0].transcript;
        }
      }

      if (interimTranscript) {
        setInterimTranscript(interimTranscript);
      }

      if (finalTranscript) {
        const trimmed = finalTranscript.trim();
        if (!trimmed) return;

        // Filter out noise/very short utterances (likely noise)
        if (trimmed.length < 2) return;

        // Deduplicate: prevent the same transcript from firing twice rapidly
        const now = Date.now();
        if (trimmed === lastFinalResultRef.current && now - lastFinalTimeRef.current < 3000) {
          console.log('[Voice] Skipping duplicate recognition result:', trimmed);
          return;
        }
        lastFinalResultRef.current = trimmed;
        lastFinalTimeRef.current = now;

        setTranscript(trimmed);
        setInterimTranscript('');

        // If wake word enabled, only process messages containing it
        if (settings.wakeWordEnabled) {
          const lower = trimmed.toLowerCase();
          if (lower.includes(settings.wakeWord.toLowerCase())) {
            const command = trimmed
              .replace(new RegExp(settings.wakeWord, 'gi'), '')
              .trim();
            if (command.length > 1) {
              addMessage({ role: 'user', content: command, language: settings.language });
            }
          }
          // If wake word not found, don't send — just show transcript
          return;
        }

        // No wake word — send everything
        addMessage({ role: 'user', content: trimmed, language: settings.language });
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      // Ignore common non-errors
      if (event.error === 'aborted' || event.error === 'no-speech') return;

      if (event.error === 'network') {
        // Network error — try to restart silently
        if (!isStoppingRef.current) {
          restartTimerRef.current = setTimeout(() => {
            if (!isStoppingRef.current) startListening();
          }, 1000);
        }
        return;
      }

      setError(`Recognition error: ${event.error}`);
    };

    recognition.onend = () => {
      // If another startListening() already replaced us, don't auto-restart
      if (recognitionRef.current !== recognition && recognitionRef.current !== null) {
        return;
      }

      // Auto-restart if not manually stopped and in continuous/listening mode
      if (!isStoppingRef.current) {
        // Clear any existing restart timer to avoid double-starts
        if (restartTimerRef.current) {
          clearTimeout(restartTimerRef.current);
        }
        restartTimerRef.current = setTimeout(() => {
          restartTimerRef.current = null;
          if (!isStoppingRef.current) {
            try {
              const newRecog = new SpeechRecognitionCtor();
              newRecog.continuous = true;
              newRecog.interimResults = true;
              newRecog.lang = LANGUAGE_MAP[settings.language];
              newRecog.maxAlternatives = 1;
              newRecog.onresult = recognition.onresult;
              newRecog.onerror = recognition.onerror;
              newRecog.onend = recognition.onend;
              newRecog.onstart = recognition.onstart;
              recognitionRef.current = newRecog;
              newRecog.start();
            } catch {
              // Can't restart — set idle
              setStatus('idle');
              stopAudioMonitoring();
            }
          }
        }, 500);
        return;
      }

      setStatus('idle');
      stopAudioMonitoring();
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
      startAudioMonitoring();
    } catch (err) {
      setError(`Failed to start: ${(err as Error).message}`);
    }
  }, [isSupported, settings, setStatus, setError, setTranscript, setInterimTranscript, addMessage, startAudioMonitoring, stopAudioMonitoring]);

  // Stop listening
  const stopListening = useCallback(() => {
    isStoppingRef.current = true;
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* */ }
      recognitionRef.current = null;
    }
    stopAudioMonitoring();
    setStatus('idle');
  }, [setStatus, stopAudioMonitoring]);

  // Toggle
  const toggleListening = useCallback(() => {
    if (status === 'listening') {
      stopListening();
    } else if (status === 'idle') {
      startListening();
    }
  }, [status, startListening, stopListening]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isStoppingRef.current = true;
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch { /* */ }
      }
      stopAudioMonitoring();
    };
  }, [stopAudioMonitoring]);

  return {
    isSupported,
    startListening,
    stopListening,
    toggleListening,
  };
}

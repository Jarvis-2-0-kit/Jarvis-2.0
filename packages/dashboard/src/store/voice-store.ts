import { create } from 'zustand';

export type VoiceLanguage = 'pl' | 'en';
export type TTSProvider = 'elevenlabs' | 'openai' | 'browser';
export type VoiceStatus = 'idle' | 'listening' | 'processing' | 'speaking';

export interface VoiceMessage {
  id: string;
  role: 'user' | 'jarvis';
  content: string;
  timestamp: number;
  language: VoiceLanguage;
  audioUrl?: string;
  duration?: number;
}

export interface VoiceSettings {
  language: VoiceLanguage;
  ttsProvider: TTSProvider;
  elevenLabsApiKey: string;
  elevenLabsVoiceId: string; // Default: "Antoni" or a Jarvis-like deep voice
  openaiApiKey: string;
  openaiVoice: string; // "onyx" = deep male, "echo" = smooth male
  speed: number; // 0.5 - 2.0
  volume: number; // 0.0 - 1.0
  autoListen: boolean; // Auto-restart listening after Jarvis finishes speaking
  wakeWord: string; // "Jarvis" - activates listening
  wakeWordEnabled: boolean;
  continuousMode: boolean; // Keep listening between interactions
}

interface VoiceStore {
  status: VoiceStatus;
  messages: VoiceMessage[];
  currentTranscript: string; // Live transcript while speaking
  interimTranscript: string; // Partial recognition
  error: string | null;
  settings: VoiceSettings;
  audioLevel: number; // 0-1 microphone level for visualizer
  isMuted: boolean;

  // Actions
  setStatus: (status: VoiceStatus) => void;
  addMessage: (msg: Omit<VoiceMessage, 'id' | 'timestamp'>) => void;
  setTranscript: (transcript: string) => void;
  setInterimTranscript: (interim: string) => void;
  setError: (error: string | null) => void;
  updateSettings: (patch: Partial<VoiceSettings>) => void;
  setAudioLevel: (level: number) => void;
  setMuted: (muted: boolean) => void;
  clearMessages: () => void;
  clearError: () => void;
}

let voiceMsgId = 0;

const DEFAULT_SETTINGS: VoiceSettings = {
  language: 'pl',
  ttsProvider: 'browser', // Browser TTS works immediately, no API key needed
  elevenLabsApiKey: '',
  elevenLabsVoiceId: 'onwK4e9ZLuTAKqWW03F9', // "Daniel" - British Jarvis
  openaiApiKey: '',
  openaiVoice: 'onyx', // Deep male voice
  speed: 1.0,
  volume: 0.9,
  autoListen: true,
  wakeWord: 'Jarvis',
  wakeWordEnabled: false, // Off by default — every sentence goes through
  continuousMode: true, // Always listening by default
};

// Load persisted settings
function loadSettings(): VoiceSettings {
  try {
    const saved = localStorage.getItem('jarvis-voice-settings');
    if (saved) return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS };
}

function persistSettings(settings: VoiceSettings) {
  try {
    localStorage.setItem('jarvis-voice-settings', JSON.stringify(settings));
  } catch { /* ignore */ }
}

export const useVoiceStore = create<VoiceStore>((set, get) => ({
  status: 'idle',
  messages: [],
  currentTranscript: '',
  interimTranscript: '',
  error: null,
  settings: loadSettings(),
  audioLevel: 0,
  isMuted: false,

  setStatus: (status) => set({ status }),

  addMessage: (msg) => {
    const id = `vmsg_${++voiceMsgId}_${Date.now().toString(36)}`;
    const message: VoiceMessage = { ...msg, id, timestamp: Date.now() };
    set((prev) => ({
      messages: [...prev.messages.slice(-100), message], // Keep last 100
      currentTranscript: '',
      interimTranscript: '',
    }));
  },

  setTranscript: (transcript) => set({ currentTranscript: transcript }),
  setInterimTranscript: (interim) => set({ interimTranscript: interim }),

  setError: (error) => set({ error }),
  clearError: () => set({ error: null }),

  updateSettings: (patch) => {
    const newSettings = { ...get().settings, ...patch };
    persistSettings(newSettings);
    set({ settings: newSettings });
  },

  setAudioLevel: (level) => set({ audioLevel: level }),
  setMuted: (muted) => set({ isMuted: muted }),
  clearMessages: () => set({ messages: [] }),
}));

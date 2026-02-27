import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'agent' | 'task';

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message: string;
  timestamp: number;
  duration?: number; // ms, 0 = sticky
  icon?: string;
  agentId?: string;
}

interface ToastStore {
  toasts: Toast[];
  maxToasts: number;
  paused: boolean;
  enabled: boolean; // Global on/off toggle

  addToast: (toast: Omit<Toast, 'id' | 'timestamp'>) => void;
  removeToast: (id: string) => void;
  clearAll: () => void;
  setPaused: (paused: boolean) => void;
  setEnabled: (enabled: boolean) => void;
}

let toastIdCounter = 0;

// Track auto-dismiss timer handles so we can cancel them in removeToast / clearAll
const dismissTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Deduplication tracking - prevent same title+message within cooldown
const recentToasts = new Map<string, number>();
const DEDUP_COOLDOWN_MS = 15_000; // 15 seconds cooldown for identical toasts

function isDuplicate(title: string, message: string): boolean {
  const key = `${title}::${message}`;
  const last = recentToasts.get(key);
  const now = Date.now();

  if (last && now - last < DEDUP_COOLDOWN_MS) {
    return true; // Duplicate within cooldown
  }

  recentToasts.set(key, now);

  // Cleanup old entries every 50 entries
  if (recentToasts.size > 50) {
    for (const [k, v] of recentToasts.entries()) {
      if (now - v > DEDUP_COOLDOWN_MS * 2) recentToasts.delete(k);
    }
  }

  return false;
}

// Load enabled state from localStorage
function loadEnabled(): boolean {
  try {
    const saved = localStorage.getItem('jarvis-toasts-enabled');
    if (saved !== null) return JSON.parse(saved);
  } catch { /* ignore */ }
  return true; // Default enabled
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  maxToasts: 4,
  paused: false,
  enabled: loadEnabled(),

  addToast: (toast) => {
    // Check global toggle
    const state = useToastStore.getState();
    if (!state.enabled) return;
    if (state.paused) return;

    // Deduplication - skip identical toasts within cooldown
    if (isDuplicate(toast.title, toast.message)) return;

    const id = `toast_${++toastIdCounter}_${Date.now().toString(36)}`;
    const newToast: Toast = {
      ...toast,
      id,
      timestamp: Date.now(),
      duration: toast.duration ?? 4000,
    };

    set((prev) => {
      const toasts = [...prev.toasts, newToast].slice(-prev.maxToasts);
      return { toasts };
    });

    // Auto-remove after duration
    if (newToast.duration && newToast.duration > 0) {
      const timer = setTimeout(() => {
        dismissTimers.delete(id);
        set((prev) => ({
          toasts: prev.toasts.filter((t) => t.id !== id),
        }));
      }, newToast.duration);
      dismissTimers.set(id, timer);
    }
  },

  removeToast: (id) => {
    const timer = dismissTimers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      dismissTimers.delete(id);
    }
    set((prev) => ({
      toasts: prev.toasts.filter((t) => t.id !== id),
    }));
  },

  clearAll: () => {
    for (const timer of dismissTimers.values()) clearTimeout(timer);
    dismissTimers.clear();
    set({ toasts: [] });
  },

  setPaused: (paused) => set({ paused }),

  setEnabled: (enabled) => {
    try { localStorage.setItem('jarvis-toasts-enabled', JSON.stringify(enabled)); } catch { /* */ }
    set({ enabled, toasts: enabled ? [] : [] }); // Clear on toggle
  },
}));

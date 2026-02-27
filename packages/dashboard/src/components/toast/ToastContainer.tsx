import { useEffect, useState } from 'react';
import {
  X,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Info,
  Bot,
  ListChecks,
  Pause,
  Play,
  Trash2,
  BellOff,
  Bell,
} from 'lucide-react';
import { useToastStore, type Toast, type ToastType } from '../../store/toast-store.js';

const TYPE_CONFIG: Record<ToastType, { color: string; glow: string; Icon: typeof CheckCircle2 }> = {
  success: { color: 'var(--green-bright)', glow: 'var(--glow-green)', Icon: CheckCircle2 },
  error: { color: 'var(--red-bright)', glow: 'var(--glow-red)', Icon: AlertCircle },
  warning: { color: 'var(--amber)', glow: 'var(--glow-amber)', Icon: AlertTriangle },
  info: { color: 'var(--cyan-bright)', glow: 'var(--glow-cyan)', Icon: Info },
  agent: { color: 'var(--purple)', glow: '0 0 5px #bf5af255, 0 0 10px #bf5af233', Icon: Bot },
  task: { color: 'var(--green-primary)', glow: 'var(--glow-green)', Icon: ListChecks },
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [exiting, setExiting] = useState(false);
  const config = TYPE_CONFIG[toast.type];

  const handleDismiss = () => {
    setExiting(true);
    setTimeout(onDismiss, 250);
  };

  const duration = toast.duration || 0;

  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        padding: '10px 14px',
        background: 'linear-gradient(135deg, #0d1117ee 0%, #161b22ee 100%)',
        border: `1px solid ${config.color}33`,
        borderLeft: `3px solid ${config.color}`,
        borderRadius: 6,
        backdropFilter: 'blur(12px)',
        boxShadow: `${config.glow}, 0 4px 20px rgba(0,0,0,0.5)`,
        minWidth: 280,
        maxWidth: 380,
        animation: exiting
          ? 'toast-exit 0.25s ease-in forwards'
          : 'toast-enter 0.3s ease-out',
        position: 'relative',
        overflow: 'hidden',
        cursor: 'pointer',
      }}
      onClick={handleDismiss}
    >
      <div style={{ flexShrink: 0, paddingTop: 2 }}>
        <config.Icon size={14} color={config.color} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 2,
        }}>
          <span style={{
            fontFamily: 'var(--font-display)',
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: 1.5,
            textTransform: 'uppercase',
            color: config.color,
          }}>
            {toast.title}
          </span>
          <span style={{
            fontSize: 8,
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
            marginLeft: 'auto',
          }}>
            {new Date(toast.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        </div>

        <div style={{
          fontSize: 10,
          color: 'var(--text-secondary)',
          fontFamily: 'var(--font-ui)',
          lineHeight: 1.4,
          wordBreak: 'break-word',
        }}>
          {toast.message}
        </div>
      </div>

      <button
        onClick={(e) => { e.stopPropagation(); handleDismiss(); }}
        style={{
          all: 'unset',
          flexShrink: 0,
          cursor: 'pointer',
          color: 'var(--text-muted)',
          padding: 2,
          borderRadius: 3,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <X size={10} />
      </button>

      {duration > 0 && (
        <div style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          height: 2,
          background: config.color,
          opacity: 0.3,
          animation: `toast-progress ${duration}ms linear forwards`,
        }} />
      )}
    </div>
  );
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const paused = useToastStore((s) => s.paused);
  const enabled = useToastStore((s) => s.enabled);
  const removeToast = useToastStore((s) => s.removeToast);
  const clearAll = useToastStore((s) => s.clearAll);
  const setPaused = useToastStore((s) => s.setPaused);
  const setEnabled = useToastStore((s) => s.setEnabled);

  // Inject keyframes
  useEffect(() => {
    const styleId = 'toast-container-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      @keyframes toast-enter {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      @keyframes toast-exit {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
      }
      @keyframes toast-progress {
        from { width: 100%; }
        to { width: 0%; }
      }
    `;
    document.head.appendChild(style);
    return () => { style.remove(); };
  }, []);

  // Always show the mute/unmute button (even when no toasts)
  return (
    <div style={{
      position: 'fixed',
      top: 56,
      right: 12,
      zIndex: 9998,
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      pointerEvents: 'auto',
      alignItems: 'flex-end',
    }}>
      {/* Global toggle — always visible */}
      <button
        onClick={() => setEnabled(!enabled)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 8,
          fontFamily: 'var(--font-display)',
          letterSpacing: 1,
          color: enabled ? 'var(--text-muted)' : 'var(--amber)',
          padding: '3px 8px',
          background: enabled ? 'rgba(13,17,23,0.8)' : 'rgba(251,191,36,0.1)',
          border: `1px solid ${enabled ? 'var(--border-dim)' : 'rgba(251,191,36,0.3)'}`,
          borderRadius: 4,
          cursor: 'pointer',
          backdropFilter: 'blur(8px)',
        }}
        title={enabled ? 'Mute notifications' : 'Unmute notifications'}
      >
        {enabled ? <Bell size={9} /> : <BellOff size={9} />}
        {enabled ? '' : 'MUTED'}
      </button>

      {/* Controls when toasts visible */}
      {toasts.length > 1 && (
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={() => setPaused(!paused)}
            style={{
              all: 'unset', cursor: 'pointer', display: 'flex',
              alignItems: 'center', gap: 3, fontSize: 8,
              fontFamily: 'var(--font-display)', letterSpacing: 1,
              color: paused ? 'var(--amber)' : 'var(--text-muted)',
              padding: '2px 6px', background: 'rgba(13,17,23,0.9)',
              border: '1px solid var(--border-dim)', borderRadius: 3,
            }}
          >
            {paused ? <Play size={8} /> : <Pause size={8} />}
            {paused ? 'RESUME' : 'PAUSE'}
          </button>
          <button
            onClick={clearAll}
            style={{
              all: 'unset', cursor: 'pointer', display: 'flex',
              alignItems: 'center', gap: 3, fontSize: 8,
              fontFamily: 'var(--font-display)', letterSpacing: 1,
              color: 'var(--text-muted)', padding: '2px 6px',
              background: 'rgba(13,17,23,0.9)',
              border: '1px solid var(--border-dim)', borderRadius: 3,
            }}
          >
            <Trash2 size={8} />
            CLEAR
          </button>
        </div>
      )}

      {/* Toasts */}
      {toasts.map((toast) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onDismiss={() => removeToast(toast.id)}
        />
      ))}
    </div>
  );
}

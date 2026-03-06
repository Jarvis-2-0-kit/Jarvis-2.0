import { useState, useEffect, useRef, useCallback } from 'react';
import { authFetch } from '../../gateway/client.js';
import { useGatewayStore } from '../../store/gateway-store.js';
import { VNCViewer } from './VNCViewer.js';

interface VNCEndpoint {
  id: string;
  label: string;
  wsUrl: string;
  username: string;
  password: string;
}

// ── SVG Icons — explicit stroke, no currentColor ──────────────────
const IconExpand = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#00ffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
    <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
  </svg>
);
const IconShrink = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#00ffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" />
    <line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" />
  </svg>
);

export function VNCGrid() {
  const connected = useGatewayStore((s) => s.connected);
  const [endpoints, setEndpoints] = useState<VNCEndpoint[]>([]);
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);

  const fetchedRef = useRef(false);
  useEffect(() => {
    if (!connected || fetchedRef.current) return;
    fetchedRef.current = true;
    (async () => {
      try {
        const res = await authFetch('/api/vnc');
        if (res.ok) {
          const data = await res.json() as {
            endpoints: Record<string, { label: string; wsUrl: string; username: string; password: string }>;
          };
          const fetched: VNCEndpoint[] = [];
          for (const [id, ep] of Object.entries(data.endpoints)) {
            fetched.push({ id, label: ep.label, wsUrl: ep.wsUrl, username: ep.username, password: ep.password });
          }
          setEndpoints(fetched);
        }
      } catch { /* ignore */ }
    })();
  }, [connected]);

  // ESC exits fullscreen
  useEffect(() => {
    if (!fullscreenId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreenId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreenId]);

  const toggleFullscreen = useCallback((id: string) => {
    setFullscreenId((prev) => (prev === id ? null : id));
  }, []);

  // Fullscreen mode — single panel fills entire view
  if (fullscreenId) {
    const ep = endpoints.find((e) => e.id === fullscreenId);
    if (ep) {
      return (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          display: 'flex', flexDirection: 'column',
          background: 'var(--bg-primary)',
        }}>
          {/* Minimal top bar */}
          <div style={{
            height: 24, minHeight: 24,
            display: 'flex', alignItems: 'center',
            padding: '0 8px',
            background: 'rgba(10,10,10,0.95)',
            borderBottom: '1px solid var(--border-dim)',
          }}>
            <span style={{
              fontSize: 9, fontFamily: 'var(--font-display)',
              letterSpacing: 1.5, color: 'var(--text-secondary)',
            }}>
              {ep.label}
            </span>
            <span style={{
              fontSize: 8, color: 'var(--cyan-bright)',
              marginLeft: 8, fontFamily: 'var(--font-mono)',
            }}>
              FULLSCREEN
            </span>
            <button
              onClick={() => setFullscreenId(null)}
              title="Exit Fullscreen (ESC)"
              style={{
                marginLeft: 'auto',
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '2px 8px',
                background: 'rgba(0,255,255,0.15)',
                border: '1px solid var(--cyan-bright)',
                color: 'var(--cyan-bright)',
                cursor: 'pointer', borderRadius: 2,
                fontSize: 8, fontFamily: 'var(--font-mono)',
              }}
            >
              <IconShrink />
              ESC
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <VNCViewer
              wsUrl={ep.wsUrl}
              id={ep.id}
              target={ep.id}
              username={ep.username}
              password={ep.password}
            />
          </div>
        </div>
      );
    }
  }

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg-primary)',
    }}>
      {/* Header */}
      <div className="panel-header" style={{
        borderBottom: '1px solid var(--border-primary)',
        background: 'var(--bg-tertiary)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 10px',
        height: 28,
        minHeight: 28,
      }}>
        <span style={{ color: 'var(--cyan-bright)' }}>&gt;&gt;</span>
        <span style={{
          fontFamily: 'var(--font-display)',
          fontSize: 10,
          letterSpacing: 1.5,
          color: 'var(--text-primary)',
        }}>
          REMOTE CONTROL
        </span>
        <span style={{
          fontSize: 8,
          padding: '1px 5px',
          background: 'rgba(255,170,0,0.15)',
          border: '1px solid var(--amber)',
          color: 'var(--amber)',
          borderRadius: 3,
          letterSpacing: 1,
          fontFamily: 'var(--font-display)',
        }}>
          THUNDERBOLT 5
        </span>
        <span style={{
          fontSize: 8,
          color: 'var(--text-muted)',
          fontFamily: 'var(--font-mono)',
          marginLeft: 'auto',
        }}>
          VNC Embedded
        </span>
      </div>

      {/* VNC panels */}
      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: `repeat(${Math.max(endpoints.length, 1)}, 1fr)`,
        gap: 1,
        background: 'var(--border-dim)',
        overflow: 'hidden',
      }}>
        {endpoints.map((ep) => (
          <VNCPanel key={ep.id} ep={ep} onFullscreen={toggleFullscreen} />
        ))}

        {endpoints.length === 0 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-muted)',
            fontSize: 11,
            fontFamily: 'var(--font-display)',
            letterSpacing: 2,
            background: 'var(--bg-primary)',
          }}>
            {connected ? 'LOADING...' : 'WAITING FOR GATEWAY...'}
          </div>
        )}
      </div>
    </div>
  );
}

function VNCPanel({ ep, onFullscreen }: { ep: VNCEndpoint; onFullscreen: (id: string) => void }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0,
      minHeight: 0,
      overflow: 'hidden',
      background: 'var(--bg-primary)',
    }}>
      {/* Agent label */}
      <div style={{
        height: 20,
        minHeight: 20,
        display: 'flex',
        alignItems: 'center',
        padding: '0 8px',
        background: 'var(--bg-tertiary)',
        borderBottom: '1px solid var(--border-dim)',
      }}>
        <span style={{
          fontSize: 8,
          fontFamily: 'var(--font-display)',
          letterSpacing: 1.5,
          color: 'var(--text-secondary)',
        }}>
          {ep.label}
        </span>
        <button
          onClick={() => onFullscreen(ep.id)}
          title="Fullscreen"
          style={{
            marginLeft: 'auto',
            display: 'flex', alignItems: 'center',
            padding: '1px 4px',
            background: 'transparent',
            border: '1px solid var(--border-dim)',
            color: 'var(--cyan-bright)',
            cursor: 'pointer',
            borderRadius: 2,
          }}
        >
          <IconExpand />
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <VNCViewer
          wsUrl={ep.wsUrl}
          id={ep.id}
          target={ep.id}
          username={ep.username}
          password={ep.password}
        />
      </div>
    </div>
  );
}

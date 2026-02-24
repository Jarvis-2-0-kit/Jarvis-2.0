import { useRef, useEffect, useState, useCallback } from 'react';

const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RECONNECT_DELAY = 3000; // 3s
const MAX_RECONNECT_DELAY = 30000; // 30s

interface VNCViewerProps {
  host: string;
  port: number;
  id: string;
  username?: string;
  password?: string;
  viewOnly?: boolean;
  onStatusChange?: (status: VNCStatus) => void;
}

type VNCStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

interface RFBInstance {
  scaleViewport: boolean;
  resizeSession: boolean;
  showDotCursor: boolean;
  viewOnly: boolean;
  focusOnClick: boolean;
  clipViewport: boolean;
  qualityLevel: number;
  compressionLevel: number;
  disconnect: () => void;
  sendCtrlAltDel: () => void;
  sendKey: (keysym: number, code: string | null, down?: boolean) => void;
  sendCredentials: (creds: { username?: string; password?: string }) => void;
  focus: () => void;
  blur: () => void;
  clipboardPasteFrom: (text: string) => void;
  machineShutdown: () => void;
  machineReboot: () => void;
  machineReset: () => void;
  addEventListener: (event: string, handler: (...args: unknown[]) => void) => void;
  removeEventListener: (event: string, handler: (...args: unknown[]) => void) => void;
}

export function VNCViewer({ host, port, username, password, id, viewOnly = false, onStatusChange }: VNCViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RFBInstance | null>(null);
  const [status, setStatus] = useState<VNCStatus>('disconnected');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [isFocused, setIsFocused] = useState(false);
  const [showToolbar, setShowToolbar] = useState(false);
  const [clipboardText, setClipboardText] = useState('');
  const [showClipboard, setShowClipboard] = useState(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const mountedRef = useRef(true);
  const authFailedRef = useRef(false); // Don't reconnect after auth failure
  // Store callback in ref to avoid dependency loops
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  const updateStatus = useCallback((s: VNCStatus) => {
    if (!mountedRef.current) return;
    setStatus(s);
    onStatusChangeRef.current?.(s);
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current) return;
    // Don't reconnect if auth failed — same creds will fail again
    if (authFailedRef.current) return;
    if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      updateStatus('error');
      setErrorMsg(`Failed after ${MAX_RECONNECT_ATTEMPTS} attempts. Click RETRY to try again.`);
      return;
    }
    // Exponential backoff: 3s, 6s, 12s, 24s, 30s (capped)
    const delay = Math.min(
      BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttemptsRef.current),
      MAX_RECONNECT_DELAY
    );
    reconnectAttemptsRef.current += 1;
    reconnectTimerRef.current = setTimeout(() => {
      void connectVNCInternal();
    }, delay);
  }, []);

  const connectVNCInternal = useCallback(async () => {
    if (!containerRef.current || !mountedRef.current) return;

    // Cleanup existing
    if (rfbRef.current) {
      try { rfbRef.current.disconnect(); } catch { /* ignore */ }
      rfbRef.current = null;
    }

    // Clear previous canvas
    while (containerRef.current.firstChild) {
      containerRef.current.removeChild(containerRef.current.firstChild);
    }

    try {
      updateStatus('connecting');
      const wsUrl = `ws://${host}:${port}`;

      const mod = await import('@novnc/novnc/lib/rfb.js');
      const RFB = mod.default;

      if (!containerRef.current || !mountedRef.current) return;

      // Build credentials for macOS ARD (needs username+password) or VNCAuth (password only)
      const credentials: Record<string, string> = {};
      if (username) credentials.username = username;
      if (password) credentials.password = password;

      const rfb = new RFB(containerRef.current, wsUrl, {
        credentials: Object.keys(credentials).length > 0 ? credentials : undefined,
        wsProtocols: ['binary'],
      }) as unknown as RFBInstance;

      // macOS ARD auth (type 30) connects to user session (shows desktop)
      // VNCAuth (type 2) only shows lock screen — ARD is required for full access
      // ARD needs both username + password (configured via kickstart)

      // Display settings
      rfb.scaleViewport = true;
      rfb.resizeSession = false;
      rfb.clipViewport = false;

      // Interactive control
      rfb.viewOnly = viewOnly;
      rfb.focusOnClick = true;
      rfb.showDotCursor = !viewOnly;

      // Quality (balance between speed and quality)
      rfb.qualityLevel = 6;
      rfb.compressionLevel = 2;

      rfb.addEventListener('connect', () => {
        reconnectAttemptsRef.current = 0; // Reset on successful connection
        updateStatus('connected');
        if (!viewOnly) {
          rfb.focus();
        }
      });

      // macOS ARD may request credentials after connecting
      rfb.addEventListener('credentialsrequired', () => {
        if (username && password) {
          rfb.sendCredentials({ username, password });
        } else if (password) {
          rfb.sendCredentials({ password });
        } else {
          updateStatus('error');
          setErrorMsg('Credentials required — set VNC username/password in Settings');
        }
      });

      rfb.addEventListener('disconnect', (e: unknown) => {
        const detail = (e as { detail?: { clean?: boolean } })?.detail;
        updateStatus('disconnected');
        rfbRef.current = null;
        // Auto-reconnect with backoff if not clean disconnect
        if (!detail?.clean) {
          scheduleReconnect();
        }
      });

      rfb.addEventListener('securityfailure', (e: unknown) => {
        const detail = (e as { detail?: { reason?: string } })?.detail;
        authFailedRef.current = true; // Prevent auto-reconnect on auth failure
        updateStatus('error');
        setErrorMsg(detail?.reason ?? 'Authentication failed');
      });

      // Clipboard from remote -> local
      rfb.addEventListener('clipboard', (e: unknown) => {
        const detail = (e as { detail?: { text?: string } })?.detail;
        if (detail?.text) {
          setClipboardText(detail.text);
        }
      });

      rfbRef.current = rfb;
    } catch (err) {
      updateStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'Failed to connect');
      scheduleReconnect();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, port, username, password, viewOnly]);

  // Connect on mount / when connection params change. Stable deps only.
  useEffect(() => {
    mountedRef.current = true;
    reconnectAttemptsRef.current = 0;
    authFailedRef.current = false;
    void connectVNCInternal();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (rfbRef.current) {
        try { rfbRef.current.disconnect(); } catch { /* ignore */ }
        rfbRef.current = null;
      }
    };
  }, [connectVNCInternal]);

  // Handle focus/blur for keyboard capture
  const handleContainerClick = useCallback(() => {
    if (rfbRef.current && !viewOnly) {
      rfbRef.current.focus();
      setIsFocused(true);
    }
  }, [viewOnly]);

  const handleSendCtrlAltDel = useCallback(() => {
    rfbRef.current?.sendCtrlAltDel();
  }, []);

  const handlePasteClipboard = useCallback(() => {
    if (clipboardText && rfbRef.current) {
      rfbRef.current.clipboardPasteFrom(clipboardText);
    }
  }, [clipboardText]);

  const handleClipboardFromBrowser = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && rfbRef.current) {
        rfbRef.current.clipboardPasteFrom(text);
        setClipboardText(text);
      }
    } catch {
      // Clipboard API may not be available
    }
  }, []);

  const handleReconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectAttemptsRef.current = 0; // Reset attempts on manual reconnect
    authFailedRef.current = false;    // Allow retry after manual reconnect
    void connectVNCInternal();
  }, [connectVNCInternal]);

  // Send special keys
  const handleSendEscape = useCallback(() => {
    rfbRef.current?.sendKey(0xff1b, 'Escape');
  }, []);

  const handleSendTab = useCallback(() => {
    rfbRef.current?.sendKey(0xff09, 'Tab');
  }, []);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-primary)',
      }}
      onMouseEnter={() => setShowToolbar(true)}
      onMouseLeave={() => { setShowToolbar(false); setShowClipboard(false); }}
    >
      {/* Interactive Toolbar - appears on hover */}
      {status === 'connected' && !viewOnly && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 20,
          display: 'flex',
          gap: 2,
          padding: '2px 4px',
          background: showToolbar ? 'rgba(10,10,10,0.95)' : 'transparent',
          border: showToolbar ? '1px solid var(--border-primary)' : 'none',
          borderTop: 'none',
          borderRadius: '0 0 4px 4px',
          transition: 'all 0.2s ease',
          opacity: showToolbar ? 1 : 0,
        }}>
          <ToolBtn label="Ctrl+Alt+Del" onClick={handleSendCtrlAltDel} />
          <ToolBtn label="Esc" onClick={handleSendEscape} />
          <ToolBtn label="Tab" onClick={handleSendTab} />
          <ToolBtn label="Clipboard" onClick={() => setShowClipboard(!showClipboard)} active={showClipboard} />
          <ToolBtn label="Paste" onClick={() => void handleClipboardFromBrowser()} title="Paste from browser clipboard" />
          <ToolBtn label="Reconnect" onClick={handleReconnect} color="var(--amber)" />
        </div>
      )}

      {/* Clipboard panel */}
      {showClipboard && status === 'connected' && (
        <div style={{
          position: 'absolute',
          top: 28,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 20,
          width: 300,
          background: 'rgba(10,10,10,0.95)',
          border: '1px solid var(--border-primary)',
          borderRadius: 4,
          padding: 8,
        }}>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 4, letterSpacing: 1 }}>
            CLIPBOARD (remote)
          </div>
          <textarea
            value={clipboardText}
            onChange={(e) => setClipboardText(e.target.value)}
            style={{
              width: '100%',
              height: 60,
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-dim)',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              padding: 4,
              resize: 'none',
              borderRadius: 2,
            }}
          />
          <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
            <button onClick={handlePasteClipboard} style={{
              fontSize: 9, padding: '2px 8px', flex: 1,
              background: 'rgba(0,255,65,0.1)', border: '1px solid var(--green-dim)',
              color: 'var(--green-bright)', cursor: 'pointer',
            }}>
              SEND TO REMOTE
            </button>
            <button onClick={() => void handleClipboardFromBrowser()} style={{
              fontSize: 9, padding: '2px 8px', flex: 1,
              background: 'rgba(0,255,255,0.1)', border: '1px solid var(--cyan-dim)',
              color: 'var(--cyan-bright)', cursor: 'pointer',
            }}>
              PASTE FROM LOCAL
            </button>
          </div>
        </div>
      )}

      {/* Focus indicator */}
      {status === 'connected' && isFocused && !viewOnly && (
        <div style={{
          position: 'absolute',
          inset: 0,
          border: '2px solid var(--green-bright)',
          boxShadow: 'inset 0 0 10px rgba(0,255,65,0.1)',
          pointerEvents: 'none',
          zIndex: 15,
          borderRadius: 1,
        }} />
      )}

      {/* VNC Canvas Container - this is where noVNC renders */}
      <div
        ref={containerRef}
        onClick={handleContainerClick}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        tabIndex={0}
        style={{
          flex: 1,
          width: '100%',
          cursor: viewOnly ? 'default' : 'none',
          outline: 'none',
          overflow: 'hidden',
        }}
      />

      {/* Status overlay - shown when not connected */}
      {status !== 'connected' && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-primary)',
          zIndex: 10,
        }}>
          {status === 'connecting' && (
            <>
              <div style={{
                fontFamily: 'var(--font-display)',
                fontSize: 14,
                color: 'var(--green-muted)',
                letterSpacing: 2,
                marginBottom: 8,
              }}>
                CONNECTING
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {host}:{port}
              </div>
              <div style={{
                marginTop: 16, width: 60, height: 2,
                background: 'var(--green-dim)', borderRadius: 1, overflow: 'hidden',
              }}>
                <div style={{
                  width: '50%', height: '100%',
                  background: 'var(--green-bright)',
                  boxShadow: 'var(--glow-green)',
                  animation: 'typing 1.5s ease-in-out infinite alternate',
                }} />
              </div>
            </>
          )}
          {status === 'disconnected' && (
            <>
              <div style={{
                fontFamily: 'var(--font-display)',
                fontSize: 13, color: 'var(--text-muted)',
                letterSpacing: 2, marginBottom: 8,
              }}>
                VNC OFFLINE
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                {id} - Waiting for connection...
              </div>
              <div style={{
                fontSize: 10, color: 'var(--green-dim)', marginTop: 8,
                fontFamily: 'var(--font-mono)',
              }}>
                websockify {port} localhost:5900
              </div>
              <button onClick={handleReconnect} style={{
                marginTop: 16, fontSize: 10, padding: '4px 12px',
                background: 'rgba(0,255,65,0.1)',
                border: '1px solid var(--green-dim)',
                color: 'var(--green-bright)',
                cursor: 'pointer',
                borderRadius: 2,
              }}>
                RECONNECT
              </button>
            </>
          )}
          {status === 'error' && (
            <>
              <div style={{
                fontFamily: 'var(--font-display)',
                fontSize: 13, color: 'var(--red-bright)',
                letterSpacing: 2, textShadow: 'var(--glow-red)',
                marginBottom: 8,
              }}>
                CONNECTION ERROR
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                {errorMsg || 'Unable to connect to VNC server'}
              </div>
              <button onClick={handleReconnect} style={{
                marginTop: 16, fontSize: 10, padding: '4px 12px',
                background: 'rgba(255,50,50,0.1)',
                border: '1px solid var(--red-dim)',
                color: 'var(--red-bright)',
                cursor: 'pointer',
                borderRadius: 2,
              }}>
                RETRY
              </button>
            </>
          )}

          {/* Decorative grid overlay */}
          <div style={{
            position: 'absolute', inset: 0,
            backgroundImage:
              'linear-gradient(rgba(0,255,65,0.02) 1px, transparent 1px),' +
              'linear-gradient(90deg, rgba(0,255,65,0.02) 1px, transparent 1px)',
            backgroundSize: '30px 30px',
            pointerEvents: 'none',
          }} />
        </div>
      )}
    </div>
  );
}

// Small toolbar button component
function ToolBtn({ label, onClick, color, active, title }: {
  label: string;
  onClick: () => void;
  color?: string;
  active?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title ?? label}
      style={{
        fontSize: 8,
        padding: '2px 6px',
        background: active ? 'rgba(0,255,255,0.15)' : 'transparent',
        border: `1px solid ${active ? 'var(--cyan-bright)' : 'var(--border-dim)'}`,
        color: color ?? 'var(--text-secondary)',
        cursor: 'pointer',
        borderRadius: 2,
        fontFamily: 'var(--font-mono)',
        letterSpacing: 0.5,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}

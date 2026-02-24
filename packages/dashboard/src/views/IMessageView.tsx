/**
 * IMessageView — macOS iMessage integration
 *
 * Features:
 * - Platform detection (macOS only)
 * - Send iMessage via osascript
 * - Message history log
 * - Config for auto-reply
 */

import { useState, useEffect, useCallback } from 'react';
import {
  MessageCircle, Wifi, WifiOff, Send, RefreshCw,
  Settings, MessageSquare, Apple, AlertTriangle,
} from 'lucide-react';
import { gateway } from '../gateway/client.js';
import { useGatewayStore } from '../store/gateway-store.js';

interface IMessageMsg {
  id: string;
  channel: string;
  user: string;
  text: string;
  timestamp: number;
  direction: 'in' | 'out';
}

export function IMessageView() {
  const connected = useGatewayStore((s) => s.connected);
  const [tab, setTab] = useState<'status' | 'send' | 'messages'>('status');
  const [status, setStatus] = useState<{ available: boolean; platform: string; connected: boolean }>({
    available: false, platform: '', connected: false,
  });
  const [messages, setMessages] = useState<IMessageMsg[]>([]);
  const [to, setTo] = useState('');
  const [message, setMessage] = useState('');
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    try {
      const [statusData, msgsData] = await Promise.all([
        gateway.request('imessage.status').catch(() => ({ available: false, platform: 'unknown', connected: false })),
        gateway.request('imessage.messages').catch(() => ({ messages: [] })),
      ]);
      setStatus(statusData as typeof status);
      setMessages((msgsData as { messages: IMessageMsg[] })?.messages ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [connected]);

  useEffect(() => { loadData(); }, [loadData]);

  // Listen for messages
  useEffect(() => {
    const handler = (payload: unknown) => {
      const msg = payload as IMessageMsg;
      setMessages((prev) => [...prev.slice(-200), msg]);
    };
    gateway.on('imessage.message', handler);
    return () => { gateway.off('imessage.message', handler); };
  }, []);

  const sendMsg = async () => {
    if (!to.trim() || !message.trim()) return;
    try {
      const result = await gateway.request('imessage.send', { to: to.trim(), message: message.trim() });
      const r = result as { success: boolean; error?: string };
      if (r.success) {
        setSendResult('✓ Message sent via iMessage');
        setMessage('');
      } else {
        setSendResult(`✗ ${r.error}`);
      }
      setTimeout(() => setSendResult(null), 4000);
    } catch (e) {
      setSendResult(`✗ ${(e as Error).message}`);
    }
  };

  const TABS = [
    { id: 'status' as const, label: 'Status', icon: Wifi },
    { id: 'send' as const, label: 'Send', icon: Send },
    { id: 'messages' as const, label: 'Messages', icon: MessageSquare },
  ];

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 8,
          background: 'rgba(0,122,255,0.15)', border: '1px solid rgba(0,122,255,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <MessageCircle size={20} color="#007AFF" />
        </div>
        <div>
          <h1 style={{
            fontFamily: 'var(--font-display)', fontSize: 16,
            letterSpacing: 3, color: 'var(--text-primary)', margin: 0,
          }}>
            iMESSAGE
          </h1>
          <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '2px 0 0' }}>
            macOS Messages.app — Send iMessage &amp; SMS
          </p>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600,
            color: status.available ? '#00ff41' : '#ef4444',
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: status.available ? '#00ff41' : '#ef4444',
              boxShadow: status.available ? '0 0 6px rgba(0,255,65,0.5)' : 'none',
            }} />
            {status.available ? 'AVAILABLE' : 'UNAVAILABLE'}
          </span>
        </div>
      </div>

      {/* Platform warning */}
      {!status.available && !loading && (
        <div style={{
          padding: 20, marginBottom: 16,
          background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)',
          borderRadius: 8, display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <AlertTriangle size={20} color="#ef4444" />
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#ef4444', marginBottom: 4 }}>
              iMessage requires macOS
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              Current platform: {status.platform}. iMessage integration uses AppleScript
              and is only available on macOS with Messages.app configured.
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{
        display: 'flex', gap: 4, marginBottom: 16,
        borderBottom: '1px solid var(--border-primary)', paddingBottom: 8,
      }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', fontSize: 10,
              background: tab === t.id ? 'rgba(0,122,255,0.15)' : 'transparent',
              border: `1px solid ${tab === t.id ? 'rgba(0,122,255,0.3)' : 'transparent'}`,
              color: tab === t.id ? '#007AFF' : 'var(--text-muted)',
              borderRadius: 4, cursor: 'pointer',
              fontFamily: 'var(--font-display)', letterSpacing: 1,
            }}
          >
            <t.icon size={12} />
            {t.label.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Status Tab */}
      {tab === 'status' && (
        <div style={{
          background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
          borderRadius: 8, padding: 20,
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '10px 16px', fontSize: 11 }}>
            <span style={{ color: 'var(--text-muted)' }}>Platform</span>
            <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{status.platform}</span>
            <span style={{ color: 'var(--text-muted)' }}>Available</span>
            <span style={{ color: status.available ? '#00ff41' : '#ef4444' }}>
              {status.available ? 'Yes (macOS detected)' : 'No (requires macOS)'}
            </span>
            <span style={{ color: 'var(--text-muted)' }}>Integration</span>
            <span style={{ color: 'var(--text-primary)' }}>AppleScript via osascript</span>
            <span style={{ color: 'var(--text-muted)' }}>Messages sent</span>
            <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
              {messages.filter((m) => m.direction === 'out').length}
            </span>
          </div>
        </div>
      )}

      {/* Send Tab */}
      {tab === 'send' && (
        <div style={{
          background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
          borderRadius: 8, padding: 20,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <Send size={14} color="#007AFF" />
            <span style={{
              fontFamily: 'var(--font-display)', fontSize: 11,
              letterSpacing: 2, color: '#007AFF',
            }}>
              SEND MESSAGE
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={{ fontSize: 9, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                TO (phone or email)
              </label>
              <input
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="+1234567890 or user@email.com"
                style={{
                  width: '100%', padding: '8px 12px', fontSize: 12,
                  background: 'var(--bg-tertiary)', border: '1px solid var(--border-dim)',
                  borderRadius: 6, color: 'var(--text-primary)', outline: 'none',
                  fontFamily: 'var(--font-mono)',
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: 9, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                MESSAGE
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Type your message..."
                rows={3}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), sendMsg())}
                style={{
                  width: '100%', padding: '8px 12px', fontSize: 12,
                  background: 'var(--bg-tertiary)', border: '1px solid var(--border-dim)',
                  borderRadius: 6, color: 'var(--text-primary)', outline: 'none',
                  resize: 'vertical', fontFamily: 'var(--font-ui)',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                onClick={sendMsg}
                disabled={!to.trim() || !message.trim() || !status.available}
                style={{
                  padding: '8px 20px', fontSize: 11,
                  background: to.trim() && message.trim() ? 'rgba(0,122,255,0.15)' : 'transparent',
                  border: `1px solid ${to.trim() && message.trim() ? 'rgba(0,122,255,0.3)' : 'var(--border-dim)'}`,
                  color: to.trim() && message.trim() ? '#007AFF' : 'var(--text-muted)',
                  borderRadius: 6, cursor: to.trim() && message.trim() ? 'pointer' : 'default',
                  fontFamily: 'var(--font-display)', letterSpacing: 1,
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                <Send size={12} />
                SEND
              </button>
              {sendResult && (
                <span style={{ fontSize: 10, color: sendResult.startsWith('✓') ? '#00ff41' : '#ef4444' }}>
                  {sendResult}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Messages Tab */}
      {tab === 'messages' && (
        <div style={{
          background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
          borderRadius: 8, overflow: 'hidden',
        }}>
          <div style={{
            padding: '10px 16px', borderBottom: '1px solid var(--border-primary)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span style={{
              fontFamily: 'var(--font-display)', fontSize: 11,
              letterSpacing: 2, color: '#007AFF',
            }}>
              MESSAGE LOG ({messages.length})
            </span>
            <button onClick={loadData} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
              <RefreshCw size={12} />
            </button>
          </div>
          <div style={{ maxHeight: 500, overflow: 'auto' }}>
            {messages.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 11 }}>
                No messages yet. Send a message to get started.
              </div>
            ) : messages.map((msg, i) => (
              <div key={msg.id ?? i} style={{
                padding: '8px 16px', borderBottom: '1px solid var(--border-dim)',
                display: 'flex', gap: 10, alignItems: 'flex-start',
              }}>
                <span style={{
                  fontSize: 8, padding: '2px 6px', borderRadius: 3, marginTop: 2,
                  background: msg.direction === 'in' ? 'rgba(0,200,255,0.08)' : 'rgba(0,122,255,0.08)',
                  color: msg.direction === 'in' ? 'var(--cyan-bright)' : '#007AFF',
                  fontWeight: 700,
                }}>
                  {msg.direction === 'in' ? 'IN' : 'OUT'}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 2 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-primary)' }}>{msg.user}</span>
                    <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{msg.channel}</span>
                    <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{msg.text}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

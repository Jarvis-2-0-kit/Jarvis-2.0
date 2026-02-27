/**
 * TelegramView — Telegram Bot integration for Jarvis
 *
 * Features:
 * - Send/receive messages via Telegram Bot API
 * - Auto-reply with Jarvis AI
 * - Chat history
 * - Bot configuration
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Send as SendIcon,
  Settings,
  RefreshCw,
  Bot,
  X,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { gateway } from '../gateway/client.js';

interface TelegramMessage {
  id: string;
  from: string;
  fromId?: string;
  to: string;
  body: string;
  timestamp: number;
  direction: 'incoming' | 'outgoing';
  status: string;
  type: string;
  autoReply?: boolean;
}

interface TelegramConfig {
  botToken: string;
  chatId: string;
  webhookUrl: string;
  autoReplyEnabled: boolean;
  autoReplyLanguage: 'pl' | 'en';
  jarvisMode: boolean;
  allowedUsers: string[];
  notifyOnMessage: boolean;
}

export function TelegramView() {
  const [config, setConfig] = useState<TelegramConfig>({
    botToken: '', chatId: '', webhookUrl: '',
    autoReplyEnabled: false, autoReplyLanguage: 'pl',
    jarvisMode: true, allowedUsers: [], notifyOnMessage: true,
  });
  const [messages, setMessages] = useState<TelegramMessage[]>([]);
  const [composing, setComposing] = useState('');
  const [chatId, setChatId] = useState('');
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const unsub = gateway.on('telegram.message', (payload) => {
      setMessages((prev) => [...prev, payload as TelegramMessage].slice(-500));
    });
    return unsub;
  }, []);

  const loadData = useCallback(async () => {
    try {
      const [configRes, messagesRes, statusRes] = await Promise.all([
        gateway.request('telegram.config.get', {}),
        gateway.request('telegram.messages', { limit: 200 }),
        gateway.request('telegram.status', {}),
      ]);
      const cfg = configRes as TelegramConfig;
      if (cfg.botToken) setConfig(cfg);
      if (cfg.chatId) setChatId(cfg.chatId);

      const msgData = messagesRes as { messages: TelegramMessage[] };
      if (msgData?.messages) setMessages(msgData.messages);

      const status = statusRes as { connected: boolean };
      setConnected(status?.connected ?? false);
    } catch { /* */ }
    finally { setLoading(false); }
  }, []);

  const sendMessage = async () => {
    if (!composing.trim() || !chatId) return;
    setSending(true);
    try {
      await gateway.request('telegram.send', { chatId, message: composing.trim() });
      setMessages((prev) => [...prev, {
        id: `tg-out-${Date.now()}`, from: 'jarvis', to: chatId,
        body: composing.trim(), timestamp: Date.now(),
        direction: 'outgoing', status: 'sent', type: 'text',
      }].slice(-500));
      setComposing('');
    } catch { /* send failed — optimistic message already shown */ }
    finally { setSending(false); }
  };

  const saveConfig = async () => {
    try {
      await gateway.request('telegram.config.set', config);
      setShowSettings(false);
    } catch { /* */ }
  };

  if (loading) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
        <RefreshCw size={20} style={{ animation: 'spin 1s linear infinite' }} />
        <span style={{ marginLeft: 8, fontFamily: 'var(--font-mono)', fontSize: 12 }}>Loading Telegram...</span>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', borderBottom: '1px solid var(--border-primary)',
        background: 'linear-gradient(180deg, #0d1117 0%, #0a0e14 100%)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <SendIcon size={18} color="#0088CC" />
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, letterSpacing: 2, color: '#0088CC' }}>
            TELEGRAM
          </span>
          <span style={{
            fontSize: 9, fontFamily: 'var(--font-display)', letterSpacing: 1, color: 'var(--text-muted)',
            padding: '2px 8px', background: 'var(--bg-tertiary)', borderRadius: 4, border: '1px solid var(--border-dim)',
          }}>
            BOT API
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => {
              const updated = { ...config, jarvisMode: !config.jarvisMode };
              setConfig(updated);
              gateway.request('telegram.config.set', updated).catch(() => {});
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '4px 10px', fontSize: 9, fontFamily: 'var(--font-display)',
              letterSpacing: 1, borderRadius: 4, cursor: 'pointer',
              background: config.jarvisMode ? 'rgba(0,136,204,0.1)' : 'var(--bg-tertiary)',
              border: `1px solid ${config.jarvisMode ? '#0088CC44' : 'var(--border-dim)'}`,
              color: config.jarvisMode ? '#0088CC' : 'var(--text-muted)',
            }}
          >
            <Bot size={10} /> JARVIS {config.jarvisMode ? 'ON' : 'OFF'}
          </button>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px',
            fontSize: 9, fontFamily: 'var(--font-display)', letterSpacing: 1, borderRadius: 4,
            background: connected ? 'rgba(0,136,204,0.1)' : 'rgba(255,85,85,0.1)',
            border: `1px solid ${connected ? '#0088CC44' : '#ff555544'}`,
            color: connected ? '#0088CC' : 'var(--red-bright)',
          }}>
            {connected ? <Wifi size={10} /> : <WifiOff size={10} />}
            {connected ? 'ONLINE' : 'OFFLINE'}
          </div>
          <button onClick={() => setShowSettings(true)} style={{
            all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center',
            padding: 6, borderRadius: 4, color: 'var(--text-muted)',
            background: 'var(--bg-tertiary)', border: '1px solid var(--border-dim)',
          }}>
            <Settings size={14} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
        {messages.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
            <SendIcon size={32} color="#0088CC" style={{ opacity: 0.3, marginBottom: 8 }} />
            <div style={{ fontSize: 13, fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: 2, color: '#0088CC', marginBottom: 4 }}>
              TELEGRAM BOT
            </div>
            <div style={{ fontSize: 11, fontFamily: 'var(--font-ui)', maxWidth: 300, margin: '0 auto', lineHeight: 1.6 }}>
              Configure your Telegram Bot token to start receiving and sending messages.
              {!connected && (
                <button onClick={() => setShowSettings(true)} style={{
                  display: 'block', margin: '12px auto 0', padding: '6px 14px',
                  fontSize: 10, fontFamily: 'var(--font-display)', letterSpacing: 1,
                  borderRadius: 4, cursor: 'pointer', background: '#0088CC22',
                  border: '1px solid #0088CC44', color: '#0088CC',
                }}>
                  CONFIGURE
                </button>
              )}
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} style={{
              display: 'flex', justifyContent: msg.direction === 'outgoing' ? 'flex-end' : 'flex-start',
              marginBottom: 8,
            }}>
              <div style={{
                maxWidth: '70%', padding: '8px 12px',
                borderRadius: msg.direction === 'outgoing' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                background: msg.direction === 'outgoing'
                  ? 'linear-gradient(135deg, #003d5c, #002d44)' : 'linear-gradient(135deg, #1a1e25, #141820)',
                border: `1px solid ${msg.direction === 'outgoing' ? '#0088CC33' : 'var(--border-dim)'}`,
              }}>
                {msg.direction === 'incoming' && (
                  <div style={{ fontSize: 9, color: '#0088CC', fontWeight: 600, fontFamily: 'var(--font-ui)', marginBottom: 3 }}>
                    {msg.from}
                  </div>
                )}
                {msg.autoReply && (
                  <div style={{ fontSize: 8, color: '#0088CC', fontFamily: 'var(--font-display)', letterSpacing: 1, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 3 }}>
                    <Bot size={8} /> JARVIS
                  </div>
                )}
                <div style={{ fontSize: 12, color: 'var(--text-primary)', fontFamily: 'var(--font-ui)', lineHeight: 1.5, wordBreak: 'break-word' }}>
                  {msg.body}
                </div>
                <div style={{ textAlign: 'right', marginTop: 4 }}>
                  <span style={{ fontSize: 8, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {new Date(msg.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Compose */}
      <div style={{
        padding: '8px 12px', borderTop: '1px solid var(--border-primary)',
        background: 'var(--bg-secondary)', display: 'flex', gap: 8, alignItems: 'flex-end',
      }}>
        <input
          type="text" value={chatId} onChange={(e) => setChatId(e.target.value)}
          placeholder="Chat ID" style={{
            width: 100, padding: '8px 10px', fontSize: 11, fontFamily: 'var(--font-mono)',
            color: 'var(--text-primary)', background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-dim)', borderRadius: 6, outline: 'none',
          }}
        />
        <textarea
          value={composing} onChange={(e) => setComposing(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
          placeholder="Type a message..." rows={1}
          style={{
            flex: 1, resize: 'none', fontSize: 12, fontFamily: 'var(--font-ui)',
            color: 'var(--text-primary)', background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-dim)', borderRadius: 8, padding: '8px 12px',
            outline: 'none', maxHeight: 100,
          }}
        />
        <button onClick={sendMessage} disabled={!composing.trim() || sending} style={{
          all: 'unset', cursor: composing.trim() ? 'pointer' : 'default',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 36, height: 36, borderRadius: '50%',
          background: composing.trim() ? '#0088CC' : 'var(--bg-tertiary)',
          color: composing.trim() ? '#fff' : 'var(--text-muted)', flexShrink: 0,
        }}>
          <SendIcon size={16} />
        </button>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowSettings(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: 450, maxHeight: '80vh', overflowY: 'auto',
            background: 'linear-gradient(135deg, #0d1117 0%, #161b22 100%)',
            border: '1px solid #0088CC44', borderRadius: 12, padding: 24,
            boxShadow: '0 0 30px rgba(0,136,204,0.1), 0 20px 60px rgba(0,0,0,0.5)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, letterSpacing: 2, color: '#0088CC' }}>
                TELEGRAM CONFIG
              </span>
              <button onClick={() => setShowSettings(false)} style={{ all: 'unset', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={16} />
              </button>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 9, fontFamily: 'var(--font-display)', letterSpacing: 1, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>BOT TOKEN</label>
              <input type="password" value={config.botToken} onChange={(e) => setConfig({ ...config, botToken: e.target.value })} placeholder="123456:ABC-DEF..." style={{
                width: '100%', padding: '6px 10px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', background: 'var(--bg-tertiary)', border: '1px solid var(--border-dim)', borderRadius: 4, outline: 'none', boxSizing: 'border-box',
              }} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 9, fontFamily: 'var(--font-display)', letterSpacing: 1, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>DEFAULT CHAT ID</label>
              <input value={config.chatId} onChange={(e) => setConfig({ ...config, chatId: e.target.value })} placeholder="Chat ID for default replies" style={{
                width: '100%', padding: '6px 10px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', background: 'var(--bg-tertiary)', border: '1px solid var(--border-dim)', borderRadius: 4, outline: 'none', boxSizing: 'border-box',
              }} />
            </div>
            <div style={{ marginBottom: 12, fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-ui)', lineHeight: 1.6 }}>
              Webhook URL for Telegram Bot API:
              <div style={{ padding: '6px 10px', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 11, color: '#0088CC', background: 'rgba(0,136,204,0.06)', border: '1px solid #0088CC33', marginTop: 4 }}>
                https://your-domain.com/api/telegram/webhook
              </div>
            </div>
            <button onClick={saveConfig} style={{
              width: '100%', padding: '10px 0', marginTop: 12,
              fontSize: 11, fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: 2,
              borderRadius: 6, cursor: 'pointer', background: 'linear-gradient(135deg, #0088CC, #006699)',
              border: 'none', color: '#fff',
            }}>
              SAVE
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * DiscordView — Discord Bot / Webhook integration for Jarvis
 *
 * Features:
 * - Send messages via Discord Bot API or Webhook
 * - Auto-reply with Jarvis AI
 * - Message history
 * - Guild/channel configuration
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
  Hash,
  MessageCircle,
} from 'lucide-react';
import { gateway } from '../gateway/client.js';

interface DiscordMessage {
  id: string;
  from: string;
  to: string;
  body: string;
  timestamp: number;
  direction: 'incoming' | 'outgoing';
  status: string;
  type: string;
  autoReply?: boolean;
}

interface DiscordConfig {
  botToken: string;
  applicationId: string;
  guildId: string;
  channelId: string;
  webhookUrl: string;
  autoReplyEnabled: boolean;
  autoReplyLanguage: 'pl' | 'en';
  jarvisMode: boolean;
  notifyOnMessage: boolean;
}

export function DiscordView() {
  const [config, setConfig] = useState<DiscordConfig>({
    botToken: '', applicationId: '', guildId: '', channelId: '', webhookUrl: '',
    autoReplyEnabled: false, autoReplyLanguage: 'pl', jarvisMode: true, notifyOnMessage: true,
  });
  const [messages, setMessages] = useState<DiscordMessage[]>([]);
  const [composing, setComposing] = useState('');
  const [channelId, setChannelId] = useState('');
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
    const unsub = gateway.on('discord.message', (payload) => {
      setMessages((prev) => [...prev, payload as DiscordMessage]);
    });
    return unsub;
  }, []);

  const loadData = useCallback(async () => {
    try {
      const [configRes, messagesRes, statusRes] = await Promise.all([
        gateway.request('discord.config.get', {}),
        gateway.request('discord.messages', { limit: 200 }),
        gateway.request('discord.status', {}),
      ]);
      const cfg = configRes as DiscordConfig;
      if (cfg) setConfig(cfg);
      if (cfg.channelId) setChannelId(cfg.channelId);

      const msgData = messagesRes as { messages: DiscordMessage[] };
      if (msgData?.messages) setMessages(msgData.messages);

      const status = statusRes as { connected: boolean };
      setConnected(status?.connected ?? false);
    } catch { /* */ }
    finally { setLoading(false); }
  }, []);

  const sendMessage = async () => {
    if (!composing.trim()) return;
    setSending(true);
    try {
      await gateway.request('discord.send', { channelId: channelId || '', message: composing.trim() });
      setMessages((prev) => [...prev, {
        id: `dc-out-${Date.now()}`, from: 'jarvis', to: channelId || 'webhook',
        body: composing.trim(), timestamp: Date.now(),
        direction: 'outgoing', status: 'sent', type: 'text',
      }]);
      setComposing('');
    } catch (err) { console.error('Discord send failed:', err); }
    finally { setSending(false); }
  };

  const saveConfig = async () => {
    try {
      await gateway.request('discord.config.set', config);
      setShowSettings(false);
    } catch { /* */ }
  };

  if (loading) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
        <RefreshCw size={20} style={{ animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  const DISCORD_PURPLE = '#5865F2';

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', borderBottom: '1px solid var(--border-primary)',
        background: 'linear-gradient(180deg, #0d1117 0%, #0a0e14 100%)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Hash size={18} color={DISCORD_PURPLE} />
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, letterSpacing: 2, color: DISCORD_PURPLE }}>
            DISCORD
          </span>
          <span style={{
            fontSize: 9, fontFamily: 'var(--font-display)', letterSpacing: 1, color: 'var(--text-muted)',
            padding: '2px 8px', background: 'var(--bg-tertiary)', borderRadius: 4, border: '1px solid var(--border-dim)',
          }}>
            {config.webhookUrl ? 'WEBHOOK' : 'BOT API'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => {
              const updated = { ...config, jarvisMode: !config.jarvisMode };
              setConfig(updated);
              gateway.request('discord.config.set', updated).catch(() => {});
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '4px 10px', fontSize: 9, fontFamily: 'var(--font-display)',
              letterSpacing: 1, borderRadius: 4, cursor: 'pointer',
              background: config.jarvisMode ? `${DISCORD_PURPLE}1a` : 'var(--bg-tertiary)',
              border: `1px solid ${config.jarvisMode ? `${DISCORD_PURPLE}44` : 'var(--border-dim)'}`,
              color: config.jarvisMode ? DISCORD_PURPLE : 'var(--text-muted)',
            }}
          >
            <Bot size={10} /> JARVIS {config.jarvisMode ? 'ON' : 'OFF'}
          </button>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px',
            fontSize: 9, fontFamily: 'var(--font-display)', letterSpacing: 1, borderRadius: 4,
            background: connected ? `${DISCORD_PURPLE}1a` : 'rgba(255,85,85,0.1)',
            border: `1px solid ${connected ? `${DISCORD_PURPLE}44` : '#ff555544'}`,
            color: connected ? DISCORD_PURPLE : 'var(--red-bright)',
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
            <Hash size={32} color={DISCORD_PURPLE} style={{ opacity: 0.3, marginBottom: 8 }} />
            <div style={{ fontSize: 13, fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: 2, color: DISCORD_PURPLE, marginBottom: 4 }}>
              DISCORD BOT
            </div>
            <div style={{ fontSize: 11, fontFamily: 'var(--font-ui)', maxWidth: 300, margin: '0 auto', lineHeight: 1.6 }}>
              Configure a Discord Bot token or Webhook URL to integrate Jarvis with your Discord server.
              {!connected && (
                <button onClick={() => setShowSettings(true)} style={{
                  display: 'block', margin: '12px auto 0', padding: '6px 14px',
                  fontSize: 10, fontFamily: 'var(--font-display)', letterSpacing: 1,
                  borderRadius: 4, cursor: 'pointer', background: `${DISCORD_PURPLE}22`,
                  border: `1px solid ${DISCORD_PURPLE}44`, color: DISCORD_PURPLE,
                }}>
                  CONFIGURE
                </button>
              )}
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} style={{ display: 'flex', gap: 10, marginBottom: 10, padding: '4px 0' }}>
              {/* Discord-style avatar */}
              <div style={{
                width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                background: msg.direction === 'outgoing'
                  ? `linear-gradient(135deg, ${DISCORD_PURPLE}, #4752C4)`
                  : 'linear-gradient(135deg, #36393f, #2f3136)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontWeight: 700, fontSize: 12,
              }}>
                {msg.direction === 'outgoing' ? 'J' : msg.from[0]?.toUpperCase() || '?'}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: msg.direction === 'outgoing' ? DISCORD_PURPLE : 'var(--text-primary)', fontFamily: 'var(--font-ui)' }}>
                    {msg.direction === 'outgoing' ? 'Jarvis' : msg.from}
                  </span>
                  {msg.autoReply && (
                    <span style={{ fontSize: 8, color: DISCORD_PURPLE, fontFamily: 'var(--font-display)', letterSpacing: 1, padding: '1px 4px', background: `${DISCORD_PURPLE}15`, borderRadius: 3 }}>
                      BOT
                    </span>
                  )}
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {new Date(msg.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-ui)', lineHeight: 1.5, wordBreak: 'break-word' }}>
                  {msg.body}
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
          type="text" value={channelId} onChange={(e) => setChannelId(e.target.value)}
          placeholder="Channel ID" style={{
            width: 110, padding: '8px 10px', fontSize: 11, fontFamily: 'var(--font-mono)',
            color: 'var(--text-primary)', background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-dim)', borderRadius: 6, outline: 'none',
          }}
        />
        <textarea
          value={composing} onChange={(e) => setComposing(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
          placeholder="Message #channel" rows={1}
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
          background: composing.trim() ? DISCORD_PURPLE : 'var(--bg-tertiary)',
          color: composing.trim() ? '#fff' : 'var(--text-muted)', flexShrink: 0,
        }}>
          <SendIcon size={16} />
        </button>
      </div>

      {/* Settings */}
      {showSettings && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowSettings(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: 450, maxHeight: '80vh', overflowY: 'auto',
            background: 'linear-gradient(135deg, #0d1117 0%, #161b22 100%)',
            border: `1px solid ${DISCORD_PURPLE}44`, borderRadius: 12, padding: 24,
            boxShadow: `0 0 30px ${DISCORD_PURPLE}1a, 0 20px 60px rgba(0,0,0,0.5)`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, letterSpacing: 2, color: DISCORD_PURPLE }}>
                DISCORD CONFIG
              </span>
              <button onClick={() => setShowSettings(false)} style={{ all: 'unset', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={16} />
              </button>
            </div>
            {[
              { label: 'BOT TOKEN', key: 'botToken', type: 'password', ph: 'Bot token from Discord Dev Portal' },
              { label: 'APPLICATION ID', key: 'applicationId', type: 'text', ph: 'Application ID' },
              { label: 'GUILD (SERVER) ID', key: 'guildId', type: 'text', ph: 'Server ID' },
              { label: 'CHANNEL ID', key: 'channelId', type: 'text', ph: 'Default channel' },
              { label: 'WEBHOOK URL (alternative)', key: 'webhookUrl', type: 'text', ph: 'https://discord.com/api/webhooks/...' },
            ].map((field) => (
              <div key={field.key} style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 9, fontFamily: 'var(--font-display)', letterSpacing: 1, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                  {field.label}
                </label>
                <input
                  type={field.type} value={(config as any)[field.key]}
                  onChange={(e) => setConfig({ ...config, [field.key]: e.target.value })}
                  placeholder={field.ph}
                  style={{
                    width: '100%', padding: '6px 10px', fontSize: 11, fontFamily: 'var(--font-mono)',
                    color: 'var(--text-primary)', background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-dim)', borderRadius: 4, outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            ))}
            <button onClick={saveConfig} style={{
              width: '100%', padding: '10px 0', marginTop: 8,
              fontSize: 11, fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: 2,
              borderRadius: 6, cursor: 'pointer', background: `linear-gradient(135deg, ${DISCORD_PURPLE}, #4752C4)`,
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

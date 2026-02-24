/**
 * SlackView — Slack workspace integration
 *
 * Features:
 * - Bot token + App token configuration
 * - Socket mode / HTTP webhook toggle
 * - Channel list with activity
 * - Send test message
 * - Real-time message log
 * - Connection status
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Hash, Wifi, WifiOff, Settings, Send, RefreshCw,
  CheckCircle2, XCircle, MessageSquare, Clock, Users,
  Loader2, Eye, EyeOff, Zap, Radio, Bell,
} from 'lucide-react';
import { gateway } from '../gateway/client.js';
import { useGatewayStore } from '../store/gateway-store.js';

interface SlackConfig {
  botToken: string;
  appToken: string;
  signingSecret: string;
  mode: 'socket' | 'http';
  defaultChannel: string;
  autoReply: boolean;
  webhookPath: string;
}

interface SlackMessage {
  id: string;
  channel: string;
  user: string;
  text: string;
  timestamp: number;
  direction: 'in' | 'out';
}

const DEFAULT_CONFIG: SlackConfig = {
  botToken: '',
  appToken: '',
  signingSecret: '',
  mode: 'socket',
  defaultChannel: '',
  autoReply: true,
  webhookPath: '/slack/events',
};

export function SlackView() {
  const connected = useGatewayStore((s) => s.connected);
  const [tab, setTab] = useState<'status' | 'config' | 'messages'>('status');
  const [config, setConfig] = useState<SlackConfig>(DEFAULT_CONFIG);
  const [slackStatus, setSlackStatus] = useState<{ connected: boolean; workspace?: string; channels?: number }>({ connected: false });
  const [messages, setMessages] = useState<SlackMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showTokens, setShowTokens] = useState(false);
  const [testChannel, setTestChannel] = useState('');
  const [testMessage, setTestMessage] = useState('');
  const [sendResult, setSendResult] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    try {
      const [statusData, configData, msgsData] = await Promise.all([
        gateway.request('slack.status').catch(() => ({ connected: false })),
        gateway.request('slack.config.get').catch(() => DEFAULT_CONFIG),
        gateway.request('slack.messages').catch(() => ({ messages: [] })),
      ]);
      setSlackStatus(statusData as typeof slackStatus);
      setConfig({ ...DEFAULT_CONFIG, ...(configData as Partial<SlackConfig>) });
      setMessages((msgsData as { messages: SlackMessage[] })?.messages ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [connected]);

  useEffect(() => { loadData(); }, [loadData]);

  // Listen for incoming messages
  useEffect(() => {
    const handler = (payload: unknown) => {
      const msg = payload as SlackMessage;
      setMessages((prev) => [...prev.slice(-200), msg]);
    };
    gateway.on('slack.message', handler);
    return () => { gateway.off('slack.message', handler); };
  }, []);

  const saveConfig = async () => {
    setSaving(true);
    try {
      await gateway.request('slack.config.set', config);
      setSaving(false);
    } catch {
      setSaving(false);
    }
  };

  const connectSlack = async () => {
    try {
      await gateway.request('slack.connect');
      setTimeout(loadData, 2000);
    } catch { /* ignore */ }
  };

  const sendTestMsg = async () => {
    if (!testMessage.trim()) return;
    try {
      const result = await gateway.request('slack.send', {
        channel: testChannel || config.defaultChannel,
        message: testMessage,
      });
      setSendResult('✓ Message sent');
      setTestMessage('');
      setTimeout(() => setSendResult(null), 3000);
    } catch (e) {
      setSendResult(`✗ ${(e as Error).message}`);
    }
  };

  const TABS = [
    { id: 'status' as const, label: 'Status', icon: Wifi },
    { id: 'config' as const, label: 'Config', icon: Settings },
    { id: 'messages' as const, label: 'Messages', icon: MessageSquare },
  ];

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 8,
          background: 'rgba(74,21,75,0.2)', border: '1px solid rgba(74,21,75,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Hash size={20} color="#E01E5A" />
        </div>
        <div>
          <h1 style={{
            fontFamily: 'var(--font-display)', fontSize: 16,
            letterSpacing: 3, color: 'var(--text-primary)', margin: 0,
          }}>
            SLACK
          </h1>
          <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '2px 0 0' }}>
            Workspace messaging — Bot &amp; App integration
          </p>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            display: 'flex', alignItems: 'center', gap: 4,
            fontSize: 10, fontWeight: 600,
            color: slackStatus.connected ? '#00ff41' : 'var(--text-muted)',
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: slackStatus.connected ? '#00ff41' : '#484f58',
              boxShadow: slackStatus.connected ? '0 0 6px rgba(0,255,65,0.5)' : 'none',
            }} />
            {slackStatus.connected ? 'CONNECTED' : 'DISCONNECTED'}
          </span>
        </div>
      </div>

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
              background: tab === t.id ? 'var(--green-dim)' : 'transparent',
              border: `1px solid ${tab === t.id ? 'var(--green-muted)' : 'transparent'}`,
              color: tab === t.id ? 'var(--green-bright)' : 'var(--text-muted)',
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Connection card */}
          <div style={{
            background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
            borderRadius: 8, padding: 20,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              {slackStatus.connected ? (
                <Wifi size={16} color="#00ff41" />
              ) : (
                <WifiOff size={16} color="var(--text-muted)" />
              )}
              <span style={{
                fontSize: 12, fontWeight: 700,
                color: slackStatus.connected ? '#00ff41' : 'var(--text-muted)',
              }}>
                {slackStatus.connected ? 'Connected to Slack' : 'Not Connected'}
              </span>
            </div>

            {slackStatus.workspace && (
              <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '8px 16px', fontSize: 11 }}>
                <span style={{ color: 'var(--text-muted)' }}>Workspace</span>
                <span style={{ color: 'var(--text-primary)' }}>{slackStatus.workspace}</span>
                <span style={{ color: 'var(--text-muted)' }}>Channels</span>
                <span style={{ color: 'var(--text-primary)' }}>{slackStatus.channels ?? 0}</span>
                <span style={{ color: 'var(--text-muted)' }}>Mode</span>
                <span style={{ color: 'var(--text-primary)', textTransform: 'uppercase' }}>{config.mode}</span>
              </div>
            )}

            {!slackStatus.connected && config.botToken && (
              <button
                onClick={connectSlack}
                style={{
                  marginTop: 12, padding: '8px 20px', fontSize: 11,
                  background: 'rgba(224,30,90,0.15)', border: '1px solid rgba(224,30,90,0.4)',
                  color: '#E01E5A', borderRadius: 6, cursor: 'pointer',
                  fontFamily: 'var(--font-display)', letterSpacing: 1,
                }}
              >
                CONNECT TO SLACK
              </button>
            )}
          </div>

          {/* Send test message */}
          <div style={{
            background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
            borderRadius: 8, padding: 20,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Send size={14} color="var(--cyan-bright)" />
              <span style={{
                fontFamily: 'var(--font-display)', fontSize: 11,
                letterSpacing: 2, color: 'var(--cyan-bright)',
              }}>
                SEND TEST MESSAGE
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input
                value={testChannel}
                onChange={(e) => setTestChannel(e.target.value)}
                placeholder="#channel or @user"
                style={{
                  width: 160, padding: '6px 10px', fontSize: 11,
                  background: 'var(--bg-tertiary)', border: '1px solid var(--border-dim)',
                  borderRadius: 4, color: 'var(--text-primary)', outline: 'none',
                }}
              />
              <input
                value={testMessage}
                onChange={(e) => setTestMessage(e.target.value)}
                placeholder="Message text..."
                onKeyDown={(e) => e.key === 'Enter' && sendTestMsg()}
                style={{
                  flex: 1, padding: '6px 10px', fontSize: 11,
                  background: 'var(--bg-tertiary)', border: '1px solid var(--border-dim)',
                  borderRadius: 4, color: 'var(--text-primary)', outline: 'none',
                }}
              />
              <button
                onClick={sendTestMsg}
                disabled={!testMessage.trim()}
                style={{
                  padding: '6px 14px', fontSize: 10,
                  background: testMessage.trim() ? 'var(--green-dim)' : 'transparent',
                  border: `1px solid ${testMessage.trim() ? 'var(--green-muted)' : 'var(--border-dim)'}`,
                  color: testMessage.trim() ? 'var(--green-bright)' : 'var(--text-muted)',
                  borderRadius: 4, cursor: testMessage.trim() ? 'pointer' : 'default',
                }}
              >
                <Send size={11} />
              </button>
            </div>
            {sendResult && (
              <span style={{ fontSize: 10, color: sendResult.startsWith('✓') ? '#00ff41' : '#ef4444' }}>
                {sendResult}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Config Tab */}
      {tab === 'config' && (
        <div style={{
          background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
          borderRadius: 8, padding: 20,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <span style={{
              fontFamily: 'var(--font-display)', fontSize: 11,
              letterSpacing: 2, color: 'var(--green-bright)',
            }}>
              SLACK CONFIGURATION
            </span>
            <button
              onClick={() => setShowTokens(!showTokens)}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'var(--text-muted)', fontSize: 10,
              }}
            >
              {showTokens ? <EyeOff size={12} /> : <Eye size={12} />}
              {showTokens ? 'Hide' : 'Show'} tokens
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <ConfigField
              label="Bot Token"
              value={config.botToken}
              onChange={(v) => setConfig({ ...config, botToken: v })}
              placeholder="xoxb-..."
              secret={!showTokens}
            />
            <ConfigField
              label="App Token"
              value={config.appToken}
              onChange={(v) => setConfig({ ...config, appToken: v })}
              placeholder="xapp-..."
              secret={!showTokens}
              hint="Required for Socket Mode"
            />
            <ConfigField
              label="Signing Secret"
              value={config.signingSecret}
              onChange={(v) => setConfig({ ...config, signingSecret: v })}
              placeholder="Signing secret from Slack app settings"
              secret={!showTokens}
              hint="Required for HTTP mode"
            />
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 9, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                  MODE
                </label>
                <div style={{ display: 'flex', gap: 4 }}>
                  {(['socket', 'http'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setConfig({ ...config, mode: m })}
                      style={{
                        padding: '5px 14px', fontSize: 10,
                        background: config.mode === m ? 'var(--green-dim)' : 'transparent',
                        border: `1px solid ${config.mode === m ? 'var(--green-muted)' : 'var(--border-dim)'}`,
                        color: config.mode === m ? 'var(--green-bright)' : 'var(--text-muted)',
                        borderRadius: 4, cursor: 'pointer',
                        textTransform: 'uppercase', fontWeight: 600,
                      }}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <ConfigField
                label="Default Channel"
                value={config.defaultChannel}
                onChange={(v) => setConfig({ ...config, defaultChannel: v })}
                placeholder="#general"
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={config.autoReply}
                onChange={(e) => setConfig({ ...config, autoReply: e.target.checked })}
              />
              <label style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                Auto-reply with Jarvis agent (forward messages to agent for response)
              </label>
            </div>
          </div>

          <button
            onClick={saveConfig}
            disabled={saving}
            style={{
              marginTop: 16, padding: '8px 24px', fontSize: 11,
              background: 'var(--green-dim)', border: '1px solid var(--green-muted)',
              color: 'var(--green-bright)', borderRadius: 6, cursor: 'pointer',
              fontFamily: 'var(--font-display)', letterSpacing: 1,
            }}
          >
            {saving ? 'SAVING...' : 'SAVE CONFIG'}
          </button>
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
              letterSpacing: 2, color: 'var(--cyan-bright)',
            }}>
              MESSAGE LOG ({messages.length})
            </span>
            <button
              onClick={loadData}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'var(--text-muted)',
              }}
            >
              <RefreshCw size={12} />
            </button>
          </div>
          <div style={{ maxHeight: 500, overflow: 'auto' }}>
            {messages.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 11 }}>
                No messages yet
              </div>
            ) : messages.map((msg, i) => (
              <div key={msg.id ?? i} style={{
                padding: '8px 16px', borderBottom: '1px solid var(--border-dim)',
                display: 'flex', gap: 10, alignItems: 'flex-start',
              }}>
                <span style={{
                  fontSize: 8, padding: '2px 6px', borderRadius: 3, marginTop: 2,
                  background: msg.direction === 'in' ? 'rgba(0,200,255,0.08)' : 'rgba(0,255,65,0.08)',
                  color: msg.direction === 'in' ? 'var(--cyan-bright)' : 'var(--green-bright)',
                  fontWeight: 700,
                }}>
                  {msg.direction === 'in' ? 'IN' : 'OUT'}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 2 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-primary)' }}>
                      {msg.user}
                    </span>
                    <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      #{msg.channel}
                    </span>
                    <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
                    {msg.text}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Reusable config field ────────────────────────────────────────

function ConfigField({ label, value, onChange, placeholder, secret, hint }: {
  label: string; value: string;
  onChange: (v: string) => void;
  placeholder?: string; secret?: boolean; hint?: string;
}) {
  return (
    <div style={{ flex: 1 }}>
      <label style={{ fontSize: 9, color: 'var(--text-muted)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
        {label}
      </label>
      <input
        type={secret ? 'password' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%', padding: '6px 10px', fontSize: 11,
          background: 'var(--bg-tertiary)', border: '1px solid var(--border-dim)',
          borderRadius: 4, color: 'var(--text-primary)', outline: 'none',
          fontFamily: 'var(--font-mono)',
        }}
      />
      {hint && <span style={{ fontSize: 8, color: 'var(--text-muted)', marginTop: 2, display: 'block' }}>{hint}</span>}
    </div>
  );
}

import { useEffect, useState, useCallback } from 'react';
import { useGatewayStore } from '../store/gateway-store.js';
import { gateway } from '../gateway/client.js';
import {
  Bell,
  BellRing,
  Volume2,
  VolumeX,
  Webhook,
  Plus,
  Trash2,
  TestTube,
  Save,
  RefreshCw,
  Moon,
  Mic,
  Monitor,
  CheckCircle,
  XCircle,
  AlertTriangle,
} from 'lucide-react';

interface WebhookConfig {
  name: string;
  url: string;
  type: 'slack' | 'discord' | 'ntfy' | 'generic';
  enabled: boolean;
  minPriority?: number;
}

interface NotificationsConfig {
  enableNative: boolean;
  enableWebhook: boolean;
  webhooks: WebhookConfig[];
  enableSound: boolean;
  soundName: string;
  enableTTS: boolean;
  notifyOnTaskComplete: boolean;
  notifyOnTaskFail: boolean;
  minPriority: number;
  quietHours?: { start: number; end: number };
}

const MAC_SOUNDS = ['Glass', 'Hero', 'Ping', 'Pop', 'Purr', 'Sosumi', 'Submarine', 'Tink', 'Blow', 'Bottle', 'Frog', 'Funk', 'Morse', 'Basso'];

export function NotificationsView() {
  const connected = useGatewayStore((s) => s.connected);
  const [config, setConfig] = useState<NotificationsConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [showAddWebhook, setShowAddWebhook] = useState(false);
  const [newWebhook, setNewWebhook] = useState<Partial<WebhookConfig>>({
    name: '', url: '', type: 'generic', minPriority: 3,
  });

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const data = await gateway.request<NotificationsConfig>('notifications.config.get');
      setConfig(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (connected) void fetchConfig();
  }, [connected, fetchConfig]);

  const saveConfig = async (updates: Partial<NotificationsConfig>) => {
    setSaving(true);
    try {
      const result = await gateway.request<{ success: boolean; config: NotificationsConfig }>('notifications.config.set', updates);
      if (result.config) setConfig(result.config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const updateConfig = (key: keyof NotificationsConfig, value: unknown) => {
    if (!config) return;
    const updated = { ...config, [key]: value };
    setConfig(updated);
    void saveConfig({ [key]: value });
  };

  const handleAddWebhook = () => {
    if (!config || !newWebhook.name || !newWebhook.url) return;
    const webhook: WebhookConfig = {
      name: newWebhook.name,
      url: newWebhook.url,
      type: (newWebhook.type as WebhookConfig['type']) ?? 'generic',
      enabled: true,
      minPriority: newWebhook.minPriority,
    };
    const webhooks = [...config.webhooks, webhook];
    updateConfig('webhooks', webhooks);
    setShowAddWebhook(false);
    setNewWebhook({ name: '', url: '', type: 'generic', minPriority: 3 });
  };

  const removeWebhook = (name: string) => {
    if (!config) return;
    const webhooks = config.webhooks.filter(w => w.name !== name);
    updateConfig('webhooks', webhooks);
  };

  const toggleWebhook = (name: string) => {
    if (!config) return;
    const webhooks = config.webhooks.map(w =>
      w.name === name ? { ...w, enabled: !w.enabled } : w
    );
    updateConfig('webhooks', webhooks);
  };

  const handleTest = async () => {
    setTestResult(null);
    try {
      const result = await gateway.request<{ success: boolean; message: string }>('notifications.test');
      setTestResult(result.success ? '✅ Test notification sent!' : `❌ ${result.message}`);
    } catch {
      setTestResult('❌ Failed to send test');
    }
    setTimeout(() => setTestResult(null), 4000);
  };

  if (!config) {
    return (
      <div style={{ height: '100%', overflow: 'auto', padding: 20, background: 'var(--bg-primary)' }}>
        <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          {loading ? 'Loading notifications config...' : 'Not connected'}
        </div>
      </div>
    );
  }

  return (
    <div style={{
      height: '100%',
      overflow: 'auto',
      padding: 20,
      background: 'var(--bg-primary)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Bell size={20} color="var(--amber)" />
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 16,
          letterSpacing: 3,
          color: 'var(--amber)',
          textShadow: '0 0 8px rgba(255,170,0,0.4)',
          margin: 0,
        }}>
          NOTIFICATIONS
        </h1>

        {saved && (
          <span style={{
            fontSize: 9,
            padding: '2px 8px',
            borderRadius: 3,
            background: 'rgba(0,255,65,0.1)',
            border: '1px solid var(--green-dim)',
            color: 'var(--green-bright)',
            fontFamily: 'var(--font-display)',
            letterSpacing: 1,
          }}>SAVED</span>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={handleTest} style={{
            fontSize: 9, padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 4,
            background: 'rgba(255,170,0,0.08)', border: '1px solid rgba(255,170,0,0.3)',
            borderRadius: 4, color: 'var(--amber)', cursor: 'pointer', fontFamily: 'var(--font-display)', letterSpacing: 1,
          }}>
            <TestTube size={10} /> TEST
          </button>
          <button onClick={() => void fetchConfig()} style={{
            fontSize: 9, padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 4,
            background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)',
            borderRadius: 4, color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-display)', letterSpacing: 1,
          }}>
            <RefreshCw size={10} /> RELOAD
          </button>
        </div>
      </div>

      {testResult && (
        <div style={{
          padding: '8px 14px',
          background: testResult.startsWith('✅') ? 'rgba(0,255,65,0.06)' : 'rgba(255,51,51,0.06)',
          border: `1px solid ${testResult.startsWith('✅') ? 'var(--green-dim)' : 'var(--red-dim)'}`,
          borderRadius: 6,
          fontSize: 11,
          fontFamily: 'var(--font-mono)',
          color: testResult.startsWith('✅') ? 'var(--green-bright)' : 'var(--red-bright)',
          marginBottom: 16,
        }}>
          {testResult}
        </div>
      )}

      <div style={{ display: 'grid', gap: 16 }}>
        {/* Channel Toggles */}
        <Section title="CHANNELS" icon={<BellRing size={14} />}>
          <ToggleRow
            icon={<Monitor size={14} />}
            label="macOS Native Notifications"
            description="System notifications via Notification Center"
            enabled={config.enableNative}
            onToggle={() => updateConfig('enableNative', !config.enableNative)}
          />
          <ToggleRow
            icon={<Volume2 size={14} />}
            label="Sound Alerts"
            description="Play sound for notifications"
            enabled={config.enableSound}
            onToggle={() => updateConfig('enableSound', !config.enableSound)}
          />
          {config.enableSound && (
            <div style={{ paddingLeft: 30, marginTop: -4, marginBottom: 8 }}>
              <label style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-display)', letterSpacing: 1 }}>
                SOUND NAME
              </label>
              <select
                value={config.soundName}
                onChange={(e) => updateConfig('soundName', e.target.value)}
                style={{
                  display: 'block',
                  marginTop: 3,
                  fontSize: 11,
                  padding: '4px 8px',
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-primary)',
                  borderRadius: 4,
                  color: 'var(--text-secondary)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {MAC_SOUNDS.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          )}
          <ToggleRow
            icon={<Mic size={14} />}
            label="Text-to-Speech"
            description="Speak notifications aloud via Siri TTS"
            enabled={config.enableTTS}
            onToggle={() => updateConfig('enableTTS', !config.enableTTS)}
          />
          <ToggleRow
            icon={<Webhook size={14} />}
            label="Webhook Notifications"
            description="Send to Slack, Discord, ntfy, or custom endpoints"
            enabled={config.enableWebhook}
            onToggle={() => updateConfig('enableWebhook', !config.enableWebhook)}
          />
        </Section>

        {/* Auto-notify triggers */}
        <Section title="TRIGGERS" icon={<AlertTriangle size={14} />}>
          <ToggleRow
            icon={<CheckCircle size={14} />}
            label="Notify on Task Completion"
            description="Send notification when a task finishes successfully"
            enabled={config.notifyOnTaskComplete}
            onToggle={() => updateConfig('notifyOnTaskComplete', !config.notifyOnTaskComplete)}
          />
          <ToggleRow
            icon={<XCircle size={14} />}
            label="Notify on Task Failure"
            description="Send notification when a task fails"
            enabled={config.notifyOnTaskFail}
            onToggle={() => updateConfig('notifyOnTaskFail', !config.notifyOnTaskFail)}
          />

          <div style={{ marginTop: 8 }}>
            <label style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-display)', letterSpacing: 1 }}>
              MINIMUM PRIORITY (1-10)
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
              <input
                type="range"
                min={1}
                max={10}
                value={config.minPriority}
                onChange={(e) => updateConfig('minPriority', Number(e.target.value))}
                style={{ flex: 1, accentColor: 'var(--amber)' }}
              />
              <span style={{
                fontSize: 14,
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                color: config.minPriority >= 8 ? 'var(--red-bright)' : config.minPriority >= 5 ? 'var(--amber)' : 'var(--green-bright)',
                minWidth: 20,
                textAlign: 'center',
              }}>
                {config.minPriority}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
              <span>LOW</span>
              <span>NORMAL</span>
              <span>CRITICAL</span>
            </div>
          </div>
        </Section>

        {/* Quiet Hours */}
        <Section title="QUIET HOURS" icon={<Moon size={14} />}>
          <p style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', margin: '0 0 10px 0' }}>
            During quiet hours, sound and native notifications are suppressed. Webhooks still fire.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div>
              <label style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-display)', letterSpacing: 1 }}>
                START
              </label>
              <select
                value={config.quietHours?.start ?? 23}
                onChange={(e) => updateConfig('quietHours', { start: Number(e.target.value), end: config.quietHours?.end ?? 7 })}
                style={{
                  display: 'block',
                  marginTop: 3,
                  fontSize: 11,
                  padding: '4px 8px',
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-primary)',
                  borderRadius: 4,
                  color: 'var(--text-secondary)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                ))}
              </select>
            </div>
            <span style={{ color: 'var(--text-muted)', fontSize: 12, paddingTop: 16 }}>→</span>
            <div>
              <label style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-display)', letterSpacing: 1 }}>
                END
              </label>
              <select
                value={config.quietHours?.end ?? 7}
                onChange={(e) => updateConfig('quietHours', { start: config.quietHours?.start ?? 23, end: Number(e.target.value) })}
                style={{
                  display: 'block',
                  marginTop: 3,
                  fontSize: 11,
                  padding: '4px 8px',
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-primary)',
                  borderRadius: 4,
                  color: 'var(--text-secondary)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                ))}
              </select>
            </div>
            <div style={{ paddingTop: 12, flex: 1 }}>
              <div style={{
                height: 6,
                background: 'var(--bg-primary)',
                borderRadius: 3,
                overflow: 'hidden',
                position: 'relative',
              }}>
                {(() => {
                  const start = config.quietHours?.start ?? 23;
                  const end = config.quietHours?.end ?? 7;
                  const startPct = (start / 24) * 100;
                  const endPct = (end / 24) * 100;
                  if (start <= end) {
                    return <div style={{ position: 'absolute', left: `${startPct}%`, width: `${endPct - startPct}%`, height: '100%', background: 'var(--cyan-bright)', opacity: 0.4, borderRadius: 3 }} />;
                  }
                  return (
                    <>
                      <div style={{ position: 'absolute', left: `${startPct}%`, width: `${100 - startPct}%`, height: '100%', background: 'var(--cyan-bright)', opacity: 0.4, borderRadius: '3px 0 0 3px' }} />
                      <div style={{ position: 'absolute', left: 0, width: `${endPct}%`, height: '100%', background: 'var(--cyan-bright)', opacity: 0.4, borderRadius: '0 3px 3px 0' }} />
                    </>
                  );
                })()}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 7, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
              </div>
            </div>
          </div>
        </Section>

        {/* Webhooks */}
        {config.enableWebhook && (
          <Section title="WEBHOOKS" icon={<Webhook size={14} />}>
            {config.webhooks.length === 0 && (
              <div style={{ color: 'var(--text-muted)', fontSize: 11, fontFamily: 'var(--font-mono)', padding: '8px 0' }}>
                No webhooks configured. Add one below.
              </div>
            )}

            {config.webhooks.map((wh) => (
              <div key={wh.name} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 12px',
                background: 'var(--bg-primary)',
                borderRadius: 4,
                marginBottom: 6,
              }}>
                <button
                  onClick={() => toggleWebhook(wh.name)}
                  style={{
                    width: 14, height: 14,
                    background: wh.enabled ? 'var(--green-bright)' : 'var(--bg-tertiary)',
                    border: `1px solid ${wh.enabled ? 'var(--green-bright)' : 'var(--border-primary)'}`,
                    borderRadius: 3,
                    cursor: 'pointer',
                    padding: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      fontSize: 11,
                      fontFamily: 'var(--font-display)',
                      letterSpacing: 1,
                      color: wh.enabled ? 'var(--text-white)' : 'var(--text-muted)',
                    }}>
                      {wh.name.toUpperCase()}
                    </span>
                    <span style={{
                      fontSize: 8,
                      padding: '1px 5px',
                      borderRadius: 2,
                      background: webhookTypeColor(wh.type),
                      color: '#fff',
                      fontFamily: 'var(--font-mono)',
                    }}>
                      {wh.type}
                    </span>
                    {wh.minPriority && (
                      <span style={{ fontSize: 8, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                        min:{wh.minPriority}
                      </span>
                    )}
                  </div>
                  <div style={{
                    fontSize: 9,
                    color: 'var(--text-muted)',
                    fontFamily: 'var(--font-mono)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {wh.url}
                  </div>
                </div>
                <button
                  onClick={() => removeWebhook(wh.name)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--red-bright)',
                    cursor: 'pointer',
                    padding: 4,
                    opacity: 0.6,
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}

            {/* Add Webhook Form */}
            {!showAddWebhook ? (
              <button
                onClick={() => setShowAddWebhook(true)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  fontSize: 10,
                  fontFamily: 'var(--font-display)',
                  letterSpacing: 1,
                  color: 'var(--cyan-bright)',
                  background: 'rgba(0,255,255,0.04)',
                  border: '1px dashed var(--border-cyan)',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                <Plus size={12} /> ADD WEBHOOK
              </button>
            ) : (
              <div style={{
                padding: 12,
                background: 'var(--bg-primary)',
                borderRadius: 6,
                border: '1px solid var(--border-cyan)',
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                  <div>
                    <label style={{ fontSize: 8, color: 'var(--text-muted)', fontFamily: 'var(--font-display)', letterSpacing: 1 }}>NAME</label>
                    <input
                      value={newWebhook.name ?? ''}
                      onChange={(e) => setNewWebhook({ ...newWebhook, name: e.target.value })}
                      placeholder="my-slack"
                      style={{ width: '100%', fontSize: 11, padding: '4px 8px', marginTop: 2 }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 8, color: 'var(--text-muted)', fontFamily: 'var(--font-display)', letterSpacing: 1 }}>TYPE</label>
                    <select
                      value={newWebhook.type ?? 'generic'}
                      onChange={(e) => setNewWebhook({ ...newWebhook, type: e.target.value as WebhookConfig['type'] })}
                      style={{
                        width: '100%', fontSize: 11, padding: '4px 8px', marginTop: 2,
                        background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
                        borderRadius: 4, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)',
                      }}
                    >
                      <option value="slack">Slack</option>
                      <option value="discord">Discord</option>
                      <option value="ntfy">ntfy.sh</option>
                      <option value="generic">Generic</option>
                    </select>
                  </div>
                </div>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ fontSize: 8, color: 'var(--text-muted)', fontFamily: 'var(--font-display)', letterSpacing: 1 }}>URL</label>
                  <input
                    value={newWebhook.url ?? ''}
                    onChange={(e) => setNewWebhook({ ...newWebhook, url: e.target.value })}
                    placeholder="https://hooks.slack.com/services/..."
                    style={{ width: '100%', fontSize: 11, padding: '4px 8px', marginTop: 2 }}
                  />
                </div>
                <div style={{ marginBottom: 10 }}>
                  <label style={{ fontSize: 8, color: 'var(--text-muted)', fontFamily: 'var(--font-display)', letterSpacing: 1 }}>MIN PRIORITY</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={newWebhook.minPriority ?? 3}
                    onChange={(e) => setNewWebhook({ ...newWebhook, minPriority: Number(e.target.value) })}
                    style={{ width: 60, fontSize: 11, padding: '4px 8px', marginTop: 2 }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={handleAddWebhook}
                    style={{
                      fontSize: 9, padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 4,
                      background: 'rgba(0,255,65,0.08)', border: '1px solid var(--green-dim)',
                      borderRadius: 4, color: 'var(--green-bright)', cursor: 'pointer',
                      fontFamily: 'var(--font-display)', letterSpacing: 1,
                    }}
                  >
                    <Save size={10} /> ADD
                  </button>
                  <button
                    onClick={() => setShowAddWebhook(false)}
                    style={{
                      fontSize: 9, padding: '4px 12px',
                      background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)',
                      borderRadius: 4, color: 'var(--text-muted)', cursor: 'pointer',
                      fontFamily: 'var(--font-display)', letterSpacing: 1,
                    }}
                  >
                    CANCEL
                  </button>
                </div>
              </div>
            )}
          </Section>
        )}

        {/* Summary */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
          gap: 10,
          marginTop: 4,
        }}>
          <SummaryBox
            label="Channels Active"
            value={String(
              [config.enableNative, config.enableSound, config.enableTTS, config.enableWebhook].filter(Boolean).length
            )}
            color="var(--green-bright)"
          />
          <SummaryBox
            label="Webhooks"
            value={`${config.webhooks.filter(w => w.enabled).length}/${config.webhooks.length}`}
            color="var(--cyan-bright)"
          />
          <SummaryBox
            label="Min Priority"
            value={String(config.minPriority)}
            color="var(--amber)"
          />
          <SummaryBox
            label="Quiet Hours"
            value={config.quietHours ? `${config.quietHours.start}-${config.quietHours.end}` : 'OFF'}
            color="var(--cyan-bright)"
          />
        </div>
      </div>
    </div>
  );
}

/* === Sub-components === */

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border-primary)',
      borderRadius: 6,
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '8px 14px',
        background: 'var(--bg-tertiary)',
        borderBottom: '1px solid var(--border-dim)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <span style={{ color: 'var(--amber)' }}>{icon}</span>
        <span style={{
          fontFamily: 'var(--font-display)',
          fontSize: 11,
          letterSpacing: 2,
          color: 'var(--amber)',
        }}>{title}</span>
      </div>
      <div style={{ padding: 14 }}>
        {children}
      </div>
    </div>
  );
}

function ToggleRow({ icon, label, description, enabled, onToggle }: {
  icon: React.ReactNode;
  label: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '8px 0',
      borderBottom: '1px solid rgba(255,255,255,0.03)',
    }}>
      <span style={{ color: enabled ? 'var(--green-bright)' : 'var(--text-muted)' }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{
          fontSize: 11,
          fontFamily: 'var(--font-display)',
          letterSpacing: 0.5,
          color: enabled ? 'var(--text-white)' : 'var(--text-muted)',
        }}>
          {label}
        </div>
        <div style={{
          fontSize: 9,
          color: 'var(--text-muted)',
          fontFamily: 'var(--font-mono)',
          marginTop: 1,
        }}>
          {description}
        </div>
      </div>
      <button
        onClick={onToggle}
        style={{
          width: 36,
          height: 18,
          borderRadius: 9,
          border: 'none',
          background: enabled ? 'var(--green-bright)' : 'var(--bg-tertiary)',
          cursor: 'pointer',
          position: 'relative',
          transition: 'background 0.2s ease',
          padding: 0,
        }}
      >
        <span style={{
          position: 'absolute',
          top: 2,
          left: enabled ? 20 : 2,
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: enabled ? '#000' : 'var(--text-muted)',
          transition: 'left 0.2s ease',
        }} />
      </button>
    </div>
  );
}

function SummaryBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border-primary)',
      borderRadius: 6,
      padding: '10px 12px',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 18, fontFamily: 'var(--font-display)', color, fontWeight: 700 }}>
        {value}
      </div>
      <div style={{ fontSize: 8, fontFamily: 'var(--font-display)', color: 'var(--text-muted)', letterSpacing: 1, marginTop: 3 }}>
        {label.toUpperCase()}
      </div>
    </div>
  );
}

function webhookTypeColor(type: string): string {
  switch (type) {
    case 'slack': return 'rgba(74,21,75,0.8)';
    case 'discord': return 'rgba(88,101,242,0.6)';
    case 'ntfy': return 'rgba(0,150,136,0.6)';
    default: return 'rgba(100,100,100,0.5)';
  }
}

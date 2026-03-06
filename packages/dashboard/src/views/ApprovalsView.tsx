/**
 * ApprovalsView — Exec Approvals (Human-in-the-Loop)
 *
 * Inspired by OpenClaw's exec approval system.
 * Shows pending tool execution requests from agents that need human approval.
 * Agents can request approval for risky operations, and the human can approve/deny.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Check,
  X,
  Clock,
  RefreshCw,
  Settings,
  Save,
  History,
  Bot,
  Info,
} from 'lucide-react';
import { gateway } from '../gateway/client.js';

/* ─── Types ─── */

interface PendingApproval {
  id: string;
  agentId: string;
  tool: string;
  params: Record<string, unknown>;
  reason: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  createdAt: number;
  expiresAt: number;
}

interface ApprovalHistoryItem {
  id: string;
  agentId: string;
  tool: string;
  reason: string;
  riskLevel: string;
  decision: 'approved' | 'denied';
  decidedAt: number;
  denyReason?: string;
}

interface ApprovalConfig {
  enabled: boolean;
  autoApprove: string[];
  requireApproval: string[];
  alwaysDeny: string[];
  timeoutSeconds: number;
  soundAlert: boolean;
  desktopNotification: boolean;
}

/* ─── Constants ─── */

const RISK_COLORS: Record<string, { bg: string; border: string; text: string; icon: typeof ShieldCheck }> = {
  low: { bg: 'rgba(0,255,65,0.06)', border: 'rgba(0,255,65,0.2)', text: 'var(--green-bright)', icon: ShieldCheck },
  medium: { bg: 'rgba(251,191,36,0.06)', border: 'rgba(251,191,36,0.2)', text: '#fbbf24', icon: ShieldAlert },
  high: { bg: 'rgba(255,107,107,0.06)', border: 'rgba(255,107,107,0.2)', text: '#ff6b6b', icon: ShieldAlert },
  critical: { bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.3)', text: '#ef4444', icon: ShieldX },
};

const TABS = ['Pending', 'History', 'Config'] as const;
type Tab = (typeof TABS)[number];

/* ─── Styles ─── */

const btnStyle: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: 11,
  fontFamily: 'var(--font-ui)',
  fontWeight: 600,
  letterSpacing: 0.5,
  border: '1px solid var(--border-primary)',
  borderRadius: 4,
  background: 'var(--bg-tertiary)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const approveBtn: React.CSSProperties = {
  ...btnStyle,
  background: 'rgba(0,255,65,0.1)',
  border: '1px solid var(--green-primary)',
  color: 'var(--green-bright)',
  padding: '8px 20px',
  fontSize: 12,
};

const denyBtn: React.CSSProperties = {
  ...btnStyle,
  background: 'rgba(255,107,107,0.1)',
  border: '1px solid rgba(255,107,107,0.3)',
  color: '#ff6b6b',
  padding: '8px 20px',
  fontSize: 12,
};

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-primary)',
  borderRadius: 8,
  padding: 16,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  fontSize: 12,
  fontFamily: 'var(--font-mono)',
  background: 'var(--bg-primary)',
  border: '1px solid var(--border-primary)',
  borderRadius: 4,
  color: 'var(--text-primary)',
  outline: 'none',
};

/* ─── Component ─── */

export function ApprovalsView() {
  const [tab, setTab] = useState<Tab>('Pending');
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [history, setHistory] = useState<ApprovalHistoryItem[]>([]);
  const [config, setConfig] = useState<ApprovalConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [denyReason, setDenyReason] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [p, h, c] = await Promise.all([
        gateway.request('approvals.list', {}) as Promise<{ approvals: PendingApproval[] }>,
        gateway.request('approvals.history', {}) as Promise<{ history: ApprovalHistoryItem[] }>,
        gateway.request('approvals.config.get', {}) as Promise<ApprovalConfig>,
      ]);
      setPending(p.approvals);
      setHistory(h.history.reverse()); // newest first
      setConfig(c);
    } catch {
      /* load failed */
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Listen for real-time approval events
  useEffect(() => {
    const unsub1 = gateway.on('approval.requested', (data: PendingApproval) => {
      setPending(prev => [data, ...prev]);
      // Play sound alert (placeholder — noop for now)
    });

    const unsub2 = gateway.on('approval.resolved', (data: { approvalId: string }) => {
      setPending(prev => prev.filter(a => a.id !== data.approvalId));
    });

    return () => {
      if (typeof unsub1 === 'function') unsub1();
      if (typeof unsub2 === 'function') unsub2();
    };
  }, []);

  // Auto-refresh every 5s for pending
  useEffect(() => {
    if (tab !== 'Pending') return;
    const timer = setInterval(async () => {
      try {
        const p = await gateway.request('approvals.list', {}) as { approvals: PendingApproval[] };
        setPending(p.approvals);
      } catch { /* */ }
    }, 5000);
    return () => clearInterval(timer);
  }, [tab]);

  const handleApprove = async (id: string) => {
    try {
      await gateway.request('approvals.approve', { approvalId: id });
      setPending(prev => prev.filter(a => a.id !== id));
      refresh();
    } catch {
      /* approve failed */
    }
  };

  const handleDeny = async (id: string) => {
    try {
      await gateway.request('approvals.deny', { approvalId: id, reason: denyReason[id] || '' });
      setPending(prev => prev.filter(a => a.id !== id));
      setDenyReason(prev => { const n = { ...prev }; delete n[id]; return n; });
      refresh();
    } catch {
      /* deny failed */
    }
  };

  const saveConfig = async () => {
    if (!config) return;
    try {
      await gateway.request('approvals.config.set', config);
    } catch {
      /* save config failed */
    }
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 20px', borderBottom: '1px solid var(--border-primary)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ShieldCheck size={20} color="#fbbf24" />
          <span style={{
            fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700,
            letterSpacing: 2, color: '#fbbf24', textShadow: '0 0 10px rgba(251,191,36,0.3)',
          }}>
            EXEC APPROVALS
          </span>
          {pending.length > 0 && (
            <span style={{
              padding: '2px 8px', borderRadius: 10,
              background: 'rgba(255,107,107,0.15)', border: '1px solid rgba(255,107,107,0.3)',
              fontSize: 10, fontWeight: 700, color: '#ff6b6b',
              animation: 'pulse 2s ease-in-out infinite',
            }}>
              {pending.length} PENDING
            </span>
          )}
        </div>
        <button onClick={refresh} style={btnStyle} disabled={loading}>
          <RefreshCw size={12} /> REFRESH
        </button>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex', gap: 0, padding: '0 20px',
        borderBottom: '1px solid var(--border-primary)', flexShrink: 0,
      }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '10px 16px', fontSize: 11, fontFamily: 'var(--font-ui)',
            fontWeight: 600, letterSpacing: 0.5,
            color: tab === t ? '#fbbf24' : 'var(--text-muted)',
            background: 'transparent', border: 'none',
            borderBottom: tab === t ? '2px solid #fbbf24' : '2px solid transparent',
            cursor: 'pointer',
          }}>
            {t === 'Pending' && pending.length > 0 ? `PENDING (${pending.length})` : t.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>

        {/* ─── Pending Tab ─── */}
        {tab === 'Pending' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {pending.length === 0 && (
              <div style={{
                ...cardStyle, textAlign: 'center', padding: 60,
                color: 'var(--text-muted)', fontSize: 12,
              }}>
                <ShieldCheck size={32} style={{ marginBottom: 12, opacity: 0.4 }} />
                <div style={{ fontFamily: 'var(--font-display)', letterSpacing: 1, marginBottom: 6 }}>
                  NO PENDING APPROVALS
                </div>
                <div style={{ fontSize: 10 }}>
                  When agents request permission for risky operations, they'll appear here.
                </div>
              </div>
            )}

            {pending.map(approval => {
              const risk = RISK_COLORS[approval.riskLevel] || RISK_COLORS.medium;
              const RiskIcon = risk.icon;
              const timeLeft = Math.max(0, Math.round((approval.expiresAt - Date.now()) / 1000));

              return (
                <div key={approval.id} style={{
                  ...cardStyle,
                  borderColor: risk.border,
                  background: risk.bg,
                  animation: approval.riskLevel === 'critical' ? 'pulse 2s ease-in-out infinite' : undefined,
                }}>
                  {/* Top row */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <RiskIcon size={20} color={risk.text} />
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span style={{
                            fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-display)',
                            letterSpacing: 1, color: risk.text,
                          }}>
                            {approval.tool.toUpperCase().replace(/_/g, ' ')}
                          </span>
                          <span style={{
                            fontSize: 8, padding: '2px 6px', borderRadius: 3,
                            background: `${risk.text}15`, border: `1px solid ${risk.border}`,
                            color: risk.text, fontFamily: 'var(--font-ui)', fontWeight: 700, letterSpacing: 0.5,
                          }}>
                            {approval.riskLevel.toUpperCase()}
                          </span>
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', gap: 12 }}>
                          <span><Bot size={10} /> {approval.agentId}</span>
                          <span><Clock size={10} /> {timeLeft}s left</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Reason */}
                  <div style={{
                    padding: '8px 12px', borderRadius: 6, marginBottom: 12,
                    background: 'var(--bg-primary)', border: '1px solid var(--border-dim)',
                  }}>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 4, fontFamily: 'var(--font-ui)', fontWeight: 600, letterSpacing: 0.5 }}>
                      REASON
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-primary)', fontFamily: 'var(--font-ui)', lineHeight: 1.5 }}>
                      {approval.reason}
                    </div>
                  </div>

                  {/* Params */}
                  {Object.keys(approval.params).length > 0 && (
                    <div style={{
                      padding: '8px 12px', borderRadius: 6, marginBottom: 12,
                      background: 'var(--bg-primary)', border: '1px solid var(--border-dim)',
                    }}>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 4, fontFamily: 'var(--font-ui)', fontWeight: 600, letterSpacing: 0.5 }}>
                        PARAMETERS
                      </div>
                      <pre style={{
                        fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)',
                        margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                      }}>
                        {JSON.stringify(approval.params, null, 2)}
                      </pre>
                    </div>
                  )}

                  {/* Deny reason input */}
                  <input
                    value={denyReason[approval.id] || ''}
                    onChange={e => setDenyReason(prev => ({ ...prev, [approval.id]: e.target.value }))}
                    placeholder="Deny reason (optional)..."
                    style={{ ...inputStyle, marginBottom: 12, fontSize: 11 }}
                  />

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                    <button onClick={() => handleDeny(approval.id)} style={denyBtn}>
                      <X size={14} /> DENY
                    </button>
                    <button onClick={() => handleApprove(approval.id)} style={approveBtn}>
                      <Check size={14} /> APPROVE
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ─── History Tab ─── */}
        {tab === 'History' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {history.length === 0 && (
              <div style={{ ...cardStyle, textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 12 }}>
                <History size={24} style={{ marginBottom: 8, opacity: 0.4 }} />
                <div>No approval history yet.</div>
              </div>
            )}
            {history.map(item => (
              <div key={item.id} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                background: 'var(--bg-secondary)', border: '1px solid var(--border-dim)',
                borderRadius: 6,
              }}>
                {item.decision === 'approved' ? (
                  <Check size={14} color="var(--green-bright)" />
                ) : (
                  <X size={14} color="#ff6b6b" />
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span style={{
                      fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-ui)',
                      color: item.decision === 'approved' ? 'var(--green-bright)' : '#ff6b6b',
                    }}>
                      {item.tool.replace(/_/g, ' ')}
                    </span>
                    <span style={{
                      fontSize: 8, padding: '1px 6px', borderRadius: 3,
                      background: item.decision === 'approved' ? 'rgba(0,255,65,0.1)' : 'rgba(255,107,107,0.1)',
                      color: item.decision === 'approved' ? 'var(--green-bright)' : '#ff6b6b',
                      fontWeight: 700, letterSpacing: 0.5,
                    }}>
                      {item.decision.toUpperCase()}
                    </span>
                    <span style={{
                      fontSize: 8, padding: '1px 6px', borderRadius: 3,
                      background: 'var(--bg-tertiary)', color: 'var(--text-muted)',
                    }}>
                      {item.riskLevel}
                    </span>
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                    {item.agentId} &mdash; {item.reason}
                    {item.denyReason && <span style={{ color: '#ff6b6b' }}> (denied: {item.denyReason})</span>}
                  </div>
                </div>
                <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                  {new Date(item.decidedAt).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* ─── Config Tab ─── */}
        {tab === 'Config' && config && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 700 }}>
            <div style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <Settings size={14} color="#fbbf24" />
                <span style={{ fontSize: 12, fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: 1, color: '#fbbf24' }}>
                  APPROVAL RULES
                </span>
              </div>

              {/* Enable toggle */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)' }}>Approval System</div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>When enabled, risky tools require human approval</div>
                </div>
                <button onClick={() => setConfig({ ...config, enabled: !config.enabled })} style={{
                  width: 40, height: 22, borderRadius: 11, cursor: 'pointer', position: 'relative',
                  background: config.enabled ? '#fbbf24' : 'var(--bg-tertiary)',
                  border: `1px solid ${config.enabled ? '#fbbf24' : 'var(--border-dim)'}`,
                  padding: 0,
                }}>
                  <div style={{
                    width: 16, height: 16, borderRadius: '50%', background: '#fff',
                    position: 'absolute', top: 2, left: config.enabled ? 21 : 2, transition: 'left 0.2s',
                  }} />
                </button>
              </div>

              {/* Timeout */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600, letterSpacing: 0.5 }}>
                  TIMEOUT (seconds)
                </div>
                <input
                  type="number"
                  value={config.timeoutSeconds}
                  onChange={e => setConfig({ ...config, timeoutSeconds: Number(e.target.value) || 300 })}
                  style={{ ...inputStyle, width: 120 }}
                />
              </div>

              {/* Auto-approve tools */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600, letterSpacing: 0.5 }}>
                  AUTO-APPROVE (safe tools — no confirmation needed)
                </div>
                <textarea
                  value={config.autoApprove.join(', ')}
                  onChange={e => setConfig({ ...config, autoApprove: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                  rows={2}
                  style={{ ...inputStyle, resize: 'vertical' }}
                />
              </div>

              {/* Require approval tools */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600, letterSpacing: 0.5 }}>
                  REQUIRE APPROVAL (risky tools — ask before executing)
                </div>
                <textarea
                  value={config.requireApproval.join(', ')}
                  onChange={e => setConfig({ ...config, requireApproval: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                  rows={2}
                  style={{ ...inputStyle, resize: 'vertical' }}
                />
              </div>

              {/* Always deny tools */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600, letterSpacing: 0.5 }}>
                  ALWAYS DENY (blocked tools — never allow)
                </div>
                <textarea
                  value={config.alwaysDeny.join(', ')}
                  onChange={e => setConfig({ ...config, alwaysDeny: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                  rows={2}
                  style={{ ...inputStyle, resize: 'vertical' }}
                />
              </div>

              {/* Notification toggles */}
              <div style={{ display: 'flex', gap: 20, marginBottom: 16 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={config.soundAlert} onChange={e => setConfig({ ...config, soundAlert: e.target.checked })} />
                  Sound alert
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={config.desktopNotification} onChange={e => setConfig({ ...config, desktopNotification: e.target.checked })} />
                  Desktop notification
                </label>
              </div>

              <button onClick={saveConfig} style={{
                ...approveBtn,
                background: 'rgba(251,191,36,0.1)',
                border: '1px solid #fbbf24',
                color: '#fbbf24',
              }}>
                <Save size={12} /> SAVE CONFIG
              </button>
            </div>

            {/* Info box */}
            <div style={{
              ...cardStyle, display: 'flex', gap: 10, alignItems: 'flex-start',
              borderColor: 'rgba(0,200,255,0.2)', background: 'rgba(0,200,255,0.03)',
            }}>
              <Info size={16} color="var(--cyan-bright)" style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                <strong style={{ color: 'var(--cyan-bright)' }}>How it works:</strong> When an agent wants to execute a tool listed in "Require Approval",
                it sends a request to the dashboard. You see the tool name, parameters, and reason.
                You can approve or deny. If no response within the timeout, the request is auto-denied.
                Tools in "Auto-Approve" are executed immediately. Tools in "Always Deny" are blocked.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

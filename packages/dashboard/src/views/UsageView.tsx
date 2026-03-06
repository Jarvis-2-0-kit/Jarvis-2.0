import { useEffect, useState } from 'react';
import { useGatewayStore } from '../store/gateway-store.js';
import { gateway } from '../gateway/client.js';
import { Coins, BarChart3, TrendingUp, Calendar } from 'lucide-react';

interface UsageSummary {
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalSessions: number;
  byAgent: Record<string, {
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    sessions: number;
  }>;
  byModel: Record<string, {
    totalTokens: number;
    calls: number;
  }>;
  estimatedCost: number;
}

interface SessionUsage {
  id: string;
  agentId: string;
  createdAt: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

// Pricing per 1M tokens (estimates)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  'gpt-5.2': { input: 1.75, output: 14 },
  'gpt-5-mini': { input: 0.25, output: 2 },
  'o3': { input: 2, output: 8 },
  'default': { input: 3, output: 15 },
};

export function UsageView() {
  const connected = useGatewayStore((s) => s.connected);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [sessions, setSessions] = useState<SessionUsage[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (connected) {
      void loadUsage();
    }
  }, [connected]);

  const loadUsage = async () => {
    setLoading(true);
    try {
      const [sumData, sessData] = await Promise.allSettled([
        gateway.request<UsageSummary>('usage.summary'),
        gateway.request<SessionUsage[]>('usage.sessions'),
      ]);
      if (sumData.status === 'fulfilled') setSummary(sumData.value);
      if (sessData.status === 'fulfilled') setSessions(Array.isArray(sessData.value) ? sessData.value : []);
    } catch {
      // methods may not exist yet
    } finally {
      setLoading(false);
    }
  };

  const estimateCost = (input: number, output: number, model = 'default'): number => {
    const pricing = MODEL_PRICING[model] ?? MODEL_PRICING['default'];
    return (input / 1_000_000) * pricing.input + (output / 1_000_000) * pricing.output;
  };

  const totalCost = summary
    ? summary.estimatedCost
    : sessions.reduce((sum, s) => sum + estimateCost(s.inputTokens, s.outputTokens, s.model), 0);

  return (
    <div style={{
      height: '100%',
      overflow: 'auto',
      padding: 20,
      background: 'var(--bg-primary)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Coins size={20} color="var(--amber)" />
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 16,
          letterSpacing: 3,
          color: 'var(--amber)',
          textShadow: 'var(--glow-amber)',
          margin: 0,
        }}>
          USAGE & COSTS
        </h1>
        <button
          onClick={() => void loadUsage()}
          style={{ marginLeft: 'auto', fontSize: 10, padding: '4px 12px', opacity: loading ? 0.5 : 1 }}
        >
          {loading ? 'LOADING...' : 'REFRESH'}
        </button>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
        <UsageStatCard
          label="TOTAL TOKENS"
          value={formatNumber(summary?.totalTokens ?? sessions.reduce((s, x) => s + x.totalTokens, 0))}
          icon={<BarChart3 size={16} />}
          color="var(--cyan-bright)"
        />
        <UsageStatCard
          label="INPUT TOKENS"
          value={formatNumber(summary?.totalInputTokens ?? sessions.reduce((s, x) => s + x.inputTokens, 0))}
          icon={<TrendingUp size={16} />}
          color="var(--green-bright)"
        />
        <UsageStatCard
          label="OUTPUT TOKENS"
          value={formatNumber(summary?.totalOutputTokens ?? sessions.reduce((s, x) => s + x.outputTokens, 0))}
          icon={<TrendingUp size={16} />}
          color="var(--purple)"
        />
        <UsageStatCard
          label="EST. COST"
          value={`$${totalCost.toFixed(4)}`}
          icon={<Coins size={16} />}
          color="var(--amber)"
        />
        <UsageStatCard
          label="SESSIONS"
          value={String(summary?.totalSessions ?? sessions.length)}
          icon={<Calendar size={16} />}
          color="var(--text-secondary)"
        />
      </div>

      {/* Usage by Agent */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 13,
          letterSpacing: 2,
          color: 'var(--green-bright)',
          marginBottom: 12,
        }}>
          USAGE BY AGENT
        </h2>

        {summary?.byAgent && Object.entries(summary.byAgent).length > 0 ? (
          <div style={{ display: 'grid', gap: 8 }}>
            {Object.entries(summary.byAgent).map(([agentId, usage]) => {
              const maxTokens = Math.max(...Object.values(summary.byAgent).map(a => a.totalTokens));
              const pct = maxTokens > 0 ? (usage.totalTokens / maxTokens) * 100 : 0;
              return (
                <div key={agentId} style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-primary)',
                  borderRadius: 6,
                  padding: '10px 14px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--cyan-bright)' }}>
                      {agentId}
                    </span>
                    <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                      {formatNumber(usage.totalTokens)} tokens
                    </span>
                  </div>
                  <div style={{ height: 4, background: 'var(--bg-card)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{
                      width: `${pct}%`,
                      height: '100%',
                      background: 'var(--green-bright)',
                      borderRadius: 2,
                      transition: 'width 0.3s',
                    }} />
                  </div>
                  <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    <span>In: {formatNumber(usage.inputTokens)}</span>
                    <span>Out: {formatNumber(usage.outputTokens)}</span>
                    <span>Sessions: {usage.sessions}</span>
                    <span style={{ color: 'var(--amber)' }}>~${estimateCost(usage.inputTokens, usage.outputTokens).toFixed(4)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
            No usage data available yet. Usage will appear here as agents process tasks.
          </div>
        )}
      </div>

      {/* Recent Sessions */}
      <div>
        <h2 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 13,
          letterSpacing: 2,
          color: 'var(--green-bright)',
          marginBottom: 12,
        }}>
          RECENT SESSIONS
        </h2>

        {sessions.length > 0 ? (
          <div style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-primary)',
            borderRadius: 6,
            overflow: 'hidden',
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-dim)' }}>
                  {['Agent', 'Date', 'Model', 'Input', 'Output', 'Total', 'Cost'].map(h => (
                    <th key={h} style={{
                      padding: '8px 10px',
                      textAlign: 'left',
                      color: 'var(--text-muted)',
                      fontFamily: 'var(--font-display)',
                      fontSize: 9,
                      letterSpacing: 1,
                      fontWeight: 600,
                    }}>
                      {h.toUpperCase()}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sessions.slice(0, 50).map((s) => (
                  <tr key={s.id} style={{ borderBottom: '1px solid var(--border-dim)' }}>
                    <td style={{ padding: '6px 10px', color: 'var(--cyan-bright)' }}>{s.agentId}</td>
                    <td style={{ padding: '6px 10px', color: 'var(--text-muted)' }}>{new Date(s.createdAt).toLocaleString()}</td>
                    <td style={{ padding: '6px 10px', color: 'var(--text-secondary)' }}>{s.model ?? '-'}</td>
                    <td style={{ padding: '6px 10px', color: 'var(--green-bright)' }}>{formatNumber(s.inputTokens)}</td>
                    <td style={{ padding: '6px 10px', color: 'var(--purple)' }}>{formatNumber(s.outputTokens)}</td>
                    <td style={{ padding: '6px 10px', color: 'var(--text-white)' }}>{formatNumber(s.totalTokens)}</td>
                    <td style={{ padding: '6px 10px', color: 'var(--amber)' }}>${estimateCost(s.inputTokens, s.outputTokens, s.model).toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
            No session usage data available yet.
          </div>
        )}
      </div>
    </div>
  );
}

function UsageStatCard({ label, value, icon, color }: {
  label: string; value: string; icon: React.ReactNode; color: string;
}) {
  return (
    <div style={{
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border-primary)',
      borderRadius: 6,
      padding: '14px 16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{ color }}>{icon}</span>
        <span style={{ fontSize: 9, fontFamily: 'var(--font-display)', letterSpacing: 1, color: 'var(--text-muted)' }}>
          {label}
        </span>
      </div>
      <div style={{ fontSize: 20, fontFamily: 'var(--font-display)', fontWeight: 700, color }}>
        {value}
      </div>
    </div>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

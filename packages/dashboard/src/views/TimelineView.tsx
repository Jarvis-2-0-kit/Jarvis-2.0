import { useEffect, useState, useCallback, useRef } from 'react';
import { useGatewayStore } from '../store/gateway-store.js';
import { gateway } from '../gateway/client.js';
import {
  GitCommitHorizontal,
  RefreshCw,
  Filter,
  Bot,
  ListChecks,
  Wrench,
  Cpu,
  MessageSquare,
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronDown,
  ChevronRight,
  Zap,
  Search,
} from 'lucide-react';

interface TimelineEntry {
  id: string;
  timestamp: number;
  agentId: string;
  category: 'task' | 'tool' | 'llm' | 'session' | 'agent' | 'message';
  action: string;
  detail: string;
  metadata: Record<string, unknown>;
  duration?: number;
}

interface TimelineData {
  agentId: string;
  lastUpdated: number;
  stats: {
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    totalToolCalls: number;
    totalLlmCalls: number;
    totalTokensIn: number;
    totalTokensOut: number;
    sessionCount: number;
  };
  entries: TimelineEntry[];
}

const CATEGORY_CONFIG: Record<string, { color: string; Icon: typeof Bot; label: string }> = {
  task: { color: 'var(--green-bright)', Icon: ListChecks, label: 'Tasks' },
  tool: { color: 'var(--cyan-bright)', Icon: Wrench, label: 'Tools' },
  llm: { color: 'var(--purple)', Icon: Cpu, label: 'LLM' },
  session: { color: 'var(--amber)', Icon: Play, label: 'Sessions' },
  agent: { color: 'var(--blue)', Icon: Bot, label: 'Agent' },
  message: { color: 'var(--text-secondary)', Icon: MessageSquare, label: 'Messages' },
};

function getActionIcon(action: string) {
  if (action.includes('completed') || action.includes('end')) return CheckCircle2;
  if (action.includes('failed') || action.includes('error')) return XCircle;
  if (action.includes('start') || action.includes('assigned')) return Play;
  return Zap;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
  return `${Math.round(diff / 86400000)}d ago`;
}

export function TimelineView() {
  const connected = useGatewayStore((s) => s.connected);
  const [timelines, setTimelines] = useState<TimelineData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());
  const [autoRefresh, setAutoRefresh] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchTimelines = useCallback(async () => {
    if (!connected) return;
    try {
      const data = await gateway.request<{ timelines: TimelineData[] }>('timeline.list');
      if (data?.timelines) {
        setTimelines(data.timelines);
      }
    } catch {
      // Try fetching from activity log events as fallback
      try {
        const activities = await gateway.request<TimelineEntry[]>('timeline.recent');
        if (Array.isArray(activities)) {
          // Group by agent
          const byAgent = new Map<string, TimelineEntry[]>();
          for (const entry of activities) {
            const arr = byAgent.get(entry.agentId) || [];
            arr.push(entry);
            byAgent.set(entry.agentId, arr);
          }
          const tls: TimelineData[] = Array.from(byAgent.entries()).map(([agentId, entries]) => ({
            agentId,
            lastUpdated: Date.now(),
            stats: {
              totalTasks: entries.filter((e) => e.category === 'task').length,
              completedTasks: entries.filter((e) => e.action.includes('completed')).length,
              failedTasks: entries.filter((e) => e.action.includes('failed')).length,
              totalToolCalls: entries.filter((e) => e.category === 'tool').length,
              totalLlmCalls: entries.filter((e) => e.category === 'llm').length,
              totalTokensIn: 0,
              totalTokensOut: 0,
              sessionCount: entries.filter((e) => e.category === 'session').length,
            },
            entries,
          }));
          setTimelines(tls);
        }
      } catch { /* no data yet */ }
    } finally {
      setLoading(false);
    }
  }, [connected]);

  useEffect(() => {
    void fetchTimelines();
  }, [fetchTimelines]);

  useEffect(() => {
    if (autoRefresh) {
      pollRef.current = setInterval(() => void fetchTimelines(), 10000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [autoRefresh, fetchTimelines]);

  const toggleExpand = (id: string) => {
    setExpandedEntries((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Merge & filter entries
  const allEntries = timelines
    .flatMap((t) => t.entries)
    .sort((a, b) => b.timestamp - a.timestamp);

  const filtered = allEntries.filter((e) => {
    if (selectedAgent !== 'all' && e.agentId !== selectedAgent) return false;
    if (categoryFilter !== 'all' && e.category !== categoryFilter) return false;
    if (search && !e.detail.toLowerCase().includes(search.toLowerCase()) && !e.action.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Aggregate stats
  const totalStats = timelines.reduce(
    (acc, t) => ({
      tasks: acc.tasks + t.stats.totalTasks,
      completed: acc.completed + t.stats.completedTasks,
      failed: acc.failed + t.stats.failedTasks,
      tools: acc.tools + t.stats.totalToolCalls,
      llm: acc.llm + t.stats.totalLlmCalls,
      tokensIn: acc.tokensIn + t.stats.totalTokensIn,
      tokensOut: acc.tokensOut + t.stats.totalTokensOut,
      sessions: acc.sessions + t.stats.sessionCount,
    }),
    { tasks: 0, completed: 0, failed: 0, tools: 0, llm: 0, tokensIn: 0, tokensOut: 0, sessions: 0 },
  );

  const agents = [...new Set(timelines.map((t) => t.agentId))];

  return (
    <div style={{
      height: '100%',
      overflow: 'auto',
      padding: 16,
      background: 'var(--bg-primary)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <GitCommitHorizontal size={18} color="var(--purple)" />
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 14,
          letterSpacing: 2,
          color: 'var(--purple)',
          margin: 0,
        }}>
          ACTIVITY TIMELINE
        </h1>
        {autoRefresh && (
          <span style={{
            fontSize: 8,
            padding: '2px 6px',
            background: 'rgba(0,255,65,0.08)',
            border: '1px solid var(--green-dim)',
            borderRadius: 3,
            color: 'var(--green-bright)',
            fontFamily: 'var(--font-display)',
            letterSpacing: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 3,
          }}>
            <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--green-bright)', animation: 'glow-pulse 2s infinite' }} />
            LIVE
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            style={{
              fontSize: 9, padding: '4px 10px',
              display: 'flex', alignItems: 'center', gap: 4,
              color: autoRefresh ? 'var(--green-bright)' : 'var(--text-muted)',
              borderColor: autoRefresh ? 'var(--green-dim)' : 'var(--border-dim)',
            }}
          >
            <Clock size={10} /> {autoRefresh ? 'AUTO' : 'MANUAL'}
          </button>
          <button
            onClick={() => void fetchTimelines()}
            style={{ fontSize: 9, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <RefreshCw size={10} /> REFRESH
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {[
          { label: 'Tasks', value: totalStats.tasks, color: 'var(--green-bright)' },
          { label: 'Done', value: totalStats.completed, color: 'var(--green-primary)' },
          { label: 'Failed', value: totalStats.failed, color: 'var(--red-bright)' },
          { label: 'Tools', value: totalStats.tools, color: 'var(--cyan-bright)' },
          { label: 'LLM', value: totalStats.llm, color: 'var(--purple)' },
          { label: 'Sessions', value: totalStats.sessions, color: 'var(--amber)' },
        ].map((stat) => (
          <div key={stat.label} style={{
            padding: '6px 12px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-dim)',
            borderRadius: 4,
            textAlign: 'center',
            minWidth: 70,
          }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: stat.color, fontFamily: 'var(--font-display)' }}>
              {stat.value}
            </div>
            <div style={{ fontSize: 8, color: 'var(--text-muted)', fontFamily: 'var(--font-display)', letterSpacing: 1, textTransform: 'uppercase' }}>
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Agent filter */}
        <div style={{ display: 'flex', gap: 3 }}>
          <button
            onClick={() => setSelectedAgent('all')}
            style={{
              fontSize: 8, padding: '3px 8px',
              color: selectedAgent === 'all' ? 'var(--text-white)' : 'var(--text-muted)',
              borderColor: selectedAgent === 'all' ? 'var(--border-bright)' : 'var(--border-dim)',
              background: selectedAgent === 'all' ? 'var(--bg-tertiary)' : 'transparent',
            }}
          >
            ALL AGENTS
          </button>
          {agents.map((agent) => (
            <button
              key={agent}
              onClick={() => setSelectedAgent(selectedAgent === agent ? 'all' : agent)}
              style={{
                fontSize: 8, padding: '3px 8px',
                color: selectedAgent === agent ? 'var(--cyan-bright)' : 'var(--text-muted)',
                borderColor: selectedAgent === agent ? 'var(--cyan-dim)' : 'var(--border-dim)',
                background: selectedAgent === agent ? 'rgba(0,255,255,0.05)' : 'transparent',
              }}
            >
              {agent}
            </button>
          ))}
        </div>

        {/* Category filter */}
        <div style={{ display: 'flex', gap: 3 }}>
          <Filter size={10} color="var(--text-muted)" />
          {['all', ...Object.keys(CATEGORY_CONFIG)].map((cat) => {
            const cfg = CATEGORY_CONFIG[cat];
            return (
              <button
                key={cat}
                onClick={() => setCategoryFilter(categoryFilter === cat ? 'all' : cat)}
                style={{
                  fontSize: 7, padding: '2px 6px',
                  color: categoryFilter === cat ? (cfg?.color || 'var(--text-white)') : 'var(--text-muted)',
                  borderColor: categoryFilter === cat ? (cfg?.color ? `${cfg.color}44` : 'var(--border-bright)') : 'var(--border-dim)',
                }}
              >
                {cat.toUpperCase()}
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div style={{ position: 'relative', marginLeft: 'auto' }}>
          <Search size={10} color="var(--text-muted)" style={{ position: 'absolute', left: 6, top: 7 }} />
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ fontSize: 10, paddingLeft: 22, padding: '3px 8px 3px 22px', width: 180 }}
          />
        </div>
      </div>

      {/* Timeline */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          Loading timeline data...
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          {allEntries.length === 0
            ? 'No activity recorded yet. Timeline data appears once agents start processing tasks.'
            : 'No entries match your filters.'
          }
        </div>
      ) : (
        <div style={{ position: 'relative', paddingLeft: 24 }}>
          {/* Vertical line */}
          <div style={{
            position: 'absolute',
            left: 11,
            top: 0,
            bottom: 0,
            width: 2,
            background: 'linear-gradient(180deg, var(--purple) 0%, var(--green-dim) 50%, var(--border-dim) 100%)',
          }} />

          {filtered.slice(0, 200).map((entry) => {
            const cfg = CATEGORY_CONFIG[entry.category] || CATEGORY_CONFIG.agent;
            const ActionIcon = getActionIcon(entry.action);
            const isExpanded = expandedEntries.has(entry.id);
            const isError = entry.action.includes('failed') || entry.action.includes('error');
            const isSuccess = entry.action.includes('completed') || entry.action.includes('end');

            return (
              <div key={entry.id} style={{ position: 'relative', marginBottom: 4 }}>
                {/* Dot on timeline */}
                <div style={{
                  position: 'absolute',
                  left: -17,
                  top: 10,
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: isError ? 'var(--red-bright)' : isSuccess ? 'var(--green-bright)' : cfg.color,
                  border: '2px solid var(--bg-primary)',
                  boxShadow: `0 0 4px ${isError ? 'var(--red-bright)' : cfg.color}44`,
                  zIndex: 1,
                }} />

                {/* Entry card */}
                <div
                  onClick={() => toggleExpand(entry.id)}
                  style={{
                    padding: '8px 12px',
                    background: isExpanded ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
                    border: `1px solid ${isExpanded ? `${cfg.color}33` : 'var(--border-dim)'}`,
                    borderRadius: 4,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {isExpanded ? <ChevronDown size={10} color="var(--text-muted)" /> : <ChevronRight size={10} color="var(--text-muted)" />}

                    <cfg.Icon size={12} color={cfg.color} />

                    <span style={{
                      fontSize: 9,
                      fontFamily: 'var(--font-display)',
                      letterSpacing: 1,
                      color: cfg.color,
                      textTransform: 'uppercase',
                    }}>
                      {entry.action.replace(/_/g, ' ')}
                    </span>

                    {entry.agentId && (
                      <span style={{
                        fontSize: 7,
                        padding: '1px 4px',
                        background: 'rgba(0,255,255,0.05)',
                        border: '1px solid var(--cyan-dim)',
                        borderRadius: 2,
                        color: 'var(--cyan-bright)',
                        fontFamily: 'var(--font-mono)',
                      }}>
                        {entry.agentId}
                      </span>
                    )}

                    {entry.duration != null && (
                      <span style={{
                        fontSize: 8,
                        color: 'var(--text-muted)',
                        fontFamily: 'var(--font-mono)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 2,
                      }}>
                        <Clock size={8} />
                        {formatDuration(entry.duration)}
                      </span>
                    )}

                    <span style={{
                      marginLeft: 'auto',
                      fontSize: 8,
                      color: 'var(--text-muted)',
                      fontFamily: 'var(--font-mono)',
                    }}>
                      {formatTimestamp(entry.timestamp)}
                      <span style={{ marginLeft: 4, fontSize: 7, color: 'var(--text-muted)' }}>
                        ({formatTimeAgo(entry.timestamp)})
                      </span>
                    </span>
                  </div>

                  <div style={{
                    marginTop: 3,
                    marginLeft: 22,
                    fontSize: 10,
                    color: 'var(--text-secondary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: isExpanded ? 'normal' : 'nowrap',
                  }}>
                    {entry.detail}
                  </div>

                  {/* Expanded metadata */}
                  {isExpanded && Object.keys(entry.metadata).length > 0 && (
                    <div style={{
                      marginTop: 6,
                      marginLeft: 22,
                      padding: 8,
                      background: 'var(--bg-primary)',
                      borderRadius: 3,
                      border: '1px solid var(--border-dim)',
                    }}>
                      <pre style={{
                        margin: 0,
                        fontSize: 9,
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--text-muted)',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}>
                        {JSON.stringify(entry.metadata, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {filtered.length > 200 && (
            <div style={{ padding: 12, textAlign: 'center', color: 'var(--text-muted)', fontSize: 10 }}>
              Showing 200 of {filtered.length} entries
            </div>
          )}
        </div>
      )}
    </div>
  );
}

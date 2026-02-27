import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useGatewayStore } from '../store/gateway-store.js';
import { gateway } from '../gateway/client.js';
import {
  FileText,
  Search,
  ArrowDown,
  Pause,
  Play,
  Trash2,
  RefreshCw,
  Filter,
  BarChart3,
} from 'lucide-react';

interface LogEntry {
  timestamp: string;
  level: string;
  source: string;
  message: string;
  raw: string;
}

const LEVEL_COLORS: Record<string, string> = {
  INFO: 'var(--green-bright)',
  WARN: 'var(--amber)',
  ERROR: 'var(--red-bright)',
  DEBUG: 'var(--text-muted)',
};

const SOURCE_COLORS: Record<string, string> = {
  'gateway:server': '#00bfff',
  'gateway:nats': '#9f7aea',
  'gateway:redis': '#f56565',
  'gateway:protocol': '#48bb78',
  'gateway': '#63b3ed',
  'agent:runner': '#f6ad55',
  'plugins:registry': '#fc8181',
  'plugins:loader': '#b794f4',
  'orchestration:deps': '#68d391',
  'tools': '#fbd38d',
};

export function LogsView() {
  const connected = useGatewayStore((s) => s.connected);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [autoFollow, setAutoFollow] = useState(true);
  const [paused, setPaused] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastCountRef = useRef(0);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // Parse log line
  const parseLine = useCallback((line: string): LogEntry => {
    // Match: [timestamp] [LEVEL] [source] message
    const match = line.match(/\[([^\]]+)\]\s*\[(\w+)\]\s*\[([^\]]+)\]\s*(.*)/);
    if (match) {
      return {
        timestamp: match[1],
        level: match[2],
        source: match[3],
        message: match[4],
        raw: line,
      };
    }
    // Fallback: try to detect level from keywords
    const levelMatch = line.match(/(ERROR|WARN|INFO|DEBUG)/i);
    return {
      timestamp: '',
      level: levelMatch ? levelMatch[1].toUpperCase() : 'INFO',
      source: 'unknown',
      message: line,
      raw: line,
    };
  }, []);

  // Load logs
  const loadLogs = useCallback(async () => {
    try {
      const data = await gateway.request<string[]>('logs.get', { lines: 1000 });
      if (Array.isArray(data)) {
        const parsed = data.map(parseLine);
        setLogs(parsed);
        lastCountRef.current = data.length;
      }
    } catch {
      // method may not exist
    }
  }, [parseLine]);

  // Initial load + polling
  useEffect(() => {
    if (!connected) return;
    void loadLogs();

    if (!paused) {
      pollRef.current = setInterval(() => void loadLogs(), 5000);
    }

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [connected, paused, loadLogs]);

  // Listen for live log events
  useEffect(() => {
    if (!connected) return;

    const unsub = gateway.on('log.line', (payload) => {
      if (pausedRef.current) return;
      const entry = payload as { line: string; agentId?: string; timestamp?: number };
      const parsed = parseLine(entry.line ?? JSON.stringify(entry));
      setLogs((prev) => [...prev.slice(-2500), parsed]);
    });

    return unsub;
  }, [connected, paused, parseLine]);

  // Auto-scroll
  useEffect(() => {
    if (autoFollow && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoFollow]);

  // Get unique sources
  const sources = useMemo(() => Array.from(new Set(logs.map(l => l.source))).sort(), [logs]);

  // Filtered logs
  const filteredLogs = useMemo(() => logs.filter((entry) => {
    if (levelFilter !== 'all' && entry.level !== levelFilter) return false;
    if (sourceFilter !== 'all' && entry.source !== sourceFilter) return false;
    if (search && !entry.raw.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [logs, levelFilter, sourceFilter, search]);

  // Stats
  const stats = useMemo(() => ({
    total: logs.length,
    info: logs.filter(l => l.level === 'INFO').length,
    warn: logs.filter(l => l.level === 'WARN').length,
    error: logs.filter(l => l.level === 'ERROR').length,
    debug: logs.filter(l => l.level === 'DEBUG').length,
    sources: sources.length,
  }), [logs, sources]);

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      background: 'var(--bg-primary)',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 16px',
        borderBottom: '1px solid var(--border-primary)',
        background: 'var(--bg-secondary)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexShrink: 0,
      }}>
        <FileText size={16} color="var(--green-bright)" />
        <span style={{
          fontFamily: 'var(--font-display)',
          fontSize: 13,
          letterSpacing: 2,
          color: 'var(--green-bright)',
        }}>
          LIVE LOGS
        </span>

        {/* Level badges */}
        <div style={{ display: 'flex', gap: 6, marginLeft: 8 }}>
          <LevelBadge label="INFO" count={stats.info} color="var(--green-bright)" />
          <LevelBadge label="WARN" count={stats.warn} color="var(--amber)" />
          <LevelBadge label="ERR" count={stats.error} color="var(--red-bright)" />
        </div>

        <span style={{
          fontSize: 10,
          color: 'var(--text-muted)',
          fontFamily: 'var(--font-mono)',
          marginLeft: 8,
        }}>
          {filteredLogs.length}/{logs.length} entries
        </span>

        {!paused && (
          <span style={{
            fontSize: 8,
            padding: '1px 6px',
            borderRadius: 3,
            background: 'rgba(0,255,65,0.08)',
            border: '1px solid var(--green-dim)',
            color: 'var(--green-bright)',
            fontFamily: 'var(--font-display)',
            letterSpacing: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}>
            <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--green-bright)', animation: 'pulse 2s infinite' }} />
            LIVE
          </span>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button
            onClick={() => setShowStats(!showStats)}
            style={{
              fontSize: 9, padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 4,
              color: showStats ? 'var(--cyan-bright)' : 'var(--text-muted)',
              borderColor: showStats ? 'var(--cyan-dim)' : 'var(--border-dim)',
              background: showStats ? 'rgba(0,255,255,0.05)' : 'var(--bg-tertiary)',
              border: '1px solid var(--border-primary)', borderRadius: 4, cursor: 'pointer',
              fontFamily: 'var(--font-display)', letterSpacing: 1,
            }}
          >
            <BarChart3 size={10} /> STATS
          </button>
          <button
            onClick={() => void loadLogs()}
            style={{
              fontSize: 9, padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 4,
              background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)',
              borderRadius: 4, color: 'var(--text-secondary)', cursor: 'pointer',
              fontFamily: 'var(--font-display)', letterSpacing: 1,
            }}
          >
            <RefreshCw size={10} /> RELOAD
          </button>
          <button
            onClick={() => { setLogs([]); lastCountRef.current = 0; }}
            style={{
              fontSize: 9, padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 4,
              background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)',
              borderRadius: 4, color: 'var(--text-secondary)', cursor: 'pointer',
              fontFamily: 'var(--font-display)', letterSpacing: 1,
            }}
          >
            <Trash2 size={10} /> CLEAR
          </button>
        </div>
      </div>

      {/* Stats Panel */}
      {showStats && (
        <div style={{
          padding: '8px 16px',
          borderBottom: '1px solid var(--border-dim)',
          background: 'var(--bg-secondary)',
          display: 'flex',
          gap: 16,
          flexShrink: 0,
        }}>
          <StatItem label="Total" value={stats.total} color="var(--text-white)" />
          <StatItem label="INFO" value={stats.info} color="var(--green-bright)" />
          <StatItem label="WARN" value={stats.warn} color="var(--amber)" />
          <StatItem label="ERROR" value={stats.error} color="var(--red-bright)" />
          <StatItem label="DEBUG" value={stats.debug} color="var(--text-muted)" />
          <div style={{ width: 1, background: 'var(--border-primary)' }} />
          <StatItem label="Sources" value={stats.sources} color="var(--cyan-bright)" />

          {/* Level distribution bar */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 8, color: 'var(--text-muted)', fontFamily: 'var(--font-display)', letterSpacing: 1 }}>DIST</span>
            <div style={{ flex: 1, height: 6, background: 'var(--bg-primary)', borderRadius: 3, overflow: 'hidden', display: 'flex' }}>
              {stats.total > 0 && (
                <>
                  <div style={{ width: `${(stats.info / stats.total) * 100}%`, height: '100%', background: 'var(--green-bright)' }} />
                  <div style={{ width: `${(stats.warn / stats.total) * 100}%`, height: '100%', background: 'var(--amber)' }} />
                  <div style={{ width: `${(stats.error / stats.total) * 100}%`, height: '100%', background: 'var(--red-bright)' }} />
                  <div style={{ width: `${(stats.debug / stats.total) * 100}%`, height: '100%', background: 'var(--text-muted)' }} />
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div style={{
        padding: '6px 16px',
        borderBottom: '1px solid var(--border-dim)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexShrink: 0,
        background: 'var(--bg-secondary)',
      }}>
        {/* Level filters */}
        {['all', 'INFO', 'WARN', 'ERROR', 'DEBUG'].map((level) => (
          <button
            key={level}
            onClick={() => setLevelFilter(level)}
            style={{
              fontSize: 9,
              padding: '2px 8px',
              background: levelFilter === level ? `${LEVEL_COLORS[level] ?? 'var(--cyan-bright)'}15` : 'transparent',
              border: `1px solid ${levelFilter === level ? (LEVEL_COLORS[level] ?? 'var(--cyan-dim)') + '44' : 'var(--border-dim)'}`,
              color: levelFilter === level ? (LEVEL_COLORS[level] ?? 'var(--cyan-bright)') : 'var(--text-muted)',
              fontFamily: 'var(--font-display)',
              letterSpacing: 1,
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            {level}
          </button>
        ))}

        {/* Source filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8 }}>
          <Filter size={10} color="var(--text-muted)" />
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            style={{
              fontSize: 10,
              padding: '2px 6px',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
              borderRadius: 4,
              color: sourceFilter === 'all' ? 'var(--text-muted)' : 'var(--cyan-bright)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            <option value="all">All sources</option>
            {sources.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        {/* Search */}
        <div style={{ flex: 1, maxWidth: 300, position: 'relative', marginLeft: 8 }}>
          <Search size={12} color="var(--text-muted)" style={{ position: 'absolute', left: 8, top: 6 }} />
          <input
            type="text"
            placeholder="Search logs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%',
              paddingLeft: 26,
              fontSize: 11,
              padding: '4px 8px 4px 26px',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
              borderRadius: 4,
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)',
            }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              style={{
                position: 'absolute',
                right: 6,
                top: 4,
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: 0,
                fontSize: 12,
              }}
            >
              ×
            </button>
          )}
        </div>

        {/* Controls */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <button
            onClick={() => setPaused(!paused)}
            style={{
              fontSize: 9,
              padding: '2px 8px',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              color: paused ? 'var(--amber)' : 'var(--green-bright)',
              borderColor: paused ? 'rgba(255,170,0,0.3)' : 'var(--green-dim)',
              background: paused ? 'rgba(255,170,0,0.05)' : 'rgba(0,255,65,0.05)',
              border: '1px solid',
              borderRadius: 4,
              cursor: 'pointer',
              fontFamily: 'var(--font-display)',
              letterSpacing: 1,
            }}
          >
            {paused ? <Play size={10} /> : <Pause size={10} />}
            {paused ? 'RESUME' : 'PAUSE'}
          </button>
          <button
            onClick={() => setAutoFollow(!autoFollow)}
            style={{
              fontSize: 9,
              padding: '2px 8px',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              color: autoFollow ? 'var(--cyan-bright)' : 'var(--text-muted)',
              borderColor: autoFollow ? 'var(--cyan-dim)' : 'var(--border-dim)',
              background: autoFollow ? 'rgba(0,255,255,0.05)' : 'transparent',
              border: '1px solid',
              borderRadius: 4,
              cursor: 'pointer',
              fontFamily: 'var(--font-display)',
              letterSpacing: 1,
            }}
          >
            <ArrowDown size={10} />
            FOLLOW
          </button>
        </div>
      </div>

      {/* Log Output */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '2px 0',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          lineHeight: 1.5,
        }}
      >
        {filteredLogs.length === 0 && (
          <div style={{
            padding: 30,
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: 12,
          }}>
            {logs.length === 0
              ? 'No log entries. Logs will appear here when the gateway and agents are active.'
              : 'No logs match the current filters.'}
          </div>
        )}

        {filteredLogs.map((entry, i) => (
          <div
            key={`${entry.timestamp}-${entry.level}-${entry.source}-${i}`}
            style={{
              padding: '1px 16px',
              display: 'flex',
              gap: 8,
              alignItems: 'baseline',
              borderBottom: '1px solid rgba(33,38,45,0.3)',
              cursor: 'default',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-tertiary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <span style={{ color: 'var(--text-muted)', fontSize: 10, minWidth: 170, flexShrink: 0 }}>
              {entry.timestamp}
            </span>
            <span style={{
              color: LEVEL_COLORS[entry.level] ?? 'var(--text-secondary)',
              fontSize: 10,
              fontWeight: 600,
              minWidth: 42,
              flexShrink: 0,
            }}>
              {entry.level}
            </span>
            <span style={{
              color: SOURCE_COLORS[entry.source] ?? 'var(--cyan-dim)',
              fontSize: 10,
              minWidth: 140,
              flexShrink: 0,
            }}>
              [{entry.source}]
            </span>
            <span style={{
              color: entry.level === 'ERROR' ? 'var(--red-bright)' : entry.level === 'WARN' ? 'var(--amber)' : 'var(--text-secondary)',
              wordBreak: 'break-word',
            }}>
              {highlightSearch(entry.message, search)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* === Sub-components === */

function LevelBadge({ label, count, color }: { label: string; count: number; color: string }) {
  if (count === 0) return null;
  return (
    <span style={{
      fontSize: 8,
      padding: '1px 5px',
      borderRadius: 3,
      background: `${color}11`,
      border: `1px solid ${color}33`,
      color,
      fontFamily: 'var(--font-mono)',
    }}>
      {label}: {count}
    </span>
  );
}

function StatItem({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 14, fontFamily: 'var(--font-display)', fontWeight: 700, color }}>
        {value}
      </div>
      <div style={{ fontSize: 7, fontFamily: 'var(--font-display)', color: 'var(--text-muted)', letterSpacing: 1 }}>
        {label.toUpperCase()}
      </div>
    </div>
  );
}

function highlightSearch(text: string, query: string): React.ReactNode {
  if (!query || !text) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;

  return (
    <>
      {text.slice(0, idx)}
      <mark style={{
        background: 'rgba(255,170,0,0.25)',
        color: 'var(--amber)',
        padding: '0 1px',
        borderRadius: 2,
      }}>
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

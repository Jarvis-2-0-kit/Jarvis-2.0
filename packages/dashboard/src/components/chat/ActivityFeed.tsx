/**
 * ActivityFeed — Real-time activity panel for ChatView
 *
 * Shows tool calls, task progress, delegations, and status changes
 * streaming from agents via NATS → gateway → dashboard.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Terminal, ArrowRightLeft, Activity, CircleDot, Filter,
  ChevronDown, ChevronUp,
} from 'lucide-react';
import { useGatewayStore, type FeedEntry, type FeedEntryType } from '../../store/gateway-store.js';
import { formatTime } from '../../utils/formatters.js';

// ─── Agent colors ──────────────────────────────────────────────────

const AGENT_COLORS: Record<string, { color: string; label: string }> = {
  jarvis:        { color: '#fbbf24', label: 'JARVIS' },
  'agent-smith': { color: '#00ff41', label: 'SMITH' },
  'agent-johny':  { color: '#c084fc', label: 'JOHNY' },
};

function agentColor(id: string): string {
  return AGENT_COLORS[id]?.color ?? '#60a5fa';
}

function agentLabel(id: string): string {
  return AGENT_COLORS[id]?.label ?? id.toUpperCase();
}

// ─── Feed entry icon ───────────────────────────────────────────────

const TYPE_CFG: Record<FeedEntryType, { icon: typeof Terminal; color: string; label: string }> = {
  tool_call:      { icon: Terminal,       color: '#60a5fa', label: 'TOOL' },
  task_progress:  { icon: Activity,       color: '#fbbf24', label: 'PROGRESS' },
  delegation:     { icon: ArrowRightLeft, color: '#c084fc', label: 'DELEGATION' },
  status_change:  { icon: CircleDot,      color: '#00ff41', label: 'STATUS' },
};

// ─── Component ─────────────────────────────────────────────────────

export function ActivityFeed() {
  const activityFeed = useGatewayStore((s) => s.activityFeed);
  const taskProgress = useGatewayStore((s) => s.taskProgress);

  const [filters, setFilters] = useState<Set<FeedEntryType>>(
    new Set(['tool_call', 'task_progress', 'delegation', 'status_change']),
  );
  const [collapsed, setCollapsed] = useState(false);

  const feedRef = useRef<HTMLDivElement>(null);
  const isNearBottom = useRef(true);

  // Auto-scroll when new entries arrive
  useEffect(() => {
    if (isNearBottom.current && feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [activityFeed.length]);

  const handleScroll = useCallback(() => {
    const el = feedRef.current;
    if (!el) return;
    isNearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  }, []);

  const toggleFilter = (type: FeedEntryType) => {
    setFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const filtered = activityFeed.filter((e) => filters.has(e.type));
  const activeTasks = Array.from(taskProgress.values());

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      background: 'var(--bg-primary)', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '8px 10px',
        borderBottom: '1px solid var(--border-primary)',
        background: 'var(--bg-secondary)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Activity size={12} color="#fbbf24" />
          <span style={{
            fontFamily: 'var(--font-display)', fontSize: 9,
            letterSpacing: 2, color: 'var(--text-primary)', textTransform: 'uppercase',
          }}>
            Activity
          </span>
          <span style={{
            fontSize: 8, color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
          }}>
            {filtered.length}
          </span>
        </div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', display: 'flex', alignItems: 'center',
          }}
        >
          {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        </button>
      </div>

      {!collapsed && (
        <>
          {/* Filters */}
          <div style={{
            padding: '6px 10px', display: 'flex', gap: 4, flexWrap: 'wrap',
            borderBottom: '1px solid var(--border-primary)', flexShrink: 0,
          }}>
            <Filter size={9} color="var(--text-muted)" style={{ marginTop: 3 }} />
            {(Object.keys(TYPE_CFG) as FeedEntryType[]).map((type) => {
              const active = filters.has(type);
              const cfg = TYPE_CFG[type];
              return (
                <button
                  key={type}
                  onClick={() => toggleFilter(type)}
                  style={{
                    fontSize: 8, padding: '2px 6px',
                    background: active ? `${cfg.color}11` : 'transparent',
                    border: `1px solid ${active ? `${cfg.color}44` : 'var(--border-dim)'}`,
                    color: active ? cfg.color : 'var(--text-muted)',
                    borderRadius: 3, cursor: 'pointer',
                    fontFamily: 'var(--font-ui)', fontWeight: 600, letterSpacing: 0.5,
                    transition: 'all 0.15s ease',
                  }}
                >
                  {cfg.label}
                </button>
              );
            })}
          </div>

          {/* Active task progress bars */}
          {activeTasks.length > 0 && (
            <div style={{
              padding: '6px 10px',
              borderBottom: '1px solid var(--border-primary)',
              display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0,
            }}>
              {activeTasks.map((t) => (
                <div key={t.taskId}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                    <span style={{
                      fontSize: 8, color: agentColor(t.agentId),
                      fontFamily: 'var(--font-mono)', fontWeight: 600,
                    }}>
                      {agentLabel(t.agentId)}
                    </span>
                    <span style={{ fontSize: 8, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {t.progress ?? 0}%
                    </span>
                  </div>
                  <div style={{
                    height: 3, background: 'var(--bg-tertiary)', borderRadius: 2, overflow: 'hidden',
                  }}>
                    <div style={{
                      height: '100%', width: `${t.progress ?? 0}%`,
                      background: agentColor(t.agentId),
                      borderRadius: 2, transition: 'width 0.3s ease',
                      boxShadow: `0 0 6px ${agentColor(t.agentId)}44`,
                    }} />
                  </div>
                  {t.taskTitle && (
                    <span style={{
                      fontSize: 8, color: 'var(--text-muted)', marginTop: 1,
                      display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {t.taskTitle}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Feed entries */}
          <div
            ref={feedRef}
            onScroll={handleScroll}
            style={{
              flex: 1, overflow: 'auto', padding: '4px 0',
            }}
          >
            {filtered.length === 0 ? (
              <div style={{
                padding: 20, textAlign: 'center', color: 'var(--text-muted)',
                fontSize: 9, fontFamily: 'var(--font-mono)',
              }}>
                Waiting for activity...
              </div>
            ) : (
              filtered.map((entry) => (
                <FeedEntryRow key={entry.id} entry={entry} />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Feed entry row ────────────────────────────────────────────────

function FeedEntryRow({ entry }: { entry: FeedEntry }) {
  const cfg = TYPE_CFG[entry.type];
  const Icon = cfg.icon;
  const color = agentColor(entry.agentId);

  return (
    <div style={{
      padding: '4px 10px', display: 'flex', gap: 6, alignItems: 'flex-start',
      borderBottom: '1px solid rgba(255,255,255,0.02)',
      fontSize: 10, lineHeight: 1.4,
    }}>
      {/* Type icon */}
      <div style={{
        width: 16, height: 16, borderRadius: 3, flexShrink: 0, marginTop: 1,
        background: `${cfg.color}11`, border: `1px solid ${cfg.color}33`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={8} color={cfg.color} />
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'baseline' }}>
          <span style={{
            fontWeight: 700, color, fontSize: 8,
            fontFamily: 'var(--font-ui)', letterSpacing: 0.5,
          }}>
            {agentLabel(entry.agentId)}
          </span>
          <span style={{ fontSize: 7, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {formatTime(entry.timestamp)}
          </span>
        </div>

        {/* Type-specific rendering */}
        {entry.type === 'tool_call' && (
          <div style={{ color: '#60a5fa', fontFamily: 'var(--font-mono)', fontSize: 9 }}>
            <span style={{ color: 'var(--text-muted)' }}>tool:</span>{entry.toolName}
          </div>
        )}

        {entry.type === 'delegation' && (
          <div style={{ color: '#c084fc', fontSize: 9 }}>
            <span style={{ color: agentColor(entry.fromAgent ?? '') }}>
              {agentLabel(entry.fromAgent ?? '')}
            </span>
            <span style={{ color: 'var(--text-muted)', margin: '0 3px' }}>&rarr;</span>
            <span style={{ color: agentColor(entry.toAgent ?? '') }}>
              {agentLabel(entry.toAgent ?? '')}
            </span>
          </div>
        )}

        {entry.type === 'task_progress' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{
              flex: 1, height: 2, background: 'var(--bg-tertiary)', borderRadius: 1, overflow: 'hidden',
            }}>
              <div style={{
                height: '100%', width: `${entry.progress ?? 0}%`,
                background: color, borderRadius: 1,
              }} />
            </div>
            <span style={{ fontSize: 8, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {entry.progress}%
            </span>
          </div>
        )}

        {entry.type === 'status_change' && (
          <div style={{ fontSize: 9, color: 'var(--text-secondary)' }}>
            <span style={{ color: 'var(--text-muted)' }}>{entry.oldStatus}</span>
            <span style={{ color: 'var(--text-muted)', margin: '0 3px' }}>&rarr;</span>
            <span style={{ color: entry.newStatus === 'idle' ? '#00ff41' : entry.newStatus === 'busy' ? '#fbbf24' : '#ef4444' }}>
              {entry.newStatus}
            </span>
          </div>
        )}

        {/* Detail text for tool calls */}
        {entry.type === 'tool_call' && entry.detail && (
          <div style={{
            fontSize: 9, color: 'var(--text-muted)', marginTop: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {entry.detail.length > 80 ? entry.detail.substring(0, 80) + '...' : entry.detail}
          </div>
        )}
      </div>
    </div>
  );
}

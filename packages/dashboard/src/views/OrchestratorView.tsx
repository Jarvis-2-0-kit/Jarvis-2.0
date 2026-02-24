/**
 * OrchestratorView — Task execution graph & dependency visualization
 *
 * Shows:
 * - DAG (Directed Acyclic Graph) of task dependencies
 * - Task lifecycle: pending → ready → assigned → in-progress → completed/failed
 * - Agent assignments and delegation chains
 * - Real-time status updates
 * - Summary stats (pending, ready, in-progress, completed, failed)
 */

import { useState, useEffect, useCallback } from 'react';
import {
  GitBranch, RefreshCw, CheckCircle2, XCircle, Clock,
  Loader2, ArrowRight, Bot, Zap, AlertTriangle, ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { gateway } from '../gateway/client.js';
import { useGatewayStore } from '../store/gateway-store.js';
import { formatRelative, formatDuration } from '../utils/formatters.js';

// ─── Types ─────────────────────────────────────────────────────────

interface TaskNode {
  taskId: string;
  parentTaskId?: string;
  title: string;
  description: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  status: 'pending' | 'ready' | 'assigned' | 'in-progress' | 'completed' | 'failed';
  assignedAgent?: string;
  preferredAgent?: string;
  sourceAgent?: string;
  dependencies: string[];
  dependents: string[];
  result?: string;
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

interface GraphState {
  totalTasks: number;
  pending: number;
  ready: number;
  inProgress: number;
  completed: number;
  failed: number;
  nodes: TaskNode[];
}

// ─── Constants ─────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { color: string; bg: string; icon: typeof Clock; label: string }> = {
  pending:       { color: '#6b7280', bg: 'rgba(107,114,128,0.1)', icon: Clock,        label: 'PENDING' },
  ready:         { color: '#fbbf24', bg: 'rgba(251,191,36,0.1)',  icon: Zap,          label: 'READY' },
  assigned:      { color: '#60a5fa', bg: 'rgba(96,165,250,0.1)',  icon: Bot,          label: 'ASSIGNED' },
  'in-progress': { color: '#c084fc', bg: 'rgba(192,132,252,0.1)', icon: Loader2,      label: 'RUNNING' },
  completed:     { color: '#00ff41', bg: 'rgba(0,255,65,0.1)',    icon: CheckCircle2, label: 'DONE' },
  failed:        { color: '#ef4444', bg: 'rgba(239,68,68,0.1)',   icon: XCircle,      label: 'FAILED' },
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  normal: '#60a5fa',
  low: '#6b7280',
};

const CSS = `
@keyframes orch-pulse { 0%,100%{opacity:.5} 50%{opacity:1} }
@keyframes orch-spin { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }
@keyframes orch-slide { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
`;

// ─── Main Component ────────────────────────────────────────────────

export function OrchestratorView() {
  const connected = useGatewayStore((s) => s.connected);
  const [graph, setGraph] = useState<GraphState | null>(null);
  const [readyTasks, setReadyTasks] = useState<TaskNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'graph' | 'list' | 'timeline'>('graph');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  // Inject CSS
  useEffect(() => {
    const id = 'orch-css';
    if (!document.getElementById(id)) {
      const s = document.createElement('style');
      s.id = id;
      s.textContent = CSS;
      document.head.appendChild(s);
    }
  }, []);

  const loadData = useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    try {
      const [graphData, readyData] = await Promise.all([
        gateway.request('orchestrator.graph'),
        gateway.request('orchestrator.ready'),
      ]);
      setGraph(graphData as GraphState);
      setReadyTasks((readyData as TaskNode[]) ?? []);
    } catch {
      setGraph(null);
    } finally {
      setLoading(false);
    }
  }, [connected]);

  useEffect(() => {
    loadData();
    const iv = setInterval(loadData, 10000);
    return () => clearInterval(iv);
  }, [loadData]);

  // Listen for task events
  useEffect(() => {
    const handler = () => { void loadData(); };
    gateway.on('task.created', handler);
    gateway.on('task.completed', handler);
    gateway.on('task.progress', handler);
    return () => {
      gateway.off('task.created', handler);
      gateway.off('task.completed', handler);
      gateway.off('task.progress', handler);
    };
  }, [loadData]);

  const toggleExpand = (id: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const nodes = graph?.nodes ?? [];
  const filtered = statusFilter === 'all'
    ? nodes
    : nodes.filter((n) => n.status === statusFilter);

  // Build tree structure
  const rootNodes = filtered.filter((n) => !n.parentTaskId || !nodes.find((p) => p.taskId === n.parentTaskId));
  const childMap = new Map<string, TaskNode[]>();
  for (const n of nodes) {
    if (n.parentTaskId) {
      const children = childMap.get(n.parentTaskId) ?? [];
      children.push(n);
      childMap.set(n.parentTaskId, children);
    }
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <GitBranch size={20} color="var(--cyan-bright)" />
          <div>
            <h1 style={{
              fontFamily: 'var(--font-display)', fontSize: 16,
              letterSpacing: 3, color: 'var(--text-primary)', margin: 0,
            }}>
              ORCHESTRATOR
            </h1>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '2px 0 0' }}>
              Task dependency graph & execution pipeline
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* View mode toggles */}
          {(['graph', 'list', 'timeline'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              style={{
                padding: '4px 10px', fontSize: 9,
                background: viewMode === mode ? 'var(--green-dim)' : 'transparent',
                border: `1px solid ${viewMode === mode ? 'var(--green-muted)' : 'var(--border-dim)'}`,
                color: viewMode === mode ? 'var(--green-bright)' : 'var(--text-muted)',
                borderRadius: 4, cursor: 'pointer',
                fontFamily: 'var(--font-display)', letterSpacing: 1,
                textTransform: 'uppercase',
              }}
            >
              {mode}
            </button>
          ))}
          <button
            onClick={() => void loadData()}
            disabled={loading}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '5px 12px', fontSize: 10,
              background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
              borderRadius: 4, cursor: 'pointer', color: 'var(--text-muted)',
            }}
          >
            <RefreshCw size={10} style={{ animation: loading ? 'orch-spin 1s linear infinite' : 'none' }} />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats bar */}
      {graph && (
        <div style={{
          display: 'flex', gap: 12, marginBottom: 20,
          padding: '12px 16px',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-primary)',
          borderRadius: 8,
        }}>
          <StatChip
            label="Total"
            value={graph.totalTasks}
            color="var(--text-primary)"
            active={statusFilter === 'all'}
            onClick={() => setStatusFilter('all')}
          />
          <StatChip
            label="Pending"
            value={graph.pending}
            color="#6b7280"
            active={statusFilter === 'pending'}
            onClick={() => setStatusFilter('pending')}
          />
          <StatChip
            label="Ready"
            value={graph.ready}
            color="#fbbf24"
            active={statusFilter === 'ready'}
            onClick={() => setStatusFilter('ready')}
          />
          <StatChip
            label="Running"
            value={graph.inProgress}
            color="#c084fc"
            active={statusFilter === 'in-progress'}
            onClick={() => setStatusFilter('in-progress')}
          />
          <StatChip
            label="Done"
            value={graph.completed}
            color="#00ff41"
            active={statusFilter === 'completed'}
            onClick={() => setStatusFilter('completed')}
          />
          <StatChip
            label="Failed"
            value={graph.failed}
            color="#ef4444"
            active={statusFilter === 'failed'}
            onClick={() => setStatusFilter('failed')}
          />

          {readyTasks.length > 0 && (
            <div style={{
              marginLeft: 'auto',
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '4px 12px',
              background: 'rgba(251,191,36,0.1)',
              border: '1px solid rgba(251,191,36,0.3)',
              borderRadius: 6,
            }}>
              <Zap size={12} color="#fbbf24" />
              <span style={{ fontSize: 10, color: '#fbbf24', fontWeight: 600 }}>
                {readyTasks.length} tasks ready for dispatch
              </span>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!loading && (graph?.totalTasks ?? 0) === 0 && (
        <div style={{
          padding: 60, textAlign: 'center',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
        }}>
          <GitBranch size={40} color="var(--text-muted)" style={{ opacity: 0.3 }} />
          <span style={{
            fontFamily: 'var(--font-display)', fontSize: 12,
            letterSpacing: 2, color: 'var(--text-muted)',
          }}>
            NO ACTIVE TASKS
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            Tasks will appear here when agents process work through the orchestrator
          </span>
        </div>
      )}

      {/* Graph view */}
      {viewMode === 'graph' && filtered.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {rootNodes.map((node) => (
            <TaskTree
              key={node.taskId}
              node={node}
              childMap={childMap}
              depth={0}
              expandedNodes={expandedNodes}
              onToggle={toggleExpand}
            />
          ))}
        </div>
      )}

      {/* List view */}
      {viewMode === 'list' && filtered.length > 0 && (
        <div style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-primary)',
          borderRadius: 8,
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 100px 100px 100px 120px',
            padding: '8px 16px',
            borderBottom: '1px solid var(--border-primary)',
            fontSize: 9, color: 'var(--text-muted)',
            fontFamily: 'var(--font-display)', letterSpacing: 1,
          }}>
            <span>TASK</span>
            <span>STATUS</span>
            <span>PRIORITY</span>
            <span>AGENT</span>
            <span>CREATED</span>
          </div>
          {filtered.map((node) => (
            <TaskRow key={node.taskId} node={node} />
          ))}
        </div>
      )}

      {/* Timeline view */}
      {viewMode === 'timeline' && filtered.length > 0 && (
        <div style={{ position: 'relative', paddingLeft: 24 }}>
          {/* Vertical line */}
          <div style={{
            position: 'absolute', left: 11, top: 0, bottom: 0,
            width: 2, background: 'var(--border-primary)',
          }} />
          {filtered
            .sort((a, b) => b.createdAt - a.createdAt)
            .map((node) => (
              <TimelineItem key={node.taskId} node={node} />
            ))}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────

function StatChip({ label, value, color, active, onClick }: {
  label: string; value: number; color: string;
  active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '4px 10px', borderRadius: 6,
        background: active ? `${color}15` : 'transparent',
        border: active ? `1px solid ${color}40` : '1px solid transparent',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
      }}
    >
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, color,
      }}>
        {value}
      </span>
      <span style={{
        fontSize: 9, color: 'var(--text-muted)',
        fontFamily: 'var(--font-display)', letterSpacing: 1,
      }}>
        {label}
      </span>
    </button>
  );
}

function TaskTree({ node, childMap, depth, expandedNodes, onToggle }: {
  node: TaskNode;
  childMap: Map<string, TaskNode[]>;
  depth: number;
  expandedNodes: Set<string>;
  onToggle: (id: string) => void;
}) {
  const children = childMap.get(node.taskId) ?? [];
  const hasChildren = children.length > 0;
  const expanded = expandedNodes.has(node.taskId);
  const cfg = STATUS_CFG[node.status] ?? STATUS_CFG['pending'];
  const Icon = cfg.icon;
  const prioColor = PRIORITY_COLORS[node.priority] ?? PRIORITY_COLORS['normal'];

  return (
    <div style={{ animation: 'orch-slide 0.2s ease-out' }}>
      <div
        onClick={() => hasChildren && onToggle(node.taskId)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 16px',
          paddingLeft: 16 + depth * 28,
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-dim)',
          borderRadius: 6,
          marginBottom: 2,
          cursor: hasChildren ? 'pointer' : 'default',
          transition: 'border-color 0.15s',
        }}
      >
        {/* Expand arrow */}
        {hasChildren ? (
          <span style={{ color: 'var(--text-muted)', transition: 'transform 0.2s' }}>
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        ) : (
          <span style={{ width: 12 }} />
        )}

        {/* Status icon */}
        <div style={{
          width: 24, height: 24, borderRadius: 6,
          background: cfg.bg, border: `1px solid ${cfg.color}30`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon
            size={12}
            color={cfg.color}
            style={{
              animation: node.status === 'in-progress' ? 'orch-spin 2s linear infinite' : 'none',
            }}
          />
        </div>

        {/* Task info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              fontSize: 11, fontWeight: 600, color: 'var(--text-primary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {node.title}
            </span>
            <span style={{
              fontSize: 8, padding: '1px 6px', borderRadius: 3,
              background: `${prioColor}15`, color: prioColor,
              fontFamily: 'var(--font-display)', letterSpacing: 1,
              textTransform: 'uppercase', fontWeight: 700,
            }}>
              {node.priority}
            </span>
          </div>
          {node.description && (
            <span style={{
              fontSize: 9, color: 'var(--text-muted)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              display: 'block', maxWidth: 400,
            }}>
              {node.description}
            </span>
          )}
        </div>

        {/* Dependencies */}
        {node.dependencies.length > 0 && (
          <span style={{
            fontSize: 8, color: 'var(--text-muted)',
            display: 'flex', alignItems: 'center', gap: 3,
          }}>
            <ArrowRight size={8} />
            {node.dependencies.length} deps
          </span>
        )}

        {/* Assigned agent */}
        {node.assignedAgent && (
          <span style={{
            fontSize: 9, padding: '2px 8px', borderRadius: 4,
            background: 'rgba(0,200,255,0.08)',
            border: '1px solid rgba(0,200,255,0.2)',
            color: 'var(--cyan-bright)',
            fontFamily: 'var(--font-mono)',
          }}>
            {node.assignedAgent.replace('agent-', '')}
          </span>
        )}

        {/* Status badge */}
        <span style={{
          fontSize: 8, padding: '2px 8px', borderRadius: 4,
          background: cfg.bg, border: `1px solid ${cfg.color}30`,
          color: cfg.color, fontFamily: 'var(--font-display)',
          letterSpacing: 1, fontWeight: 700,
        }}>
          {cfg.label}
        </span>

        {/* Timing */}
        <span style={{ fontSize: 8, color: 'var(--text-muted)', minWidth: 50, textAlign: 'right' }}>
          {node.completedAt
            ? formatDuration(node.completedAt - (node.startedAt ?? node.createdAt))
            : node.startedAt
              ? formatDuration(Date.now() - node.startedAt)
              : formatRelative(node.createdAt)}
        </span>
      </div>

      {/* Children */}
      {expanded && children.map((child) => (
        <TaskTree
          key={child.taskId}
          node={child}
          childMap={childMap}
          depth={depth + 1}
          expandedNodes={expandedNodes}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}

function TaskRow({ node }: { node: TaskNode }) {
  const cfg = STATUS_CFG[node.status] ?? STATUS_CFG['pending'];
  const prioColor = PRIORITY_COLORS[node.priority] ?? PRIORITY_COLORS['normal'];

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 100px 100px 100px 120px',
      padding: '10px 16px',
      borderBottom: '1px solid var(--border-dim)',
      alignItems: 'center',
      fontSize: 11,
    }}>
      <div>
        <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{node.title}</span>
        {node.description && (
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>
            {node.description.substring(0, 80)}
          </div>
        )}
      </div>
      <span style={{
        fontSize: 8, padding: '2px 8px', borderRadius: 4,
        background: cfg.bg, color: cfg.color,
        fontFamily: 'var(--font-display)', letterSpacing: 1, fontWeight: 700,
        textAlign: 'center', width: 'fit-content',
      }}>
        {cfg.label}
      </span>
      <span style={{
        fontSize: 8, padding: '2px 6px', borderRadius: 3,
        color: prioColor, fontWeight: 600,
        textTransform: 'uppercase',
      }}>
        {node.priority}
      </span>
      <span style={{
        fontSize: 9, color: node.assignedAgent ? 'var(--cyan-bright)' : 'var(--text-muted)',
        fontFamily: 'var(--font-mono)',
      }}>
        {node.assignedAgent?.replace('agent-', '') ?? '—'}
      </span>
      <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>
        {formatRelative(node.createdAt)}
      </span>
    </div>
  );
}

function TimelineItem({ node }: { node: TaskNode }) {
  const cfg = STATUS_CFG[node.status] ?? STATUS_CFG['pending'];
  const Icon = cfg.icon;

  return (
    <div style={{
      display: 'flex', gap: 16, marginBottom: 16,
      animation: 'orch-slide 0.2s ease-out',
      position: 'relative',
    }}>
      {/* Dot on timeline */}
      <div style={{
        position: 'absolute', left: -18,
        width: 16, height: 16, borderRadius: '50%',
        background: cfg.bg, border: `2px solid ${cfg.color}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1,
      }}>
        <Icon size={8} color={cfg.color} />
      </div>

      {/* Content */}
      <div style={{
        flex: 1,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-dim)',
        borderRadius: 8,
        padding: '12px 16px',
        marginLeft: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>
            {node.title}
          </span>
          <span style={{
            fontSize: 8, padding: '1px 6px', borderRadius: 3,
            background: cfg.bg, color: cfg.color,
            fontFamily: 'var(--font-display)', letterSpacing: 1, fontWeight: 700,
          }}>
            {cfg.label}
          </span>
          {node.assignedAgent && (
            <span style={{
              fontSize: 8, padding: '1px 6px', borderRadius: 3,
              background: 'rgba(0,200,255,0.08)', color: 'var(--cyan-bright)',
              fontFamily: 'var(--font-mono)',
            }}>
              {node.assignedAgent}
            </span>
          )}
          <span style={{ fontSize: 8, color: 'var(--text-muted)', marginLeft: 'auto' }}>
            {new Date(node.createdAt).toLocaleString()}
          </span>
        </div>
        {node.description && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>
            {node.description}
          </div>
        )}
        {node.result && (
          <div style={{
            fontSize: 10, color: 'var(--green-secondary)',
            background: 'rgba(0,255,65,0.04)', padding: '6px 10px',
            borderRadius: 4, marginTop: 6, fontFamily: 'var(--font-mono)',
            maxHeight: 80, overflow: 'auto',
          }}>
            {node.result.substring(0, 200)}
          </div>
        )}
        {node.error && (
          <div style={{
            fontSize: 10, color: '#ef4444',
            background: 'rgba(239,68,68,0.06)', padding: '6px 10px',
            borderRadius: 4, marginTop: 6, fontFamily: 'var(--font-mono)',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <AlertTriangle size={10} />
            {node.error.substring(0, 200)}
          </div>
        )}
        {/* Duration */}
        {(node.startedAt || node.completedAt) && (
          <div style={{ fontSize: 8, color: 'var(--text-muted)', marginTop: 6, display: 'flex', gap: 12 }}>
            {node.startedAt && <span>Started: {new Date(node.startedAt).toLocaleTimeString()}</span>}
            {node.completedAt && <span>Completed: {new Date(node.completedAt).toLocaleTimeString()}</span>}
            {node.completedAt && node.startedAt && (
              <span>Duration: {formatDuration(node.completedAt - node.startedAt)}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


import { useState, useEffect, useCallback } from 'react';
import { useGatewayStore } from '../store/gateway-store.js';
import { gateway } from '../gateway/client.js';
import {
  GitBranch,
  Play,
  RefreshCw,
  ChevronRight,
  Clock,
  CheckCircle,
  XCircle,
  Pause,
  Eye,
  List,
  Zap,
  AlertTriangle,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────

interface WorkflowSummary {
  id: string;
  name: string;
  description: string;
  steps: number;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  createdBy: string;
}

interface WorkflowRunSummary {
  runId: string;
  workflowId: string;
  workflowName: string;
  status: string;
  startedAt: number;
  endedAt?: number;
  stepsCompleted: number;
  stepsTotal: number;
  agentId: string;
}

interface WorkflowDetail {
  id: string;
  name: string;
  description: string;
  version: string;
  inputs?: Record<string, { type: string; description?: string; default?: unknown; required?: boolean }>;
  steps: Array<{
    id: string;
    name: string;
    action: string;
    params: Record<string, unknown>;
    condition?: string;
    onError?: string;
    outputVar?: string;
  }>;
  tags: string[];
  defaultOnError: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
}

// ─── Main View ───────────────────────────────────────────────────────

export function WorkflowsView() {
  const connected = useGatewayStore((s) => s.connected);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [runs, setRuns] = useState<WorkflowRunSummary[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowDetail | null>(null);
  const [activeTab, setActiveTab] = useState<'workflows' | 'runs'>('workflows');
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    try {
      const [wfList, runList] = await Promise.all([
        gateway.request<WorkflowSummary[]>('workflows.list').catch(() => []),
        gateway.request<WorkflowRunSummary[]>('workflows.runs').catch(() => []),
      ]);
      setWorkflows(wfList ?? []);
      setRuns(runList ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [connected]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const inspectWorkflow = async (id: string) => {
    try {
      const detail = await gateway.request<WorkflowDetail>('workflows.get', { workflowId: id });
      setSelectedWorkflow(detail);
    } catch { /* ignore */ }
  };

  const completedRuns = runs.filter(r => r.status === 'completed').length;
  const failedRuns = runs.filter(r => r.status === 'failed').length;

  return (
    <div style={{
      height: '100%',
      overflow: 'auto',
      padding: 20,
      background: 'var(--bg-primary)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <GitBranch size={20} color="var(--amber)" />
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 16,
          letterSpacing: 3,
          color: 'var(--amber)',
          textShadow: '0 0 10px rgba(255,180,0,0.3)',
          margin: 0,
        }}>
          WORKFLOWS
        </h1>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Stats badges */}
          <StatBadge label="DEFINITIONS" value={workflows.length} color="var(--cyan-bright)" />
          <StatBadge label="RUNS" value={runs.length} color="var(--amber)" />
          <StatBadge label="SUCCESS" value={completedRuns} color="#00ff41" />
          {failedRuns > 0 && <StatBadge label="FAILED" value={failedRuns} color="#ff4444" />}
          <button
            onClick={() => void fetchData()}
            disabled={loading}
            aria-label="Refresh workflows"
            style={{
              background: 'none',
              border: '1px solid var(--border-primary)',
              borderRadius: 4,
              padding: '3px 8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              color: 'var(--text-muted)',
              fontSize: 9,
              fontFamily: 'var(--font-display)',
              letterSpacing: 0.5,
              opacity: loading ? 0.5 : 1,
            }}
          >
            <RefreshCw size={10} /> REFRESH
          </button>
        </div>
      </div>

      {/* Tab Switcher */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 16 }}>
        {(['workflows', 'runs'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '8px 20px',
              background: activeTab === tab ? 'var(--bg-secondary)' : 'transparent',
              border: `1px solid ${activeTab === tab ? 'var(--amber)' : 'var(--border-primary)'}`,
              borderRadius: 4,
              cursor: 'pointer',
              fontFamily: 'var(--font-display)',
              fontSize: 11,
              letterSpacing: 1.5,
              color: activeTab === tab ? 'var(--amber)' : 'var(--text-muted)',
              transition: 'all 0.15s ease',
            }}
          >
            {tab === 'workflows' ? 'DEFINITIONS' : 'RUN HISTORY'}
            <span style={{
              marginLeft: 8,
              fontSize: 9,
              color: 'var(--text-muted)',
            }}>
              ({tab === 'workflows' ? workflows.length : runs.length})
            </span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ display: 'flex', gap: 16 }}>
        {/* List */}
        <div style={{ flex: 1 }}>
          {activeTab === 'workflows' && (
            <WorkflowsList
              workflows={workflows}
              onInspect={inspectWorkflow}
              selectedId={selectedWorkflow?.id}
            />
          )}
          {activeTab === 'runs' && (
            <RunsList runs={runs} />
          )}
        </div>

        {/* Detail Panel */}
        {selectedWorkflow && activeTab === 'workflows' && (
          <div style={{
            width: 420,
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-primary)',
            borderRadius: 8,
            overflow: 'auto',
            maxHeight: 'calc(100vh - 200px)',
          }}>
            <WorkflowDetailPanel workflow={selectedWorkflow} onClose={() => setSelectedWorkflow(null)} />
          </div>
        )}
      </div>

      {/* Empty State */}
      {workflows.length === 0 && runs.length === 0 && !loading && (
        <div style={{
          textAlign: 'center',
          padding: '60px 20px',
          color: 'var(--text-muted)',
        }}>
          <GitBranch size={48} strokeWidth={1} color="var(--text-muted)" style={{ opacity: 0.3, marginBottom: 16 }} />
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 14, letterSpacing: 2, marginBottom: 8 }}>
            NO WORKFLOWS YET
          </p>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.6 }}>
            Agents can create workflows using the <code style={{ color: 'var(--cyan-bright)' }}>workflow_create</code> tool.<br />
            Workflows chain tool calls, conditions, and variables into reusable automations.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Workflows List ──────────────────────────────────────────────────

function WorkflowsList({ workflows, onInspect, selectedId }: {
  workflows: WorkflowSummary[];
  onInspect: (id: string) => void;
  selectedId?: string;
}) {
  if (workflows.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {workflows.map(wf => (
        <button
          key={wf.id}
          onClick={() => onInspect(wf.id)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 16px',
            background: selectedId === wf.id ? 'rgba(255,180,0,0.08)' : 'var(--bg-secondary)',
            border: `1px solid ${selectedId === wf.id ? 'var(--amber)' : 'var(--border-primary)'}`,
            borderRadius: 6,
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'all 0.15s ease',
            outline: 'none',
            width: '100%',
          }}
        >
          <GitBranch size={16} color="var(--amber)" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: 12,
              letterSpacing: 1,
              color: 'var(--text-primary)',
              marginBottom: 3,
            }}>
              {wf.name}
            </div>
            <div style={{
              fontSize: 10,
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {wf.description || wf.id}
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{
              fontSize: 9,
              color: 'var(--cyan-bright)',
              fontFamily: 'var(--font-display)',
              letterSpacing: 1,
            }}>
              {wf.steps} STEPS
            </div>
            {wf.tags.length > 0 && (
              <div style={{ display: 'flex', gap: 4, marginTop: 4, justifyContent: 'flex-end' }}>
                {wf.tags.slice(0, 3).map(tag => (
                  <span key={tag} style={{
                    fontSize: 8,
                    padding: '1px 5px',
                    borderRadius: 3,
                    background: 'rgba(0,255,255,0.08)',
                    border: '1px solid rgba(0,255,255,0.15)',
                    color: 'var(--cyan-bright)',
                    fontFamily: 'var(--font-mono)',
                  }}>
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
          <ChevronRight size={14} color="var(--text-muted)" />
        </button>
      ))}
    </div>
  );
}

// ─── Runs List ───────────────────────────────────────────────────────

function RunsList({ runs }: { runs: WorkflowRunSummary[] }) {
  if (runs.length === 0) {
    return (
      <div style={{
        textAlign: 'center',
        padding: '40px 20px',
        color: 'var(--text-muted)',
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
      }}>
        No workflow runs yet.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {runs.map(run => {
        const elapsed = run.endedAt
          ? `${((run.endedAt - run.startedAt) / 1000).toFixed(1)}s`
          : `${((Date.now() - run.startedAt) / 1000).toFixed(0)}s running`;
        const progress = run.stepsTotal > 0 ? (run.stepsCompleted / run.stepsTotal) * 100 : 0;

        return (
          <div
            key={run.runId}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 14px',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-primary)',
              borderRadius: 6,
            }}
          >
            <RunStatusIcon status={run.status} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontFamily: 'var(--font-display)',
                fontSize: 11,
                letterSpacing: 0.5,
                color: 'var(--text-primary)',
                marginBottom: 2,
              }}>
                {run.workflowName}
              </div>
              <div style={{
                fontSize: 9,
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
              }}>
                {run.runId} | {run.agentId}
              </div>
            </div>

            {/* Progress bar */}
            <div style={{ width: 80 }}>
              <div style={{
                height: 4,
                background: 'rgba(255,255,255,0.05)',
                borderRadius: 2,
                overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  width: `${progress}%`,
                  background: run.status === 'failed' ? '#ff4444' : run.status === 'completed' ? '#00ff41' : 'var(--amber)',
                  borderRadius: 2,
                  transition: 'width 0.3s ease',
                }} />
              </div>
              <div style={{
                fontSize: 8,
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
                marginTop: 2,
                textAlign: 'center',
              }}>
                {run.stepsCompleted}/{run.stepsTotal}
              </div>
            </div>

            <div style={{
              fontSize: 9,
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              textAlign: 'right',
              minWidth: 60,
            }}>
              {elapsed}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Workflow Detail Panel ───────────────────────────────────────────

function WorkflowDetailPanel({ workflow, onClose }: { workflow: WorkflowDetail; onClose: () => void }) {
  return (
    <div style={{ padding: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <GitBranch size={16} color="var(--amber)" />
        <span style={{
          fontFamily: 'var(--font-display)',
          fontSize: 13,
          letterSpacing: 2,
          color: 'var(--amber)',
          flex: 1,
        }}>
          {workflow.name}
        </span>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16,
        }}>
          x
        </button>
      </div>

      {/* Meta */}
      <div style={{
        padding: 10,
        background: 'rgba(0,0,0,0.2)',
        borderRadius: 6,
        marginBottom: 12,
        border: '1px solid var(--border-primary)',
        fontSize: 10,
        fontFamily: 'var(--font-mono)',
        color: 'var(--text-muted)',
        lineHeight: 1.8,
      }}>
        <div>ID: <span style={{ color: 'var(--text-secondary)' }}>{workflow.id}</span></div>
        <div>Version: <span style={{ color: 'var(--text-secondary)' }}>{workflow.version}</span></div>
        <div>Created by: <span style={{ color: 'var(--text-secondary)' }}>{workflow.createdBy}</span></div>
        <div>Error mode: <span style={{ color: 'var(--text-secondary)' }}>{workflow.defaultOnError}</span></div>
        {workflow.description && (
          <div style={{ marginTop: 4 }}>
            Description: <span style={{ color: 'var(--text-secondary)' }}>{workflow.description}</span>
          </div>
        )}
        {workflow.tags.length > 0 && (
          <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
            {workflow.tags.map(tag => (
              <span key={tag} style={{
                fontSize: 8, padding: '1px 5px', borderRadius: 3,
                background: 'rgba(0,255,255,0.08)', border: '1px solid rgba(0,255,255,0.15)',
                color: 'var(--cyan-bright)',
              }}>
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Inputs */}
      {workflow.inputs && Object.keys(workflow.inputs).length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{
            fontSize: 10, fontFamily: 'var(--font-display)', letterSpacing: 1,
            color: 'var(--text-muted)', marginBottom: 6,
          }}>
            INPUTS
          </div>
          {Object.entries(workflow.inputs).map(([key, schema]) => (
            <div key={key} style={{
              padding: '6px 10px',
              background: 'rgba(0,0,0,0.2)',
              borderRadius: 4,
              marginBottom: 4,
              border: '1px solid var(--border-primary)',
              fontSize: 10,
              fontFamily: 'var(--font-mono)',
            }}>
              <span style={{ color: 'var(--cyan-bright)' }}>{key}</span>
              <span style={{ color: 'var(--text-muted)' }}> ({schema.type})</span>
              {schema.required && <span style={{ color: '#FF6B6B' }}> *</span>}
              {schema.description && (
                <div style={{ color: 'var(--text-muted)', fontSize: 9, marginTop: 2 }}>{schema.description}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Steps */}
      <div style={{
        fontSize: 10, fontFamily: 'var(--font-display)', letterSpacing: 1,
        color: 'var(--text-muted)', marginBottom: 8,
      }}>
        STEPS ({workflow.steps.length})
      </div>
      {workflow.steps.map((step, idx) => (
        <div key={step.id} style={{
          padding: '10px 12px',
          background: 'rgba(0,0,0,0.2)',
          borderRadius: 6,
          marginBottom: 6,
          border: '1px solid var(--border-primary)',
          position: 'relative',
        }}>
          {/* Step number */}
          <div style={{
            position: 'absolute',
            top: 6,
            right: 8,
            fontSize: 8,
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
          }}>
            #{idx + 1}
          </div>

          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: 11,
            letterSpacing: 0.5,
            color: 'var(--text-primary)',
            marginBottom: 4,
          }}>
            {step.name}
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
            <span style={{
              fontSize: 8, padding: '1px 6px', borderRadius: 3,
              background: actionColor(step.action) + '15',
              border: `1px solid ${actionColor(step.action)}30`,
              color: actionColor(step.action),
              fontFamily: 'var(--font-mono)',
            }}>
              {step.action}
            </span>
            {step.onError && (
              <span style={{
                fontSize: 8, padding: '1px 6px', borderRadius: 3,
                background: 'rgba(255,100,100,0.08)',
                border: '1px solid rgba(255,100,100,0.15)',
                color: '#FF6B6B',
                fontFamily: 'var(--font-mono)',
              }}>
                on error: {step.onError}
              </span>
            )}
            {step.outputVar && (
              <span style={{
                fontSize: 8, padding: '1px 6px', borderRadius: 3,
                background: 'rgba(0,255,65,0.08)',
                border: '1px solid rgba(0,255,65,0.15)',
                color: '#00ff41',
                fontFamily: 'var(--font-mono)',
              }}>
                ${step.outputVar}
              </span>
            )}
          </div>

          {step.condition && (
            <div style={{
              fontSize: 9, color: 'var(--amber)', fontFamily: 'var(--font-mono)', marginBottom: 2,
            }}>
              if: {step.condition}
            </div>
          )}

          <pre style={{
            fontSize: 9,
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
            margin: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 80,
            overflow: 'auto',
          }}>
            {JSON.stringify(step.params, null, 2)}
          </pre>

          {/* Connector arrow */}
          {idx < workflow.steps.length - 1 && (
            <div style={{
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: 10,
              marginTop: 2,
            }}>
              |
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Shared UI ───────────────────────────────────────────────────────

function StatBadge({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      padding: '3px 8px',
      borderRadius: 10,
      background: `${color}08`,
      border: `1px solid ${color}20`,
    }}>
      <span style={{ fontSize: 12, fontFamily: 'var(--font-display)', fontWeight: 700, color }}>{value}</span>
      <span style={{ fontSize: 8, fontFamily: 'var(--font-display)', letterSpacing: 0.5, color: 'var(--text-muted)' }}>{label}</span>
    </div>
  );
}

function RunStatusIcon({ status }: { status: string }) {
  const props = { size: 14 };
  switch (status) {
    case 'completed': return <CheckCircle {...props} color="#00ff41" />;
    case 'failed': return <XCircle {...props} color="#ff4444" />;
    case 'running': return <Play {...props} color="var(--amber)" />;
    case 'paused': return <Pause {...props} color="var(--cyan-bright)" />;
    case 'cancelled': return <AlertTriangle {...props} color="var(--text-muted)" />;
    default: return <Clock {...props} color="var(--text-muted)" />;
  }
}

function actionColor(action: string): string {
  const colors: Record<string, string> = {
    tool_call: '#00ff41',
    set_variable: 'var(--cyan-bright)',
    condition: 'var(--amber)',
    log: 'var(--text-muted)',
    notify: '#FF6B6B',
    wait: '#888',
    delegate: '#1DB954',
    http: '#41BDF5',
    script: '#c678dd',
  };
  return colors[action] ?? 'var(--text-muted)';
}

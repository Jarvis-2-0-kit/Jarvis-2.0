import { useEffect, useState, useCallback } from 'react';
import { useGatewayStore } from '../store/gateway-store.js';
import { gateway } from '../gateway/client.js';
import {
  Clock,
  Plus,
  Trash2,
  Play,
  Pause,
  RefreshCw,
  Calendar,
  Timer,
  History,
  Zap,
  CheckCircle,
  XCircle,
  AlertTriangle,
} from 'lucide-react';

interface ScheduledJob {
  id: string;
  name: string;
  description?: string;
  cron?: string;
  at?: string;
  targetAgent?: string;
  taskInstruction: string;
  priority?: number;
  enabled: boolean;
  createdAt: string;
  lastRun?: string;
  nextRun?: string;
  runCount: number;
  tags?: string[];
  maxRuns?: number;
}

interface JobExecution {
  jobId: string;
  jobName: string;
  timestamp: string;
  status: 'success' | 'fired' | 'error';
  details?: string;
}

type Tab = 'jobs' | 'history' | 'create';

const CRON_PRESETS = [
  { label: 'Every minute', cron: '* * * * *' },
  { label: 'Every 5 minutes', cron: '*/5 * * * *' },
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Every day 9am', cron: '0 9 * * *' },
  { label: 'Weekdays 9am', cron: '0 9 * * 1-5' },
  { label: 'Monday 8am', cron: '0 8 * * 1' },
  { label: 'First of month', cron: '0 0 1 * *' },
  { label: 'Every Sunday', cron: '0 10 * * 0' },
];

export function SchedulerView() {
  const connected = useGatewayStore((s) => s.connected);
  const [tab, setTab] = useState<Tab>('jobs');
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [history, setHistory] = useState<JobExecution[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  // Create form state
  const [newJob, setNewJob] = useState({
    name: '',
    description: '',
    cron: '',
    at: '',
    targetAgent: '',
    taskInstruction: '',
    priority: 5,
    tags: '',
  });
  const [useOneShot, setUseOneShot] = useState(false);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await gateway.request<ScheduledJob[]>('scheduler.list');
      if (Array.isArray(data)) setJobs(data);
    } catch {
      // Try reading from NAS via cron-jobs directory
      try {
        const data = await gateway.request<{ jobs: ScheduledJob[] }>('scheduler.jobs');
        if (data?.jobs) setJobs(data.jobs);
      } catch { /* ignore */ }
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const data = await gateway.request<JobExecution[]>('scheduler.history');
      if (Array.isArray(data)) setHistory(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (connected) {
      void fetchJobs();
      void fetchHistory();
    }
  }, [connected, fetchJobs, fetchHistory]);

  const handleCreate = async () => {
    if (!newJob.name || !newJob.taskInstruction) return;
    try {
      await gateway.request('scheduler.create', {
        name: newJob.name,
        description: newJob.description || undefined,
        cron: useOneShot ? undefined : newJob.cron,
        at: useOneShot ? newJob.at : undefined,
        targetAgent: newJob.targetAgent || undefined,
        taskInstruction: newJob.taskInstruction,
        priority: newJob.priority,
        tags: newJob.tags ? newJob.tags.split(',').map(t => t.trim()) : undefined,
      });
      setNewJob({ name: '', description: '', cron: '', at: '', targetAgent: '', taskInstruction: '', priority: 5, tags: '' });
      setShowCreate(false);
      void fetchJobs();
    } catch { /* ignore */ }
  };

  const handleToggle = async (jobId: string, enabled: boolean) => {
    try {
      await gateway.request(enabled ? 'scheduler.enable' : 'scheduler.disable', { id: jobId });
      void fetchJobs();
    } catch { /* ignore */ }
  };

  const handleDelete = async (jobId: string) => {
    try {
      await gateway.request('scheduler.delete', { id: jobId });
      void fetchJobs();
    } catch { /* ignore */ }
  };

  const handleRunNow = async (jobId: string) => {
    try {
      await gateway.request('scheduler.run_now', { id: jobId });
      void fetchJobs();
      void fetchHistory();
    } catch { /* ignore */ }
  };

  return (
    <div style={{
      height: '100%',
      overflow: 'auto',
      padding: 20,
      background: 'var(--bg-primary)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Clock size={20} color="var(--cyan-bright)" />
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 16,
          letterSpacing: 3,
          color: 'var(--cyan-bright)',
          textShadow: 'var(--glow-cyan)',
          margin: 0,
        }}>
          SCHEDULER
        </h1>
        <span style={{
          fontSize: 9,
          padding: '2px 8px',
          borderRadius: 3,
          background: 'rgba(0,255,65,0.08)',
          border: '1px solid var(--green-dim)',
          color: 'var(--green-bright)',
          fontFamily: 'var(--font-mono)',
        }}>
          {jobs.filter(j => j.enabled).length} active / {jobs.length} total
        </span>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={() => { void fetchJobs(); void fetchHistory(); }} style={{
            fontSize: 9, padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 4,
            background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)',
            borderRadius: 4, color: 'var(--text-secondary)', cursor: 'pointer',
            fontFamily: 'var(--font-display)', letterSpacing: 1,
          }}>
            <RefreshCw size={10} /> REFRESH
          </button>
          <button onClick={() => setShowCreate(!showCreate)} style={{
            fontSize: 9, padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 4,
            background: 'rgba(0,255,65,0.08)', border: '1px solid var(--green-dim)',
            borderRadius: 4, color: 'var(--green-bright)', cursor: 'pointer',
            fontFamily: 'var(--font-display)', letterSpacing: 1,
          }}>
            <Plus size={10} /> NEW JOB
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        <TabBtn active={tab === 'jobs'} onClick={() => setTab('jobs')} icon={<Timer size={12} />} label={`JOBS (${jobs.length})`} />
        <TabBtn active={tab === 'history'} onClick={() => setTab('history')} icon={<History size={12} />} label={`HISTORY (${history.length})`} />
      </div>

      {/* Create Job Form */}
      {showCreate && (
        <div style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-cyan)',
          borderRadius: 6,
          padding: 16,
          marginBottom: 16,
        }}>
          <div style={{
            fontSize: 11, fontFamily: 'var(--font-display)', letterSpacing: 2,
            color: 'var(--cyan-bright)', marginBottom: 12,
          }}>
            CREATE NEW SCHEDULED JOB
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <FormField label="JOB NAME" value={newJob.name} onChange={v => setNewJob({ ...newJob, name: v })} placeholder="daily-report" />
            <FormField label="DESCRIPTION" value={newJob.description} onChange={v => setNewJob({ ...newJob, description: v })} placeholder="Generate daily summary" />
          </div>

          {/* Schedule Type Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-display)', letterSpacing: 1 }}>
              SCHEDULE TYPE:
            </span>
            <button onClick={() => setUseOneShot(false)} style={{
              fontSize: 9, padding: '2px 8px',
              background: !useOneShot ? 'rgba(0,255,255,0.08)' : 'transparent',
              border: `1px solid ${!useOneShot ? 'var(--cyan-dim)' : 'var(--border-dim)'}`,
              borderRadius: 4, color: !useOneShot ? 'var(--cyan-bright)' : 'var(--text-muted)',
              cursor: 'pointer', fontFamily: 'var(--font-display)', letterSpacing: 1,
            }}>
              <Calendar size={10} style={{ display: 'inline', verticalAlign: -2, marginRight: 4 }} />
              RECURRING
            </button>
            <button onClick={() => setUseOneShot(true)} style={{
              fontSize: 9, padding: '2px 8px',
              background: useOneShot ? 'rgba(255,170,0,0.08)' : 'transparent',
              border: `1px solid ${useOneShot ? 'rgba(255,170,0,0.3)' : 'var(--border-dim)'}`,
              borderRadius: 4, color: useOneShot ? 'var(--amber)' : 'var(--text-muted)',
              cursor: 'pointer', fontFamily: 'var(--font-display)', letterSpacing: 1,
            }}>
              <Zap size={10} style={{ display: 'inline', verticalAlign: -2, marginRight: 4 }} />
              ONE-SHOT
            </button>
          </div>

          {!useOneShot ? (
            <div style={{ marginBottom: 10 }}>
              <FormField label="CRON EXPRESSION" value={newJob.cron} onChange={v => setNewJob({ ...newJob, cron: v })} placeholder="0 9 * * 1-5" />
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                {CRON_PRESETS.map(p => (
                  <button key={p.cron} onClick={() => setNewJob({ ...newJob, cron: p.cron })} style={{
                    fontSize: 8, padding: '1px 6px',
                    background: newJob.cron === p.cron ? 'rgba(0,255,255,0.08)' : 'transparent',
                    border: '1px solid var(--border-dim)', borderRadius: 3,
                    color: newJob.cron === p.cron ? 'var(--cyan-bright)' : 'var(--text-muted)',
                    cursor: 'pointer', fontFamily: 'var(--font-mono)',
                  }}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <FormField label="DATETIME (ISO)" value={newJob.at} onChange={v => setNewJob({ ...newJob, at: v })} placeholder="2026-03-01T09:00:00" />
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div>
              <label style={{ fontSize: 8, color: 'var(--text-muted)', fontFamily: 'var(--font-display)', letterSpacing: 1 }}>
                TARGET AGENT
              </label>
              <select
                value={newJob.targetAgent}
                onChange={e => setNewJob({ ...newJob, targetAgent: e.target.value })}
                style={{
                  width: '100%', fontSize: 11, padding: '5px 8px', marginTop: 3,
                  background: 'var(--bg-primary)', border: '1px solid var(--border-primary)',
                  borderRadius: 4, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)',
                }}
              >
                <option value="">Any available</option>
                <option value="agent-alpha">agent-alpha (dev)</option>
                <option value="agent-beta">agent-beta (marketing)</option>
              </select>
            </div>
            <FormField label="PRIORITY (1-10)" value={String(newJob.priority)} onChange={v => setNewJob({ ...newJob, priority: Number(v) || 5 })} placeholder="5" />
            <FormField label="TAGS (comma-sep)" value={newJob.tags} onChange={v => setNewJob({ ...newJob, tags: v })} placeholder="report,daily" />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 8, color: 'var(--text-muted)', fontFamily: 'var(--font-display)', letterSpacing: 1 }}>
              TASK INSTRUCTION
            </label>
            <textarea
              value={newJob.taskInstruction}
              onChange={e => setNewJob({ ...newJob, taskInstruction: e.target.value })}
              placeholder="Generate a daily report of all completed tasks and send summary via notification..."
              rows={3}
              style={{
                width: '100%', fontSize: 11, padding: '8px 10px', marginTop: 3,
                background: 'var(--bg-primary)', border: '1px solid var(--border-primary)',
                borderRadius: 4, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)',
                resize: 'vertical',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleCreate} style={{
              fontSize: 9, padding: '5px 14px', display: 'flex', alignItems: 'center', gap: 4,
              background: 'rgba(0,255,65,0.08)', border: '1px solid var(--green-dim)',
              borderRadius: 4, color: 'var(--green-bright)', cursor: 'pointer',
              fontFamily: 'var(--font-display)', letterSpacing: 1,
            }}>
              <Plus size={10} /> CREATE JOB
            </button>
            <button onClick={() => setShowCreate(false)} style={{
              fontSize: 9, padding: '5px 14px',
              background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)',
              borderRadius: 4, color: 'var(--text-muted)', cursor: 'pointer',
              fontFamily: 'var(--font-display)', letterSpacing: 1,
            }}>
              CANCEL
            </button>
          </div>
        </div>
      )}

      {/* Jobs Tab */}
      {tab === 'jobs' && (
        <div style={{ display: 'grid', gap: 8 }}>
          {loading && (
            <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
              Loading scheduled jobs...
            </div>
          )}

          {!loading && jobs.length === 0 && (
            <div style={{
              padding: 40, textAlign: 'center', color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)', fontSize: 12,
            }}>
              No scheduled jobs. Create one to get started.
            </div>
          )}

          {jobs.map(job => (
            <div key={job.id} style={{
              background: 'var(--bg-secondary)',
              border: `1px solid ${job.enabled ? 'var(--border-primary)' : 'rgba(255,255,255,0.05)'}`,
              borderRadius: 6,
              padding: '12px 16px',
              opacity: job.enabled ? 1 : 0.6,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: job.enabled ? 'var(--green-bright)' : 'var(--text-muted)',
                  boxShadow: job.enabled ? 'var(--glow-green)' : 'none',
                }} />
                <span style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 12, letterSpacing: 1,
                  color: 'var(--text-white)',
                }}>
                  {job.name}
                </span>
                {job.cron && (
                  <span style={{
                    fontSize: 9, padding: '1px 6px', borderRadius: 3,
                    background: 'rgba(0,255,255,0.06)', border: '1px solid var(--border-cyan)',
                    color: 'var(--cyan-bright)', fontFamily: 'var(--font-mono)',
                  }}>
                    {job.cron}
                  </span>
                )}
                {job.at && (
                  <span style={{
                    fontSize: 9, padding: '1px 6px', borderRadius: 3,
                    background: 'rgba(255,170,0,0.06)', border: '1px solid rgba(255,170,0,0.3)',
                    color: 'var(--amber)', fontFamily: 'var(--font-mono)',
                  }}>
                    {new Date(job.at).toLocaleString()}
                  </span>
                )}
                {job.targetAgent && (
                  <span style={{
                    fontSize: 8, padding: '1px 5px', borderRadius: 2,
                    background: 'rgba(0,255,65,0.06)', border: '1px solid var(--green-dim)',
                    color: 'var(--green-bright)', fontFamily: 'var(--font-mono)',
                  }}>
                    → {job.targetAgent}
                  </span>
                )}
                {job.tags?.map(tag => (
                  <span key={tag} style={{
                    fontSize: 7, padding: '1px 4px', borderRadius: 2,
                    background: 'var(--bg-tertiary)', color: 'var(--text-muted)',
                    fontFamily: 'var(--font-mono)',
                  }}>
                    {tag}
                  </span>
                ))}

                <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                  <button onClick={() => void handleRunNow(job.id)} title="Run now" style={{
                    width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'var(--bg-primary)', border: '1px solid var(--border-primary)',
                    borderRadius: 4, color: 'var(--cyan-bright)', cursor: 'pointer', padding: 0,
                  }}>
                    <Zap size={11} />
                  </button>
                  <button onClick={() => void handleToggle(job.id, !job.enabled)} title={job.enabled ? 'Disable' : 'Enable'} style={{
                    width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'var(--bg-primary)', border: '1px solid var(--border-primary)',
                    borderRadius: 4, color: job.enabled ? 'var(--amber)' : 'var(--green-bright)', cursor: 'pointer', padding: 0,
                  }}>
                    {job.enabled ? <Pause size={11} /> : <Play size={11} />}
                  </button>
                  <button onClick={() => void handleDelete(job.id)} title="Delete" style={{
                    width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'var(--bg-primary)', border: '1px solid var(--border-primary)',
                    borderRadius: 4, color: 'var(--red-bright)', cursor: 'pointer', padding: 0,
                  }}>
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>

              {job.description && (
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 4 }}>
                  {job.description}
                </div>
              )}

              <div style={{
                fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)',
                padding: '4px 8px', background: 'var(--bg-primary)', borderRadius: 4,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                marginBottom: 4,
              }}>
                {job.taskInstruction}
              </div>

              <div style={{ display: 'flex', gap: 16, fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                <span>Runs: <span style={{ color: 'var(--text-secondary)' }}>{job.runCount}</span></span>
                {job.lastRun && <span>Last: <span style={{ color: 'var(--text-secondary)' }}>{new Date(job.lastRun).toLocaleString()}</span></span>}
                {job.nextRun && <span>Next: <span style={{ color: 'var(--cyan-bright)' }}>{new Date(job.nextRun).toLocaleString()}</span></span>}
                <span>Priority: <span style={{ color: 'var(--amber)' }}>{job.priority ?? 5}</span></span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* History Tab */}
      {tab === 'history' && (
        <div style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-primary)',
          borderRadius: 6,
          overflow: 'hidden',
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '160px 1fr 80px 1fr',
            gap: 8, padding: '8px 14px',
            fontSize: 9, fontFamily: 'var(--font-display)',
            letterSpacing: 1, color: 'var(--text-muted)',
            borderBottom: '1px solid var(--border-primary)',
          }}>
            <span>TIMESTAMP</span>
            <span>JOB</span>
            <span>STATUS</span>
            <span>DETAILS</span>
          </div>

          {history.length === 0 && (
            <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: 11, fontFamily: 'var(--font-mono)', textAlign: 'center' }}>
              No execution history yet.
            </div>
          )}

          {history.slice(0, 50).map((exec, i) => (
            <div key={i} style={{
              display: 'grid',
              gridTemplateColumns: '160px 1fr 80px 1fr',
              gap: 8, padding: '6px 14px',
              fontSize: 10, fontFamily: 'var(--font-mono)',
              borderBottom: '1px solid rgba(255,255,255,0.03)',
            }}>
              <span style={{ color: 'var(--text-muted)' }}>
                {new Date(exec.timestamp).toLocaleString()}
              </span>
              <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {exec.jobName}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {exec.status === 'success' && <CheckCircle size={10} color="var(--green-bright)" />}
                {exec.status === 'fired' && <Zap size={10} color="var(--cyan-bright)" />}
                {exec.status === 'error' && <XCircle size={10} color="var(--red-bright)" />}
                <span style={{
                  color: exec.status === 'success' ? 'var(--green-bright)' : exec.status === 'error' ? 'var(--red-bright)' : 'var(--cyan-bright)',
                }}>
                  {exec.status}
                </span>
              </span>
              <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {exec.details ?? '-'}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Summary Stats */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
        gap: 10,
        marginTop: 20,
      }}>
        <StatBox label="Total Jobs" value={String(jobs.length)} color="var(--cyan-bright)" />
        <StatBox label="Active" value={String(jobs.filter(j => j.enabled).length)} color="var(--green-bright)" />
        <StatBox label="Disabled" value={String(jobs.filter(j => !j.enabled).length)} color="var(--text-muted)" />
        <StatBox label="Recurring" value={String(jobs.filter(j => j.cron).length)} color="var(--cyan-bright)" />
        <StatBox label="One-shot" value={String(jobs.filter(j => j.at).length)} color="var(--amber)" />
        <StatBox label="Executions" value={String(history.length)} color="var(--green-bright)" />
      </div>
    </div>
  );
}

/* === Sub-components === */

function TabBtn({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string;
}) {
  return (
    <button onClick={onClick} style={{
      fontSize: 10, padding: '5px 14px', display: 'flex', alignItems: 'center', gap: 5,
      background: active ? 'rgba(0,255,255,0.08)' : 'var(--bg-secondary)',
      border: `1px solid ${active ? 'var(--border-cyan)' : 'var(--border-primary)'}`,
      borderRadius: 4, color: active ? 'var(--cyan-bright)' : 'var(--text-muted)',
      cursor: 'pointer', fontFamily: 'var(--font-display)', letterSpacing: 1,
    }}>
      {icon} {label}
    </button>
  );
}

function FormField({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div>
      <label style={{ fontSize: 8, color: 'var(--text-muted)', fontFamily: 'var(--font-display)', letterSpacing: 1 }}>
        {label}
      </label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%', fontSize: 11, padding: '5px 10px', marginTop: 3,
          background: 'var(--bg-primary)', border: '1px solid var(--border-primary)',
          borderRadius: 4, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)',
        }}
      />
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
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

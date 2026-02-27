import { useGatewayStore } from '../../store/gateway-store.js';

export function MetricsPanel() {
  const health = useGatewayStore((s) => s.health);
  const agents = useGatewayStore((s) => s.agents);
  const tasks = useGatewayStore((s) => s.tasks);

  const totalCompleted = Array.from(agents.values()).reduce((sum, a) => sum + a.completedTasks, 0);
  const totalFailed = Array.from(agents.values()).reduce((sum, a) => sum + a.failedTasks, 0);
  const activeTasks = tasks.filter((t) => t.status === 'in-progress' || t.status === 'assigned').length;
  const pendingTasks = tasks.filter((t) => !t.status || t.status === 'pending' || t.status === 'queued').length;

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <span style={{ color: 'var(--cyan-bright)' }}>&gt;&gt;</span>
        METRICS
      </div>
      <div style={{
        flex: 1,
        overflow: 'auto',
        padding: '8px 12px',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '8px',
        alignContent: 'start',
      }}>
        <MetricCard label="TASKS DONE" value={totalCompleted} color="var(--green-bright)" />
        <MetricCard label="ACTIVE" value={activeTasks} color="var(--amber)" />
        <MetricCard label="PENDING" value={pendingTasks} color="var(--cyan-muted)" />
        <MetricCard label="FAILED" value={totalFailed} color="var(--red-bright)" />

        {/* Infrastructure Status */}
        <div style={{
          gridColumn: '1 / -1',
          borderTop: '1px solid var(--border-primary)',
          paddingTop: 6,
          marginTop: 2,
        }}>
          <div style={{
            fontSize: 10,
            fontFamily: 'var(--font-display)',
            letterSpacing: 1.5,
            color: 'var(--text-muted)',
            marginBottom: 4,
          }}>
            INFRASTRUCTURE
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <InfraItem label="NATS" ok={health?.infrastructure?.nats ?? false} />
            <InfraItem label="REDIS" ok={health?.infrastructure?.redis ?? false} />
            <InfraItem label="NAS" ok={health?.infrastructure?.nas?.mounted ?? false} />
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      padding: '6px 8px',
      border: '1px solid var(--border-primary)',
      borderRadius: 4,
      background: 'var(--bg-card)',
    }}>
      <div style={{
        fontSize: 18,
        fontFamily: 'var(--font-display)',
        fontWeight: 700,
        color,
        textShadow: `0 0 8px ${color}44`,
      }}>
        {value}
      </div>
      <div style={{
        fontSize: 9,
        fontFamily: 'var(--font-ui)',
        fontWeight: 600,
        letterSpacing: 1.5,
        color: 'var(--text-muted)',
      }}>
        {label}
      </div>
    </div>
  );
}

function InfraItem({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      fontSize: 10,
    }}>
      <span className={`status-dot ${ok ? 'online' : 'offline'}`} style={{ width: 5, height: 5 }} />
      <span style={{ color: 'var(--text-secondary)', letterSpacing: 1 }}>{label}</span>
      <span style={{
        marginLeft: 'auto',
        color: ok ? 'var(--green-dim)' : 'var(--red-dim)',
        fontSize: 9,
      }}>
        {ok ? 'OK' : 'DOWN'}
      </span>
    </div>
  );
}

import { useGatewayStore } from '../../store/gateway-store.js';

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'var(--red-bright)',
  high: 'var(--amber)',
  normal: 'var(--green-muted)',
  low: 'var(--text-muted)',
};

const STATUS_ICONS: Record<string, string> = {
  pending: '[ ]',
  queued: '[~]',
  assigned: '[>]',
  'in-progress': '[*]',
  completed: '[x]',
  failed: '[!]',
  cancelled: '[-]',
};

export function TaskList() {
  const tasks = useGatewayStore((s) => s.tasks);

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <span style={{ color: 'var(--cyan-bright)' }}>&gt;&gt;</span>
        TASK QUEUE
        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 10 }}>
          {tasks.length} TASKS
        </span>
      </div>
      <div style={{
        flex: 1,
        overflow: 'auto',
        padding: '6px 0',
      }}>
        {tasks.length === 0 ? (
          <div style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: 11 }}>
            No tasks in queue
          </div>
        ) : (
          tasks.map((task) => (
            <div key={task.id} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 12px',
              fontSize: 11,
              borderBottom: '1px solid var(--border-primary)',
            }}>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: task.status === 'completed' ? 'var(--green-bright)' :
                       task.status === 'failed' ? 'var(--red-bright)' :
                       task.status === 'in-progress' ? 'var(--amber)' : 'var(--text-muted)',
              }}>
                {STATUS_ICONS[task.status ?? 'pending'] ?? '[ ]'}
              </span>
              <span style={{
                flex: 1,
                color: task.status === 'completed' ? 'var(--green-dim)' : 'var(--text-white)',
                textDecoration: task.status === 'completed' ? 'line-through' : 'none',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {task.title}
              </span>
              <span style={{
                fontSize: 9,
                fontWeight: 600,
                letterSpacing: 1,
                color: PRIORITY_COLORS[task.priority] ?? 'var(--text-muted)',
              }}>
                {task.priority.toUpperCase()}
              </span>
              {task.assignedAgent && (
                <span style={{
                  fontSize: 9,
                  color: 'var(--cyan-dim)',
                }}>
                  {task.assignedAgent === 'agent-alpha' ? 'A' : 'B'}
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
